import {
  type AuthSnapshot,
  type ChannelCard,
  type ChatBadge,
  type ChatEmote,
  type CursorInput,
  CursorInputSchema,
  type DeviceChallenge,
  type LiveInput,
  LiveInputSchema,
  LoginsInputSchema,
  type Page,
  type SearchInput,
  SearchInputSchema,
  type StreamCard,
  UserIdSchema,
} from "@goodttv/contratos"
import ky from "ky"
import { z } from "zod"
import { ChatScopeError } from "./chat/eventsub-chat"
import { type PictureStorage, ProfilePictures } from "./profile-pictures"
import type { SettingsSource } from "./settings"
import type { StoredIdentity, TokenStore } from "./tokens"
import { TwitchAuth } from "./twitch-auth"
import { ConfigurationError, TwitchRequestError } from "./twitch-errors"
import { createLiveSearchParams, shouldRefreshResponse } from "./twitch-requests"
import {
  mergeStreamProfiles,
  parseBadgesResponse,
  parseChannelsResponse,
  parseChatColorResponse,
  parseOwnUserResponse,
  parseSentChatMessage,
  parseStreamsResponse,
  parseSubscriptionResponse,
  parseUserEmotesResponse,
  parseUsersResponse,
} from "./twitch-schemas"
import type { TwitchCredentials } from "./twitch-session"

type HelixSearch = URLSearchParams | Readonly<Record<string, string | number | undefined>>
type ProfileLoader = () => Promise<ReadonlyMap<string, string>>
// The signed-in viewer's name and picture, for one login.
type ProfileEntry = {
  readonly login: string
  readonly profile: Promise<
    { readonly displayName: string; readonly profileImageUrl: string } | undefined
  >
}
type HelixRequest = {
  readonly json?: unknown
  readonly method: "delete" | "get" | "post"
  readonly path: string
  readonly search?: HelixSearch
}
// Una petición que lleva el id de la cuenta (user_id, sender_id) se arma con la de las credenciales con que sale,
// también al repetirla tras renovar: el id y el token son siempre de la misma cuenta, aunque otra página la cambie.
type AccountRequest = HelixRequest | ((identity: StoredIdentity) => HelixRequest)

export const enrichStreamProfiles = async (
  streams: Page<StreamCard>,
  loadProfiles: ProfileLoader,
): Promise<Page<StreamCard>> => {
  try {
    return mergeStreamProfiles(streams, await loadProfiles())
  } catch (error) {
    if (error instanceof Error) return streams
    throw error
  }
}

const BADGES_TTL_MS = 30 * 60_000
const USER_EMOTES_TTL_MS = 10 * 60_000
const USER_EMOTES_PAGES = 10 // con muchas suscripciones son varias páginas

const SEND_FAILURES: Readonly<Record<number, string>> = {
  401: "Vuelve a vincular la cuenta en Ajustes para escribir en el chat.",
  403: "No puedes escribir en este chat.",
  422: "El mensaje es demasiado largo.",
  429: "Vas demasiado rápido: espera un momento.",
}

export class TwitchService {
  readonly #auth: TwitchAuth
  readonly #badges = new Map<string, { at: number; badges: Promise<Map<string, ChatBadge>> }>()
  // The signed-in viewer's name and picture, asked once per login.
  #profile: ProfileEntry | undefined
  // Changes on logout and on a new sign-in: an answer asked for before belongs to another session.
  #session = 0

  readonly #colors = new Map<string, Promise<string>>()
  readonly #pictures: ProfilePictures
  readonly #userEmotes = new Map<string, { at: number; emotes: Promise<readonly ChatEmote[]> }>()

  // scopes: los que se piden al vincular (por defecto, solo lectura: la tele). pictures: dónde guardar las fotos de los
  // canales entre una página y otra (profile-pictures.ts); sin él, en memoria.
  public constructor(
    settings: SettingsSource,
    vault: TokenStore,
    options: { pictures?: PictureStorage; scopes?: string } = {},
  ) {
    this.#auth = new TwitchAuth(settings, vault, options.scopes)
    this.#pictures = new ProfilePictures(options.pictures)
  }

  public status(): { secureStorage: boolean } {
    return this.#auth.status()
  }

