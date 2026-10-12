import { tmpdir } from "node:os"
import { ClientIdSchema, type Page, type StreamCard } from "@goodttv/contratos"
import {
  ChatScopeError,
  ConfigurationError,
  enrichStreamProfiles,
  TwitchAuth,
  TwitchService,
} from "@goodttv/servicios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { SettingsStore } from "./settings-store"
import { TokenVault } from "./token-vault"

const makeService = (): TwitchService =>
  new TwitchService(
    new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234"),
    new TokenVault(tmpdir(), {
      backend: () => "gnome_libsecret",
      decrypt: (value) => value.toString("utf8"),
      encrypt: (value) => Buffer.from(value),
      isAvailable: () => true,
    }),
  )

const wireStream = {
  game_name: "Fortnite",
  id: "stream-1",
  started_at: "2026-09-21T12:00:00Z",
  tags: [],
  thumbnail_url: "https://static-cdn.jtvnw.net/previews/{width}x{height}.jpg",
  title: "Live match",
  user_id: "user-1",
  user_login: "player1",
  user_name: "Player1",
  viewer_count: 42,
}

const requests = vi.fn<typeof fetch>()

beforeEach(() => {
  // Ky's bounded request timeout is not the behavior under test.
  vi.useFakeTimers()
  requests.mockReset()
  vi.stubGlobal("fetch", requests)
  vi.spyOn(TwitchAuth.prototype, "credentials").mockResolvedValue({
    clientId: ClientIdSchema.parse("abcdefghijklmnopqrstuvwxyz1234"),
    identity: {
      client_id: "abcdefghijklmnopqrstuvwxyz1234",
      expires_in: 3600,
      login: "viewer",
      scopes: ["user:read:follows", "user:read:chat"],
      user_id: "viewer-id",
    },
    token: {
      accessToken: "existing-user-token",
      expiresAt: "2099-01-01T00:00:00Z",
      refreshToken: "refresh",
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const sentRequests = (): Request[] =>
  requests.mock.calls.map(([request]) => {
    if (!(request instanceof Request)) throw new TypeError("Expected a wire Request")
    return request
  })

describe.each(["live", "followed"] as const)("Twitch %s shelf pages", (endpoint) => {
  it("keeps first-page wire parameters, forwards the opaque cursor and batches broadcaster profiles", async () => {
    requests
      .mockResolvedValueOnce(
        Response.json({
          data: [
            wireStream,
            { ...wireStream, id: "stream-2", user_id: "user-2" },
            { ...wireStream, id: "stream-3" },
          ],
          pagination: { cursor: "opaque+/=cursor" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { id: "user-1", profile_image_url: "https://example.com/one.png" },
            { id: "user-2", profile_image_url: "https://example.com/two.png" },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: [], pagination: {} }))
    const service = makeService()
    const first = await service[endpoint]({ first: 20 })
    const second = await service[endpoint]({ after: first.cursor, first: 20 })
    const path = endpoint === "live" ? "streams" : "streams/followed"
    const identity = endpoint === "live" ? "" : "&user_id=viewer-id"
    expect(sentRequests().map((request) => [request.method, request.url])).toEqual([
      ["GET", `https://api.twitch.tv/helix/${path}?first=20${identity}`],
      ["GET", "https://api.twitch.tv/helix/users?id=user-1&id=user-2"],
      [
        "GET",
        `https://api.twitch.tv/helix/${path}?after=opaque%2B%2F%3Dcursor&first=20${identity}`,
      ],
    ])
    expect(first.cursor).toBe("opaque+/=cursor")
    expect(first.items.map((stream) => stream.profileImageUrl)).toEqual([
      "https://example.com/one.png",
      "https://example.com/two.png",
      "https://example.com/one.png",
    ])
    expect(second).toEqual({ cursor: undefined, items: [] })
    expect(
      sentRequests().every(
        (request) => request.headers.get("Authorization") === "Bearer existing-user-token",
      ),
    ).toBe(true)
  })
})

describe("Twitch account snapshot", () => {
  it("adds the viewer's display name and picture, asked once per login", async () => {
    vi.spyOn(TwitchAuth.prototype, "snapshot").mockResolvedValue({
      displayName: "viewer",
      kind: "authenticated",
      login: "viewer",
    })
    requests.mockResolvedValueOnce(
      Response.json({
        data: [
          {
            display_name: "Viewer",
            id: "viewer-id",
            login: "viewer",
            profile_image_url: "https://example.com/viewer.png",
          },
        ],
      }),
    )
    const service = makeService()
    const expected = {
      displayName: "Viewer",
      kind: "authenticated",
      login: "viewer",
      profileImageUrl: "https://example.com/viewer.png",
    }
    expect(await service.authSnapshot()).toEqual(expected)
    expect(await service.authSnapshot()).toEqual(expected)
    expect(sentRequests().map((request) => request.url)).toEqual([
      "https://api.twitch.tv/helix/users",
    ])
  })

  it("does not bring back an account signed out while its picture was on the way", async () => {
    const snapshot = vi
      .spyOn(TwitchAuth.prototype, "snapshot")
      .mockResolvedValueOnce({ displayName: "viewer", kind: "authenticated", login: "viewer" })
      .mockResolvedValue({ kind: "guest" })
    vi.spyOn(TwitchAuth.prototype, "logout").mockResolvedValue()
    let answer: (response: Response) => void = () => undefined
    requests.mockReturnValueOnce(new Promise<Response>((done) => (answer = done)))
    const service = makeService()
    const pending = service.authSnapshot()
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(1))
    await service.logout()
    answer(
      Response.json({
        data: [
          {
            display_name: "Viewer",
            id: "viewer-id",
            login: "viewer",
            profile_image_url: "https://example.com/viewer.png",
          },
        ],
      }),
    )
    expect(await pending).toEqual({ kind: "guest" })
    expect(snapshot).toHaveBeenCalledTimes(2)
  })

  it("ignores a picture that belongs to another account", async () => {
    vi.spyOn(TwitchAuth.prototype, "snapshot").mockResolvedValue({
      displayName: "viewer",
      kind: "authenticated",
      login: "viewer",
    })
    requests.mockResolvedValueOnce(
      Response.json({
        data: [
          {
            display_name: "Other",
            id: "other-id",
            login: "other",
            profile_image_url: "https://example.com/other.png",
          },
        ],
      }),
    )
    expect(await makeService().authSnapshot()).toEqual({
      displayName: "viewer",
      kind: "authenticated",
      login: "viewer",
    })
  })

  it("keeps the plain snapshot when Twitch does not answer, and asks again next time", async () => {
    vi.spyOn(TwitchAuth.prototype, "snapshot").mockResolvedValue({
      displayName: "viewer",
      kind: "authenticated",
      login: "viewer",
    })
    requests.mockResolvedValue(new Response("nope", { status: 500 }))
    const service = makeService()
    expect(await service.authSnapshot()).toEqual({
      displayName: "viewer",
      kind: "authenticated",
      login: "viewer",
    })
    await service.authSnapshot()
    expect(requests.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe("Twitch stream enrichment", () => {
  it("preserves streams when optional profile enrichment fails", async () => {
    // Given a valid stream page and an unavailable secondary profile request
    const streams: Page<StreamCard> = {
      cursor: "next",
      items: [
        {
          category: "Just Chatting",
          id: "123",
          startedAt: "2026-09-05T12:00:00Z",
          tags: [],
          thumbnailUrl: "https://static-cdn.jtvnw.net/previews/streamer.jpg",
          title: "A live stream",
          userId: "456",
          userLogin: "streamer",
          userName: "Streamer",
          viewerCount: 4200,
        },
      ],
    }

    // When the optional profile request is rejected
    const enriched = await enrichStreamProfiles(streams, async () => {
      throw new TypeError("Profile service unavailable")
    })

    // Then the primary stream result remains available without an avatar
    expect(enriched).toEqual(streams)
  })
})

describe("Twitch live filters and lookups", () => {
  it("filters popular streams by language", async () => {
    requests.mockResolvedValueOnce(Response.json({ data: [], pagination: {} }))
    await makeService().live({ first: 20, language: "es" })
    expect(sentRequests().map((request) => request.url)).toEqual([
      "https://api.twitch.tv/helix/streams?first=20&language=es",
    ])
  })

  it("looks up live streams for recent channels in one request", async () => {
    requests
      .mockResolvedValueOnce(Response.json({ data: [wireStream], pagination: {} }))
      .mockResolvedValueOnce(Response.json({ data: [] }))
    const streams = await makeService().streamsByLogin(["Player1", "player1", "other"])
    expect(streams.map((stream) => stream.userLogin)).toEqual(["player1"])
    expect(sentRequests()[0]?.url).toBe(
      "https://api.twitch.tv/helix/streams?first=100&user_login=player1&user_login=other",
    )
  })

  it("skips the request when there are no recent channels", async () => {
    expect(await makeService().streamsByLogin([])).toEqual([])
    expect(requests).not.toHaveBeenCalled()
  })

  it("rejects invalid logins before requesting Twitch", async () => {
    await expect(makeService().streamsByLogin(["../x"])).rejects.toBeInstanceOf(z.ZodError)
    expect(requests).not.toHaveBeenCalled()
  })
})

describe("Twitch chat support", () => {
  it("creates an EventSub subscription for the viewer and the channel", async () => {
    let body: unknown
    requests.mockImplementationOnce(async (request) => {
      body = await (request as Request).clone().json()
      return Response.json({ data: [{ id: "sub-1" }] }, { status: 202 })
    })
    const id = await makeService().createChatSubscription(
      "channel.chat.message",
      "100",
      "200",
      "session-a",
    )
    expect(id).toBe("sub-1")
    const [request] = sentRequests()
    expect(request?.method).toBe("POST")
    expect(request?.url).toBe("https://api.twitch.tv/helix/eventsub/subscriptions")
    expect(body).toEqual({
      condition: { broadcaster_user_id: "100", user_id: "200" },
      transport: { method: "websocket", session_id: "session-a" },
      type: "channel.chat.message",
      version: "1",
    })
  })

  it("refreshes the token once on 401", async () => {
    vi.spyOn(TwitchAuth.prototype, "refreshCredentials").mockResolvedValue({
      clientId: ClientIdSchema.parse("abcdefghijklmnopqrstuvwxyz1234"),
      identity: {
        client_id: "abcdefghijklmnopqrstuvwxyz1234",
        expires_in: 3600,
        login: "viewer",
        scopes: [],
        user_id: "viewer-id",
      },
      token: { accessToken: "fresh", expiresAt: "2099-01-01T00:00:00Z", refreshToken: "r" },
    })
    requests
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "sub-2" }] }, { status: 202 }))
    expect(await makeService().createChatSubscription("channel.chat.clear", "1", "2", "s")).toBe(
      "sub-2",
    )
    expect(sentRequests()[1]?.headers.get("Authorization")).toBe("Bearer fresh")
  })

  it("reports a missing chat scope as ChatScopeError", async () => {
    requests.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(
      makeService().createChatSubscription("channel.chat.message", "1", "2", "s"),
    ).rejects.toBeInstanceOf(ChatScopeError)
  })

  it("deletes subscriptions by id", async () => {
    requests.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await makeService().deleteSubscription("sub-1")
    expect(sentRequests().map((request) => [request.method, request.url])).toEqual([
      ["DELETE", "https://api.twitch.tv/helix/eventsub/subscriptions?id=sub-1"],
    ])
  })

  it("merges channel badges over global ones and caches them", async () => {
    const badgeSet = (url: string) => ({
      data: [{ set_id: "subscriber", versions: [{ id: "0", image_url_2x: url, title: "Sub" }] }],
    })
    requests
      .mockResolvedValueOnce(Response.json(badgeSet("https://static-cdn.jtvnw.net/global/2")))
      .mockResolvedValueOnce(Response.json(badgeSet("https://static-cdn.jtvnw.net/channel/2")))
    const service = makeService()
    const badges = await service.badges("100")
    await service.badges("100")
    expect(badges.get("subscriber/0")?.url).toBe("https://static-cdn.jtvnw.net/channel/2")
    expect(requests).toHaveBeenCalledTimes(2)
  })

  it("reports a signed-out viewer as undefined but lets transient failures through", async () => {
    vi.spyOn(TwitchAuth.prototype, "credentials").mockRejectedValueOnce(
      new ConfigurationError("Sign in to Twitch to browse streams"),
    )
    expect(await makeService().viewer()).toBeUndefined()
    vi.spyOn(TwitchAuth.prototype, "credentials").mockRejectedValueOnce(
      new TypeError("fetch failed"),
    )
    await expect(makeService().viewer()).rejects.toBeInstanceOf(TypeError)
  })

  it("exposes the viewer's scopes for the chat scope check", async () => {
    expect(await makeService().viewer()).toEqual({
      scopes: ["user:read:follows", "user:read:chat"],
      userId: "viewer-id",
    })
  })

  it("fails clearly when Twitch rejects a request", async () => {
    requests.mockResolvedValue(new Response(null, { status: 500 }))
    await expect(makeService().search({ query: "ibai" })).rejects.toBeInstanceOf(ConfigurationError)
  })
})
