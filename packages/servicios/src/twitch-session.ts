import ky, { HTTPError, type ResponsePromise } from "ky"
import type { SettingsSource } from "./settings"
import type { StoredIdentity, StoredToken, TokenStore } from "./tokens"
import { ConfigurationError, SessionChangedError, TwitchUnavailableError } from "./twitch-errors"
import { isIdentityCacheCurrent, isTokenExpiring } from "./twitch-requests"
import { TokenResponseSchema, ValidationResponseSchema } from "./twitch-schemas"

// The cached identity belongs to one access token: another page may sign in with another account meanwhile.
type ValidatedIdentity = {
  readonly accessToken: string
  readonly checkedAt: number
  readonly value: StoredIdentity
}

type InstalledToken = {
  readonly revision: number
  readonly token: StoredToken
}

type ValidatedSession = InstalledToken & { readonly identity: StoredIdentity }

export type TwitchCredentials = {
  readonly clientId: string
  readonly identity: StoredIdentity
  readonly token: StoredToken
}

const sameIdentity = (a: StoredIdentity | undefined, b: StoredIdentity): boolean =>
  a !== undefined &&
  a.login === b.login &&
  a.user_id === b.user_id &&
  a.scopes.join(" ") === b.scopes.join(" ")

export class TwitchSession {
  readonly #settings: SettingsSource
  readonly #vault: TokenStore
  #generation = 0
  #identity: ValidatedIdentity | undefined
  #refreshing: Promise<InstalledToken> | undefined
  // Al abrir lo piden a la vez la cuenta y cada lista de Inicio: una sola validación por token.
  #validating:
    | { readonly accessToken: string; readonly promise: Promise<ValidatedSession> }
    | undefined