  public beginAuthorization(): Promise<DeviceChallenge> {
    this.#session++
    this.#profile = undefined
    return this.#auth.begin()
  }

  // With the viewer's name as shown on Twitch and their picture; without them if Twitch does not answer.
  public async authSnapshot(): Promise<AuthSnapshot> {
    const session = this.#session
    // Con la cuenta guardada junto al token, el nombre y la foto se piden ya, a la vez que se valida la sesión: Helix no
    // espera a la validación (TwitchSession). Antes se pedían después, y al abrir Inicio esperaba a las dos.
    const stored = await this.#auth.storedLogin().catch(() => undefined)
    if (stored !== undefined) this.#profileOf(stored)
    const snapshot = await this.#auth.snapshot()
    // Sin sesión, también si ha caducado (TwitchAuth ya la ha cerrado) o la ha cerrado otra página: como al cerrarla aquí.
    if (snapshot.kind === "guest" || snapshot.kind === "error") this.#forgetAccount()
    if (snapshot.kind !== "authenticated") return snapshot
    const entry = this.#profileOf(snapshot.login)
    const profile = await entry.profile
    // Signed out (or in again) meanwhile: this snapshot is stale.
    if (session !== this.#session) return this.#auth.snapshot()
    if (profile !== undefined) return { ...snapshot, ...profile }
    // A failed answer is not kept: the next snapshot asks again.
    if (this.#profile === entry) this.#profile = undefined
    // Asking for the picture may have lost the session (a 401, then a refresh that Twitch refuses clears it): check
    // again instead of showing an account that is gone (EXT-7). Usually from the cache, without asking Twitch.
    const now = await this.#auth.snapshot()
    return now.kind === "authenticated" ? snapshot : now
  }

  public logout(): Promise<void> {
    this.#badges.clear()
    this.#forgetAccount()
    return this.#auth.logout()
  }

  // Lo de esa cuenta: su nombre y su foto, y las fotos de los canales de sus listas, que dicen a quién sigue. Lo que
  // estaba en camino ya no cuenta (#session).
  #forgetAccount(): void {
    this.#pictures.clear()
    this.#session++
    this.#profile = undefined
  }

  public live(input: LiveInput): Promise<Page<StreamCard>> {
    return this.#streams(createLiveSearchParams(LiveInputSchema.parse(input)))
  }

  // Si la cuenta sigue a ese canal (SEG-1). Seguir y dejar de seguir no se puede por la API oficial (D24).
  public async follows(broadcasterId: string): Promise<boolean> {
    const id = UserIdSchema.parse(broadcasterId)
    const payload = await this.#helix((identity) => ({
      method: "get",
      path: "channels/followed",
      search: { broadcaster_id: id, user_id: identity.user_id },
    }))
    return z.object({ data: z.array(z.unknown()) }).parse(payload).data.length > 0
  }

  public async followed(input: CursorInput): Promise<Page<StreamCard>> {
    const parsed = CursorInputSchema.parse(input)
    return this.#page((identity) => ({
      method: "get",
      path: "streams/followed",
      search: { ...parsed, user_id: identity.user_id },
    }))
  }

  public async search(input: SearchInput): Promise<Page<ChannelCard>> {
    const parsed = SearchInputSchema.parse(input)
    const payload = await this.#helix({ method: "get", path: "search/channels", search: parsed })
    return parseChannelsResponse(payload)
  }

  // Live streams among the given channels, for the Recent shelf.
  public async streamsByLogin(logins: readonly string[]): Promise<readonly StreamCard[]> {
    const parsed = LoginsInputSchema.parse(logins)
    if (parsed.length === 0) return []
    const search = new URLSearchParams({ first: "100" })
    for (const login of new Set(parsed)) search.append("user_login", login)
    return (await this.#streams(search)).items
  }

  // --- Chat support. Only main uses these; none of them is exposed over IPC directly. ---

  // Undefined when nobody is signed in (or the session is gone); other failures are transient
  // and propagate so chat keeps retrying.
  public async viewer(): Promise<
    { readonly scopes: readonly string[]; readonly userId: string } | undefined
  > {
    try {
      const { identity } = await this.#auth.credentials()
      return { scopes: identity.scopes, userId: identity.user_id }
    } catch (error) {
      if (error instanceof ConfigurationError) return undefined
      throw error
    }
  }

  // Escribir en el chat con el permiso user:write:chat (CHAT-1). Lo que Twitch no envía (solo seguidores, modo lento,
  // un baneo…) vuelve con su motivo; los fallos de la petición, con uno legible.
  public async sendChatMessage(
    broadcasterId: string,
    message: string,
  ): Promise<
    | { readonly id: string; readonly login: string; readonly sent: true; readonly userId: string }
    | { readonly reason: string; readonly sent: false }
  > {
    let answer: { readonly identity: StoredIdentity; readonly payload: unknown }
    try {
      answer = await this.#helixAs((identity) => ({
        json: { broadcaster_id: broadcasterId, message, sender_id: identity.user_id },
        method: "post",
        path: "chat/messages",
      }))
    } catch (error) {
      if (!(error instanceof TwitchRequestError)) throw error
      return {
        reason: SEND_FAILURES[error.status] ?? "No se pudo enviar. Inténtalo otra vez.",
        sent: false,
      }
    }
    const { identity, payload } = answer
    const result = parseSentChatMessage(payload)
    return result.sent ? { ...result, login: identity.login, userId: identity.user_id } : result
  }

  // El color de la persona en el chat, para enseñar su mensaje como lo verá Twitch. Una vez por cuenta.
  public chatColor(userId: string): Promise<string> {
    let color = this.#colors.get(userId)
    if (color === undefined) {
      color = this.#helix({ method: "get", path: "chat/color", search: { user_id: userId } })
        .then(parseChatColorResponse)
        .catch(() => "")
      this.#colors.set(userId, color)
    }
    return color
  }

  // Los emotes de Twitch que la cuenta puede usar en ese canal (globales, de suscripciones y de seguidor), para elegirlos
  // al escribir (CHAT-1, con user:read:emotes). Sin el permiso (vinculada antes de CHAT-1), ninguno.
  public async userEmotes(broadcasterId: string): Promise<readonly ChatEmote[]> {
    const id = UserIdSchema.parse(broadcasterId)
    const { identity } = await this.#auth.credentials()
    if (!identity.scopes.includes("user:read:emotes")) return []
    const key = `${identity.user_id}/${id}`
    const cached = this.#userEmotes.get(key)
    if (cached !== undefined && Date.now() - cached.at < USER_EMOTES_TTL_MS) return cached.emotes
    const emotes = (async () => {
      const found = new Map<string, ChatEmote>()
      let after: string | undefined
      for (let page = 0; page < USER_EMOTES_PAGES; page++) {
        const payload = await this.#helix((current) => ({
          method: "get",
          path: "chat/emotes/user",
          search: { after, broadcaster_id: id, user_id: current.user_id },
        }))
        const parsed = parseUserEmotesResponse(payload)
        for (const emote of parsed.emotes) if (!found.has(emote.name)) found.set(emote.name, emote)
        after = parsed.cursor
        if (after === undefined) break
      }
      return [...found.values()]
    })()
    emotes.catch(() => this.#userEmotes.delete(key))
    this.#userEmotes.set(key, { at: Date.now(), emotes })
    return emotes
  }

  public badges(broadcasterId: string): Promise<ReadonlyMap<string, ChatBadge>> {
    const id = UserIdSchema.parse(broadcasterId)
    const cached = this.#badges.get(id)
    if (cached !== undefined && Date.now() - cached.at < BADGES_TTL_MS) return cached.badges
    const badges = Promise.all([
      this.#helix({ method: "get", path: "chat/badges/global" }),
      this.#helix({ method: "get", path: "chat/badges", search: { broadcaster_id: id } }),
    ]).then(([global, channel]) => {
      // Channel badges (subscriber months, custom bits) replace the global defaults.
      const merged = parseBadgesResponse(global)
      for (const [key, badge] of parseBadgesResponse(channel)) merged.set(key, badge)
      return merged
    })
    badges.catch(() => this.#badges.delete(id))
    this.#badges.set(id, { at: Date.now(), badges })
    return badges
  }

  public async createChatSubscription(
    type: string,
    broadcasterId: string,
    userId: string,
    sessionId: string,
  ): Promise<string> {
    const payload = await this.#helix({
      json: {
        condition: {
          broadcaster_user_id: UserIdSchema.parse(broadcasterId),
          user_id: UserIdSchema.parse(userId),
        },
        transport: { method: "websocket", session_id: sessionId },
        type,
        version: "1",
      },
      method: "post",
      path: "eventsub/subscriptions",
    })
    return parseSubscriptionResponse(payload)
  }

  public async deleteSubscription(subscriptionId: string): Promise<void> {
    await this.#helix({
      method: "delete",
      path: "eventsub/subscriptions",
      search: { id: subscriptionId },
    })
  }

  // The name and picture of that account, asked once per login. Only an answer about this same account counts.
  #profileOf(login: string): ProfileEntry {
    let entry = this.#profile
    if (entry?.login !== login) {
      const profile = this.#helix({ method: "get", path: "users" })
        .then(parseOwnUserResponse)
        .then((user) =>
          user?.login === login
            ? { displayName: user.displayName, profileImageUrl: user.profileImageUrl }
            : undefined,
        )
        .catch(() => undefined)
      entry = { login, profile }
      this.#profile = entry
    }
    return entry
  }

  // Con las fotos que ya se tienen (profile-pictures.ts); a Twitch solo se piden las que faltan, y esas se esperan: si no,
  // saldrían las iniciales hasta el siguiente refresco. Pasa la primera vez que sale un canal.
  async #page(request: AccountRequest): Promise<Page<StreamCard>> {
    const session = this.#session
    const streams = parseStreamsResponse(await this.#helix(request))
    const userIds = new Set(streams.items.map((stream) => stream.userId))
    const known = this.#pictures.known(userIds)
    const withKnown = mergeStreamProfiles(streams, known)
    const missing = [...userIds].filter((userId) => !known.has(userId))
    if (missing.length === 0) return withKnown
    const userSearch = new URLSearchParams()
    for (const userId of missing) userSearch.append("id", userId)
    return enrichStreamProfiles(withKnown, async () => {
      const pictures = parseUsersResponse(
        await this.#helix({ method: "get", path: "users", search: userSearch }),
      )
      // Si se ha cerrado la sesión mientras tanto, no vuelven a guardarse.
      if (session === this.#session) this.#pictures.add(pictures)
      return pictures
    })
  }

  #streams(search: HelixSearch): Promise<Page<StreamCard>> {
    return this.#page({ method: "get", path: "streams", search })
  }

  async #helix(request: AccountRequest): Promise<unknown> {
    return (await this.#helixAs(request)).payload
  }

  // La respuesta, con la cuenta con que se pidió.
  async #helixAs(
    request: AccountRequest,
  ): Promise<{ readonly identity: StoredIdentity; readonly payload: unknown }> {
    const build = (identity: StoredIdentity): HelixRequest =>
      typeof request === "function" ? request(identity) : request
    let credentials = await this.#auth.credentials()
    let built = build(credentials.identity)
    let response = await this.#request(built, credentials)
    if (shouldRefreshResponse(response.status)) {
      credentials = await this.#auth.refreshCredentials()
      built = build(credentials.identity)
      response = await this.#request(built, credentials)
    }
    if (response.status === 403 && built.path === "eventsub/subscriptions") {
      throw new ChatScopeError()
    }
    if (!response.ok) {
      throw new TwitchRequestError(response.status)
    }
    const payload = response.status === 204 ? undefined : await response.json()
    return { identity: credentials.identity, payload }
  }

  #request(request: HelixRequest, credentials: TwitchCredentials): Promise<Response> {
    return ky(`https://api.twitch.tv/helix/${request.path}`, {
      headers: {
        Authorization: `Bearer ${credentials.token.accessToken}`,
        "Client-Id": credentials.clientId,
      },
      ...(request.json === undefined ? {} : { json: request.json }),
      method: request.method,
      ...(request.search === undefined ? {} : { searchParams: request.search }),
      retry: request.method === "get" ? 2 : 0,
      throwHttpErrors: false,
      timeout: 15_000,
    })
  }
}
