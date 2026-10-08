import ky, { HTTPError, type ResponsePromise } from "ky"
import type { SettingsStore } from "./settings-store"
import type { StoredToken, TokenVault } from "./token-vault"
import { ConfigurationError, SessionChangedError, TwitchUnavailableError } from "./twitch-errors"
import { isIdentityCacheCurrent } from "./twitch-requests"
import {
  TokenResponseSchema,
  type ValidationResponse,
  ValidationResponseSchema,
} from "./twitch-schemas"

type ValidatedIdentity = {
  readonly checkedAt: number
  readonly value: ValidationResponse
}

type InstalledToken = {
  readonly revision: number
  readonly token: StoredToken
}

type ValidatedSession = {
  readonly identity: ValidationResponse
  readonly revision: number
}

export type TwitchCredentials = {
  readonly clientId: string
  readonly identity: ValidationResponse
  readonly token: StoredToken
}

export class TwitchSession {
  readonly #settings: SettingsStore
  readonly #vault: TokenVault
  #generation = 0
  #identity: ValidatedIdentity | undefined
  #refreshing: Promise<InstalledToken> | undefined

  public constructor(settings: SettingsStore, vault: TokenVault) {
    this.#settings = settings
    this.#vault = vault
    const validationTimer = setInterval(() => void this.#scheduledValidation(), 55 * 60 * 1000)
    validationTimer.unref()
  }

  public async identity(): Promise<ValidationResponse | undefined> {
    const revision = this.#generation
    const token = await this.#vault.load()
    if (revision !== this.#generation) throw new SessionChangedError()
    return token === undefined ? undefined : (await this.#validate(token, revision)).identity
  }

  public async credentials(): Promise<TwitchCredentials> {
    const revision = this.#generation
    const token = await this.#requireToken()
    if (revision !== this.#generation) throw new SessionChangedError()
    const validated = await this.#validate(token, revision)
    const currentToken = await this.#requireToken()
    const clientId = await this.#requireClientId()
    if (validated.revision !== this.#generation) throw new SessionChangedError()
    return { clientId, identity: validated.identity, token: currentToken }
  }

  public async refreshCredentials(): Promise<TwitchCredentials> {
    const revision = this.#generation
    const token = await this.#requireToken()
    if (revision !== this.#generation) throw new SessionChangedError()
    const installed = await this.#refresh(token, revision)
    const validated = await this.#validateTokenResponse(installed.token, false, installed.revision)
    const clientId = await this.#requireClientId()
    if (validated.revision !== this.#generation) throw new SessionChangedError()
    return { clientId, identity: validated.identity, token: installed.token }
  }

  public async saveToken(token: StoredToken): Promise<number> {
    return (await this.#installToken(token, this.#generation)).revision
  }

  public async clearIfCurrent(revision: number): Promise<void> {
    if (revision === this.#generation) {
      await this.clear()
    }
  }

  public async clear(): Promise<void> {
    this.#generation += 1
    this.#identity = undefined
    await this.#vault.clear()
  }

  async #validate(token: StoredToken, revision: number): Promise<ValidatedSession> {
    if (revision !== this.#generation) throw new SessionChangedError()
    if (
      this.#identity !== undefined &&
      isIdentityCacheCurrent(this.#identity.checkedAt, token.expiresAt, Date.now())
    ) {
      return { identity: this.#identity.value, revision }
    }
    return this.#validateTokenResponse(token, true, revision)
  }

  async #validateTokenResponse(
    token: StoredToken,
    mayRefresh: boolean,
    revision: number,
  ): Promise<ValidatedSession> {
    const response = await this.#requestValidation(token)
    if (revision !== this.#generation) {
      throw new SessionChangedError()
    }
    if (response.ok) {
      const value = ValidationResponseSchema.parse(await response.json<unknown>())
      if (revision !== this.#generation) {
        throw new SessionChangedError()
      }
      this.#identity = { checkedAt: Date.now(), value }
      return { identity: value, revision }
    }
    if (response.status !== 401) {
      throw new TwitchUnavailableError(response.status)
    }
    if (mayRefresh) {
      const installed = await this.#refresh(token, revision)
      return this.#validateTokenResponse(installed.token, false, installed.revision)
    }
    await this.clearIfCurrent(revision)
    throw new ConfigurationError("Your Twitch session expired. Sign in again")
  }

  #requestValidation(token: StoredToken): ResponsePromise {
    return ky.get("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token.accessToken}` },
      throwHttpErrors: false,
      timeout: 15_000,
    })
  }

  async #refresh(token: StoredToken, revision: number): Promise<InstalledToken> {
    if (this.#refreshing !== undefined) {
      return this.#refreshing
    }
    const refreshing = this.#performRefresh(token, revision)
    this.#refreshing = refreshing
    try {
      return await refreshing
    } finally {
      if (this.#refreshing === refreshing) {
        this.#refreshing = undefined
      }
    }
  }

  async #performRefresh(token: StoredToken, revision: number): Promise<InstalledToken> {
    const body = new URLSearchParams({
      client_id: await this.#requireClientId(),
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    })
    let payload: unknown
    try {
      payload = await ky
        .post("https://id.twitch.tv/oauth2/token", { body, timeout: 15_000 })
        .json<unknown>()
    } catch (error) {
      if (error instanceof HTTPError && [400, 401, 403, 404].includes(error.response.status)) {
        if (revision !== this.#generation) throw new SessionChangedError()
        await this.clearIfCurrent(revision)
        throw new ConfigurationError("Your Twitch session expired. Sign in again")
      }
      throw error
    }
    const response = TokenResponseSchema.parse(payload)
    if (revision !== this.#generation) {
      throw new SessionChangedError()
    }
    const refreshed = {
      accessToken: response.access_token,
      expiresAt: new Date(Date.now() + response.expires_in * 1000).toISOString(),
      refreshToken: response.refresh_token,
    }
    return this.#installToken(refreshed, revision)
  }

  async #scheduledValidation(): Promise<void> {
    const revision = this.#generation
    const token = await this.#vault.load()
    if (token === undefined) return
    if (revision !== this.#generation) return
    try {
      await this.#validateTokenResponse(token, true, revision)
    } catch (error) {
      if (error instanceof SessionChangedError) return
    }
  }

  async #installToken(token: StoredToken, expectedRevision: number): Promise<InstalledToken> {
    if (expectedRevision !== this.#generation) {
      throw new SessionChangedError()
    }
    const revision = this.#generation + 1
    this.#generation = revision
    this.#identity = undefined
    await this.#vault.save(token)
    if (revision !== this.#generation) {
      throw new SessionChangedError()
    }
    return { revision, token }
  }

  async #requireToken(): Promise<StoredToken> {
    const token = await this.#vault.load()
    if (token === undefined) {
      throw new ConfigurationError("Sign in to Twitch to browse streams")
    }
    return token
  }

  async #requireClientId(): Promise<string> {
    const settings = await this.#settings.load()
    if (settings.clientId === "") {
      throw new ConfigurationError("This build has no Twitch Client ID")
    }
    return settings.clientId
  }
}
