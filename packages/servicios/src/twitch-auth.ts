import type { AuthSnapshot, DeviceChallenge } from "@goodttv/contratos"
import ky from "ky"
import type { SettingsSource } from "./settings"
import type { StoredToken, TokenStore } from "./tokens"
import { ConfigurationError, SessionChangedError } from "./twitch-errors"
import { createDeviceTokenBody, isAllowedActivationUrl, TWITCH_SCOPES } from "./twitch-requests"
import {
  parseDeviceCodeResponse,
  TokenErrorSchema,
  TokenResponseSchema,
  toDeviceChallenge,
} from "./twitch-schemas"
import { type TwitchCredentials, TwitchSession } from "./twitch-session"

type PendingAuthorization = {
  readonly challenge: DeviceChallenge
  readonly deviceCode: string
  lastPollAt: number
}

export class TwitchAuth {
  readonly #scopes: string
  readonly #session: TwitchSession
  readonly #settings: SettingsSource
  readonly #vault: TokenStore
  #flowVersion = 0
  #pending: PendingAuthorization | undefined
  #polling: Promise<AuthSnapshot> | undefined

  // scopes: los que se piden al vincular (TWITCH_SCOPES, o TWITCH_CHAT_SCOPES para escribir en el chat).
  public constructor(settings: SettingsSource, vault: TokenStore, scopes = TWITCH_SCOPES) {
    this.#scopes = scopes
    this.#settings = settings
    this.#vault = vault
    this.#session = new TwitchSession(settings, vault)
  }

