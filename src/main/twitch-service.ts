import ky from "ky"
import type { ChatBadge } from "../shared/chat"
import type {
  AuthSnapshot,
  ChannelCard,
  CursorInput,
  DeviceChallenge,
  LiveInput,
  Page,
  SearchInput,
  StreamCard,
} from "../shared/contracts"
import {
  CursorInputSchema,
  LiveInputSchema,
  LoginsInputSchema,
  SearchInputSchema,
  UserIdSchema,
} from "../shared/contracts"
import { ChatScopeError } from "./chat/eventsub-chat"
import type { SettingsStore } from "./settings-store"
import type { TokenVault } from "./token-vault"
import { TwitchAuth } from "./twitch-auth"
import { ConfigurationError } from "./twitch-errors"
import { createLiveSearchParams, shouldRefreshResponse } from "./twitch-requests"
import {
  mergeStreamProfiles,
  parseBadgesResponse,
  parseChannelsResponse,
  parseStreamsResponse,
  parseSubscriptionResponse,
  parseUsersResponse,
} from "./twitch-schemas"
import type { TwitchCredentials } from "./twitch-session"

type HelixSearch = URLSearchParams | Readonly<Record<string, string | number | undefined>>
type ProfileLoader = () => Promise<ReadonlyMap<string, string>>
type HelixRequest = {
  readonly json?: unknown
  readonly method: "delete" | "get" | "post"
  readonly path: string
  readonly search?: HelixSearch
}

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

export class TwitchService {
  readonly #auth: TwitchAuth
  readonly #badges = new Map<string, { at: number; badges: Promise<Map<string, ChatBadge>> }>()

  public constructor(settings: SettingsStore, vault: TokenVault) {
    this.#auth = new TwitchAuth(settings, vault)
  }

  public status(): { secureStorage: boolean } {
    return this.#auth.status()
  }

  public beginAuthorization(): Promise<DeviceChallenge> {
    return this.#auth.begin()
  }

  public authSnapshot(): Promise<AuthSnapshot> {
    return this.#auth.snapshot()
  }

  public logout(): Promise<void> {
    this.#badges.clear()
    return this.#auth.logout()
  }

  public live(input: LiveInput): Promise<Page<StreamCard>> {
    return this.#streams(createLiveSearchParams(LiveInputSchema.parse(input)))
  }

  public async followed(input: CursorInput): Promise<Page<StreamCard>> {
    const parsed = CursorInputSchema.parse(input)
    const { identity } = await this.#auth.credentials()
    return this.#page("streams/followed", { ...parsed, user_id: identity.user_id })
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

  async #page(path: string, search: HelixSearch): Promise<Page<StreamCard>> {
    const streams = parseStreamsResponse(await this.#helix({ method: "get", path, search }))
    if (streams.items.length === 0) return streams
    const userSearch = new URLSearchParams()
    for (const userId of new Set(streams.items.map((stream) => stream.userId))) {
      userSearch.append("id", userId)
    }
    return enrichStreamProfiles(streams, async () =>
      parseUsersResponse(await this.#helix({ method: "get", path: "users", search: userSearch })),
    )
  }

  #streams(search: HelixSearch): Promise<Page<StreamCard>> {
    return this.#page("streams", search)
  }

  async #helix(request: HelixRequest): Promise<unknown> {
    let credentials = await this.#auth.credentials()
    let response = await this.#request(request, credentials)
    if (shouldRefreshResponse(response.status)) {
      credentials = await this.#auth.refreshCredentials()
      response = await this.#request(request, credentials)
    }
    if (response.status === 403 && request.path === "eventsub/subscriptions") {
      throw new ChatScopeError()
    }
    if (!response.ok) {
      throw new ConfigurationError(`Twitch request failed (${response.status})`)
    }
    return response.status === 204 ? undefined : await response.json()
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