  public constructor(settings: SettingsSource, vault: TokenStore) {
    this.#settings = settings
    this.#vault = vault
    const validationTimer = setInterval(() => void this.#scheduledValidation(), 55 * 60 * 1000)
    // In Node (the TV app), a pending validation must not keep the process alive; browsers have no unref.
    ;(validationTimer as unknown as { unref?: () => void }).unref?.()
  }

  // La cuenta, validada con Twitch (auth.snapshot): esta sí espera a la validación.
  public async identity(): Promise<StoredIdentity | undefined> {
    const revision = this.#generation
    const token = await this.#vault.load()
    if (revision !== this.#generation) throw new SessionChangedError()
    if (token === undefined) return undefined
    const fresh = await this.#fresh(token, revision)
    return (await this.#validated(fresh.token, fresh.revision)).identity
  }

  // La cuenta guardada con el token, sin preguntar a Twitch: para pedir su foto mientras se valida (TwitchService).
  public async storedLogin(): Promise<string | undefined> {
    return (await this.#vault.load())?.identity?.login
  }

  // Si la sesión cambia mientras tanto (la validación de al lado la ha renovado, u otra página), se vuelve a leer una vez:
  // con la renovada, sigue; si se ha cerrado, lo dirá #requireToken.
  public async credentials(): Promise<TwitchCredentials> {
    try {
      return await this.#currentCredentials()
    } catch (error) {
      if (!(error instanceof SessionChangedError)) throw error
      return this.#currentCredentials()
    }
  }

  public async refreshCredentials(): Promise<TwitchCredentials> {
    const revision = this.#generation
    const token = await this.#requireToken()
    if (revision !== this.#generation) throw new SessionChangedError()
    const installed = await this.#refresh(token, revision)
    const session = await this.#usable(installed.token, installed.revision)
    const clientId = await this.#requireClientId()
    if (session.revision !== this.#generation) throw new SessionChangedError()
    return { clientId, identity: session.identity, token: session.token }
  }

  // Signing in, like refreshing and signing out, waits for any other page doing one of them (exclusive).
  public async saveToken(token: StoredToken): Promise<number> {
    return (await this.#exclusive(() => this.#installToken(token, this.#generation))).revision
  }

  public async clearIfCurrent(revision: number): Promise<void> {
    if (revision === this.#generation) {
      await this.clear()
    }
  }

  public async clear(): Promise<void> {
    this.#generation += 1
    this.#identity = undefined
    await this.#exclusive(() => this.#vault.clear())
  }

  // Inside the exclusive section (refreshing): clear without taking it again.
  async #clearUnlocked(revision: number): Promise<void> {
    if (revision !== this.#generation) return
    this.#generation += 1
    this.#identity = undefined
    await this.#vault.clear()
  }

  #exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const exclusive = this.#vault.exclusive
    return exclusive === undefined ? operation() : exclusive(operation)
  }

  async #currentCredentials(): Promise<TwitchCredentials> {
    const revision = this.#generation
    const token = await this.#requireToken()
    if (revision !== this.#generation) throw new SessionChangedError()
    const session = await this.#usable(token, revision)
    const clientId = await this.#requireClientId()
    if (session.revision !== this.#generation) throw new SessionChangedError()
    return { clientId, identity: session.identity, token: session.token }
  }

  // Lo que necesita una petición a Helix. Con la cuenta guardada junto al token, no espera a validarlo: la validación va
  // a la vez (Twitch pide validar al abrir y cada hora, no que lo demás espere). Si el token ya no vale, Helix contesta
  // 401 y se renueva (TwitchService), y si tampoco se puede, la validación cierra la sesión y auth.snapshot lo dice.
  // Sin la cuenta guardada (una sesión de antes, o recién vinculada), se espera a la validación, que la guarda.
  async #usable(token: StoredToken, revision: number): Promise<ValidatedSession> {
    const fresh = await this.#fresh(token, revision)
    const stored = fresh.token.identity
    if (stored === undefined || this.#current(fresh.token, fresh.revision) !== undefined) {
      return this.#validated(fresh.token, fresh.revision)
    }
    // Sus fallos los ve quien espera la validación (identity, auth.snapshot).
    this.#validated(fresh.token, fresh.revision).catch(() => undefined)
    return { ...fresh, identity: stored }
  }

  // Un token caducado no se prueba: validarlo daría 401 y habría que renovarlo igual (una petición más al abrir).
  #fresh(token: StoredToken, revision: number): Promise<InstalledToken> {
    return isTokenExpiring(token.expiresAt, Date.now())
      ? this.#refresh(token, revision)
      : Promise.resolve({ revision, token })
  }

  // Lo validado en esta página hace menos de una hora.
  #current(token: StoredToken, revision: number): ValidatedSession | undefined {
    if (revision !== this.#generation) throw new SessionChangedError()
    const identity = this.#identity
    return identity !== undefined &&
      identity.accessToken === token.accessToken &&
      isIdentityCacheCurrent(identity.checkedAt, token.expiresAt, Date.now())
      ? { identity: identity.value, revision, token }
      : undefined
  }

  async #validated(token: StoredToken, revision: number): Promise<ValidatedSession> {
    const current = this.#current(token, revision)
    if (current !== undefined) return current
    if (this.#validating?.accessToken === token.accessToken) return this.#validating.promise
    const validating = {
      accessToken: token.accessToken,
      promise: this.#validateTokenResponse(token, true, revision),
    }
    this.#validating = validating
    const forget = (): void => {
      if (this.#validating === validating) this.#validating = undefined
    }
    validating.promise.then(forget, forget)
    return validating.promise
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
      const { login, scopes, user_id } = ValidationResponseSchema.parse(
        await response.json<unknown>(),
      )
      if (revision !== this.#generation) {
        throw new SessionChangedError()
      }
      const identity = { login, scopes, user_id }
      this.#identity = { accessToken: token.accessToken, checkedAt: Date.now(), value: identity }
      void this.#remember(token, identity, revision)
      return { identity, revision, token }
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

  // La cuenta, junto al token, para no esperar a validarlo la próxima vez que se abra (#usable). Solo si sigue siendo esta
  // sesión: otra página puede haberla renovado o cerrado mientras tanto. Si no se puede, la próxima vez se espera.
  async #remember(token: StoredToken, identity: StoredIdentity, revision: number): Promise<void> {
    if (sameIdentity(token.identity, identity)) return
    try {
      await this.#exclusive(async () => {
        const stored = await this.#vault.load()
        if (revision !== this.#generation || stored?.accessToken !== token.accessToken) return
        await this.#vault.save({ ...stored, identity })
      })
    } catch {
      // Como sin guardarla.
    }
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

  // Con varias páginas (pestañas de la extensión), una sola renueva a la vez, y cerrar o abrir sesión espera a que
  // acabe (clear y saveToken van en la misma sección exclusiva): si no, una renovación en curso volvería a guardar una
  // sesión que otra página acaba de cerrar. Al entrar, si otra ya lo renovó (o hay otra sesión), se usa ese token:
  // renovar otra vez con el token de renovación gastado daría la sesión por caducada en todas.
  #performRefresh(token: StoredToken, revision: number): Promise<InstalledToken> {
    return this.#exclusive(async () => {
      const stored = await this.#vault.load()
      if (revision !== this.#generation) throw new SessionChangedError()
      if (stored === undefined) {
        await this.#clearUnlocked(revision)
        throw new ConfigurationError("Your Twitch session expired. Sign in again")
      }
      if (stored.refreshToken !== token.refreshToken) return this.#installToken(stored, revision)
      return this.#refreshWith(token, revision)
    })
  }

  async #refreshWith(token: StoredToken, revision: number): Promise<InstalledToken> {
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
        await this.#clearUnlocked(revision)
        throw new ConfigurationError("Your Twitch session expired. Sign in again")
      }
      throw error
    }
    const response = TokenResponseSchema.parse(payload)
    if (revision !== this.#generation) {
      throw new SessionChangedError()
    }
    // Renovar no cambia la cuenta: la guardada sigue valiendo.
    const refreshed: StoredToken = {
      accessToken: response.access_token,
      expiresAt: new Date(Date.now() + response.expires_in * 1000).toISOString(),
      refreshToken: response.refresh_token,
      ...(token.identity === undefined ? {} : { identity: token.identity }),
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