  public status(): { secureStorage: boolean } {
    return { secureStorage: this.#vault.isSecure }
  }

  public async begin(): Promise<DeviceChallenge> {
    const clientId = await this.#requireClientId()
    const body = new URLSearchParams({ client_id: clientId, scopes: this.#scopes })
    const response = parseDeviceCodeResponse(
      await ky
        .post("https://id.twitch.tv/oauth2/device", { body, timeout: 15_000 })
        .json<unknown>(),
    )
    const issued = toDeviceChallenge(response, crypto.randomUUID(), new Date())
    // The address becomes a QR code on the TV: only ever Twitch's own activation page.
    const challenge = isAllowedActivationUrl(issued.verificationUri)
      ? issued
      : { ...issued, verificationUri: "https://www.twitch.tv/activate" }
    this.#flowVersion += 1
    this.#pending = { challenge, deviceCode: response.device_code, lastPollAt: 0 }
    this.#polling = undefined
    return challenge
  }

  public async snapshot(): Promise<AuthSnapshot> {
    return this.#snapshot(1)
  }

  async #snapshot(retries: number): Promise<AuthSnapshot> {
    if (this.#pending !== undefined) {
      return this.#pollSingleFlight(this.#pending)
    }
    const flowVersion = this.#flowVersion
    try {
      const identity = await this.#session.identity()
      if (flowVersion !== this.#flowVersion) {
        return retries > 0 ? this.#snapshot(retries - 1) : this.#currentAuthorizationState()
      }
      if (identity === undefined) return { kind: "guest" }
      return {
        ...(identity.scopes.includes("user:write:chat") ? { canChat: true as const } : {}),
        displayName: identity.login,
        kind: "authenticated",
        login: identity.login,
      }
    } catch (error) {
      if (error instanceof SessionChangedError) {
        return retries > 0 ? this.#snapshot(retries - 1) : this.#currentAuthorizationState()
      }
      if (error instanceof ConfigurationError) {
        if (flowVersion !== this.#flowVersion) {
          return retries > 0 ? this.#snapshot(retries - 1) : this.#currentAuthorizationState()
        }
        await this.logout()
        return { kind: "error", message: error.message }
      }
      throw error
    }
  }

  public credentials(): Promise<TwitchCredentials> {
    return this.#session.credentials()
  }

  // La cuenta guardada con el token, sin preguntar a Twitch (TwitchSession.storedLogin).
  public storedLogin(): Promise<string | undefined> {
    return this.#session.storedLogin()
  }

  public refreshCredentials(): Promise<TwitchCredentials> {
    return this.#session.refreshCredentials()
  }

  public async logout(): Promise<void> {
    this.#cancelAuthorization()
    let clientId = ""
    try {
      clientId = (await this.#settings.load()).clientId
    } finally {
      await this.#clearAndRevoke(clientId)
    }
  }

  async #pollSingleFlight(pending: PendingAuthorization): Promise<AuthSnapshot> {
    if (this.#polling !== undefined) {
      return this.#polling
    }
    const polling = this.#poll(pending, this.#flowVersion)
    this.#polling = polling
    try {
      return await polling
    } finally {
      if (this.#polling === polling) {
        this.#polling = undefined
      }
    }
  }

  async #poll(pending: PendingAuthorization, flowVersion: number): Promise<AuthSnapshot> {
    const now = Date.now()
    if (now >= Date.parse(pending.challenge.expiresAt)) {
      this.#pending = undefined
      return { kind: "error", message: "The Twitch sign-in code expired" }
    }
    if (now - pending.lastPollAt < pending.challenge.intervalSeconds * 1000) {
      return { challenge: pending.challenge, kind: "authorizing" }
    }
    pending.lastPollAt = now
    const response = await ky.post("https://id.twitch.tv/oauth2/token", {
      body: createDeviceTokenBody(await this.#requireClientId(), pending.deviceCode, this.#scopes),
      throwHttpErrors: false,
      timeout: 15_000,
    })
    const payload: unknown = await response.json()
    if (!this.#flowIsActive(pending, flowVersion)) {
      return this.#currentAuthorizationState()
    }
    if (!response.ok) {
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        return { challenge: pending.challenge, kind: "authorizing" }
      }
      const tokenError = TokenErrorSchema.parse(payload)
      if (tokenError.message === "authorization_pending") {
        return { challenge: pending.challenge, kind: "authorizing" }
      }
      if (
        tokenError.message === "access_denied" ||
        tokenError.message === "expired_token" ||
        tokenError.message === "invalid device code"
      ) {
        this.#pending = undefined
        return { kind: "error", message: tokenError.message }
      }
      return { challenge: pending.challenge, kind: "authorizing" }
    }
    const tokenResponse = TokenResponseSchema.parse(payload)
    const tokenRevision = await this.#session.saveToken({
      accessToken: tokenResponse.access_token,
      expiresAt: new Date(now + tokenResponse.expires_in * 1000).toISOString(),
      refreshToken: tokenResponse.refresh_token,
    })
    if (!this.#flowIsActive(pending, flowVersion)) {
      await this.#session.clearIfCurrent(tokenRevision)
      return this.#currentAuthorizationState()
    }
    this.#pending = undefined
    return this.snapshot()
  }

  #flowIsActive(pending: PendingAuthorization, flowVersion: number): boolean {
    return this.#pending === pending && this.#flowVersion === flowVersion
  }

  #currentAuthorizationState(): AuthSnapshot {
    return this.#pending === undefined
      ? { kind: "guest" }
      : { challenge: this.#pending.challenge, kind: "authorizing" }
  }

  #cancelAuthorization(): void {
    this.#flowVersion += 1
    this.#pending = undefined
    this.#polling = undefined
  }

  async #clearAndRevoke(clientId: string): Promise<void> {
    let token: StoredToken | undefined
    try {
      token = await this.#vault.load()
    } finally {
      await this.#session.clear()
    }
    if (clientId === "" || token === undefined) return
    try {
      await ky.post("https://id.twitch.tv/oauth2/revoke", {
        body: new URLSearchParams({ client_id: clientId, token: token.accessToken }),
        throwHttpErrors: false,
        timeout: 5_000,
      })
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }

  async #requireClientId(): Promise<string> {
    const settings = await this.#settings.load()
    if (settings.clientId === "") {
      throw new ConfigurationError("This build has no Twitch Client ID")
    }
    return settings.clientId
  }
}
