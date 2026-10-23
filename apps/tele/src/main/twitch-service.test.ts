import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type AuthSnapshot, ClientIdSchema, type Page, type StreamCard } from "@goodttv/contratos"
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

  it("does not keep an account whose session was lost while asking for its picture (EXT-7)", async () => {
    // validate 200 (the first snapshot), users 401, and Twitch refuses the refresh: the session is cleared.
    vi.spyOn(TwitchAuth.prototype, "snapshot")
      .mockResolvedValueOnce({ displayName: "viewer", kind: "authenticated", login: "viewer" })
      .mockResolvedValue({ kind: "guest" })
    vi.spyOn(TwitchAuth.prototype, "refreshCredentials").mockRejectedValue(
      new ConfigurationError("Your Twitch session expired. Sign in again"),
    )
    requests.mockResolvedValueOnce(new Response(null, { status: 401 }))
    expect(await makeService().authSnapshot()).toEqual({ kind: "guest" })
  })

  it("EXT-7 con la sesión de verdad: validar 200, la foto 401 y renovar 400 no deja la cuenta", async () => {
    vi.mocked(TwitchAuth.prototype.credentials).mockRestore()
    const directory = await mkdtemp(join(tmpdir(), "goodttv-ext7-"))
    try {
      const vault = new TokenVault(directory, {
        backend: () => "gnome_libsecret",
        decrypt: (value) => value.toString("utf8"),
        encrypt: (value) => Buffer.from(value),
        isAvailable: () => true,
      })
      await vault.save({
        accessToken: "access",
        expiresAt: "2099-01-01T00:00:00.000Z",
        identity: { login: "viewer", scopes: ["user:read:follows"], user_id: "viewer-id" },
        refreshToken: "refresh",
      })
      requests.mockImplementation(async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.pathname === "/oauth2/validate") {
          return Response.json({
            client_id: "abcdefghijklmnopqrstuvwxyz1234",
            expires_in: 14_000,
            login: "viewer",
            scopes: ["user:read:follows"],
            user_id: "viewer-id",
          })
        }
        if (url.pathname === "/oauth2/token") return Response.json({ status: 400 }, { status: 400 })
        if (url.pathname === "/oauth2/revoke") return new Response(null, { status: 200 })
        return new Response(null, { status: 401 })
      })
      const service = new TwitchService(
        new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234"),
        vault,
      )
      expect((await service.authSnapshot()).kind).not.toBe("authenticated")
      expect(await vault.load()).toBeUndefined()
      // Por el camino de la ficha: la foto (users) dio 401 y Twitch rechazó la renovación.
      const paths = sentRequests().map((request) => new URL(request.url).pathname)
      expect(paths).toEqual(expect.arrayContaining(["/helix/users", "/oauth2/token"]))
    } finally {
      await rm(directory, { force: true, maxRetries: 5, recursive: true, retryDelay: 20 })
    }
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

describe("Al abrir, sin esperas en cadena", () => {
  it("con la cuenta guardada, pide su foto a la vez que se valida la sesión", async () => {
    vi.spyOn(TwitchAuth.prototype, "storedLogin").mockResolvedValue("viewer")
    let validated: (snapshot: AuthSnapshot) => void = () => undefined
    vi.spyOn(TwitchAuth.prototype, "snapshot").mockReturnValue(
      new Promise((done) => (validated = done)),
    )
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
    const pending = makeService().authSnapshot()
    // La foto ya se ha pedido, y la validación aún no ha contestado.
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(1))
    validated({ displayName: "viewer", kind: "authenticated", login: "viewer" })
    expect(await pending).toMatchObject({ profileImageUrl: "https://example.com/viewer.png" })
    expect(requests).toHaveBeenCalledTimes(1)
  })

  it("las fotos de los canales: las que ya tiene no las pide otra vez, y de las nuevas solo esas", async () => {
    const page = (ids: readonly string[]) =>
      Response.json({
        data: ids.map((id) => ({ ...wireStream, id: `s-${id}`, user_id: id })),
        pagination: {},
      })
    const users = (ids: readonly string[]) =>
      Response.json({
        data: ids.map((id) => ({ id, profile_image_url: `https://example.com/${id}.png` })),
      })
    requests
      .mockResolvedValueOnce(page(["a", "b"]))
      .mockResolvedValueOnce(users(["a", "b"]))
      .mockResolvedValueOnce(page(["a", "b"]))
      .mockResolvedValueOnce(page(["b", "c"]))
      .mockResolvedValueOnce(users(["c"]))
    const service = makeService()
    await service.live({ first: 24 })
    const again = await service.live({ first: 24 })
    const next = await service.live({ first: 24 })
    expect(sentRequests().map((request) => new URL(request.url).search)).toEqual([
      "?first=24",
      "?id=a&id=b",
      "?first=24",
      "?first=24",
      "?id=c",
    ])
    expect(again.items.map((stream) => stream.profileImageUrl)).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ])
    expect(next.items.map((stream) => stream.profileImageUrl)).toEqual([
      "https://example.com/b.png",
      "https://example.com/c.png",
    ])
  })

  it("si no llegan las que faltan, conserva las que ya tenía", async () => {
    requests
      .mockResolvedValueOnce(Response.json({ data: [wireStream], pagination: {} }))
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "user-1", profile_image_url: "https://example.com/one.png" }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [wireStream, { ...wireStream, id: "stream-2", user_id: "user-2" }],
          pagination: {},
        }),
      )
      .mockResolvedValue(new Response("nope", { status: 500 }))
    const service = makeService()
    await service.live({ first: 24 })
    const page = await service.live({ first: 24 })
    expect(page.items.map((stream) => stream.profileImageUrl)).toEqual([
      "https://example.com/one.png",
      undefined,
    ])
  })
})

describe("La cuenta de cada petición y las fotos al perder la sesión", () => {
  it("tras renovar, la petición se repite con el id de la cuenta del token nuevo", async () => {
    vi.spyOn(TwitchAuth.prototype, "refreshCredentials").mockResolvedValue({
      clientId: ClientIdSchema.parse("abcdefghijklmnopqrstuvwxyz1234"),
      identity: { login: "otra", scopes: [], user_id: "otra-id" },
      token: { accessToken: "otra-token", expiresAt: "2099-01-01T00:00:00Z", refreshToken: "r" },
    })
    requests
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: [], pagination: {} }))
    await makeService().followed({ first: 100 })
    const [first, second] = sentRequests()
    expect(new URL(first?.url ?? "").searchParams.get("user_id")).toBe("viewer-id")
    expect(new URL(second?.url ?? "").searchParams.get("user_id")).toBe("otra-id")
    expect(second?.headers.get("Authorization")).toBe("Bearer otra-token")
  })

  const memoryStorage = () => {
    const items = new Map<string, string>()
    return {
      getItem: (key: string) => items.get(key) ?? null,
      items,
      removeItem: (key: string) => void items.delete(key),
      setItem: (key: string, value: string) => void items.set(key, value),
    }
  }
  const pictureService = (storage: ReturnType<typeof memoryStorage>) =>
    new TwitchService(
      new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234"),
      new TokenVault(tmpdir(), {
        backend: () => "gnome_libsecret",
        decrypt: (value) => value.toString("utf8"),
        encrypt: (value) => Buffer.from(value),
        isAvailable: () => true,
      }),
      { pictures: storage },
    )

  it("las fotos que llegan después de cerrar sesión no vuelven a guardarse", async () => {
    vi.spyOn(TwitchAuth.prototype, "logout").mockResolvedValue()
    let answer: (response: Response) => void = () => undefined
    requests
      .mockResolvedValueOnce(Response.json({ data: [wireStream], pagination: {} }))
      .mockReturnValueOnce(new Promise<Response>((done) => (answer = done)))
    const storage = memoryStorage()
    const service = pictureService(storage)
    const pending = service.live({ first: 24 })
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(2))
    await service.logout()
    answer(
      Response.json({ data: [{ id: "user-1", profile_image_url: "https://example.com/one.png" }] }),
    )
    await pending
    expect(storage.items.has("fotos")).toBe(false)
  })

  it("si la sesión se pierde sin cerrarla aquí (caducada, u otra página), las fotos se olvidan", async () => {
    vi.spyOn(TwitchAuth.prototype, "snapshot").mockResolvedValue({
      kind: "error",
      message: "Your Twitch session expired. Sign in again",
    })
    const storage = memoryStorage()
    storage.setItem("fotos", JSON.stringify({ fotos: {}, version: 1 }))
    await pictureService(storage).authSnapshot()
    expect(storage.items.has("fotos")).toBe(false)
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

describe("Escribir en el chat y saber si sigues un canal (CHAT-1, SEG-1)", () => {
  it("envía como la persona de la sesión y devuelve el id", async () => {
    let body: unknown
    requests.mockImplementationOnce(async (request) => {
      body = await (request as Request).clone().json()
      return Response.json({ data: [{ drop_reason: null, is_sent: true, message_id: "m-1" }] })
    })
    expect(await makeService().sendChatMessage("42", "hola")).toEqual({
      id: "m-1",
      login: "viewer",
      sent: true,
      userId: "viewer-id",
    })
    const [request] = sentRequests()
    expect(request?.method).toBe("POST")
    expect(request?.url).toBe("https://api.twitch.tv/helix/chat/messages")
    expect(body).toEqual({ broadcaster_id: "42", message: "hola", sender_id: "viewer-id" })
  })

  it("si Twitch no lo envía, da su motivo", async () => {
    requests.mockResolvedValueOnce(
      Response.json({
        data: [
          {
            drop_reason: {
              code: "followers_only_mode",
              message: "Este chat es solo para seguidores.",
            },
            is_sent: false,
            message_id: "",
          },
        ],
      }),
    )
    expect(await makeService().sendChatMessage("42", "hola")).toEqual({
      reason: "Este chat es solo para seguidores.",
      sent: false,
    })
  })

  it("un 403 o un 429 dan un motivo legible", async () => {
    requests.mockResolvedValueOnce(new Response(null, { status: 403 }))
    expect(await makeService().sendChatMessage("42", "hola")).toEqual({
      reason: "No puedes escribir en este chat.",
      sent: false,
    })
    requests.mockResolvedValueOnce(new Response(null, { status: 429 }))
    expect(await makeService().sendChatMessage("42", "hola")).toMatchObject({ sent: false })
  })

  it("sabe si la cuenta sigue al canal", async () => {
    requests
      .mockResolvedValueOnce(Response.json({ data: [{ broadcaster_id: "42" }], total: 1 }))
      .mockResolvedValueOnce(Response.json({ data: [], total: 0 }))
    const service = makeService()
    expect(await service.follows("42")).toBe(true)
    expect(await service.follows("43")).toBe(false)
    expect(sentRequests()[0]?.url).toBe(
      "https://api.twitch.tv/helix/channels/followed?broadcaster_id=42&user_id=viewer-id",
    )
  })
})

describe("Los emotes de Twitch de la cuenta (CHAT-1)", () => {
  const withEmotesScope = (): void => {
    vi.spyOn(TwitchAuth.prototype, "credentials").mockResolvedValue({
      clientId: ClientIdSchema.parse("abcdefghijklmnopqrstuvwxyz1234"),
      identity: {
        login: "viewer",
        scopes: ["user:read:emotes"],
        user_id: "viewer-id",
      },
      token: {
        accessToken: "existing-user-token",
        expiresAt: "2099-01-01T00:00:00Z",
        refreshToken: "refresh",
      },
    })
  }

  it("pide todas las páginas, sin los smilies ni nombres repetidos, y una vez por canal", async () => {
    withEmotesScope()
    requests
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { emote_type: "subscriptions", id: "emotesv2_abc", name: "canalHype" },
            { emote_type: "smilies", id: "1", name: ":)" },
          ],
          pagination: { cursor: "siguiente" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { emote_type: "globals", id: "25", name: "Kappa" },
            { emote_type: "follower", id: "emotesv2_def", name: "canalHype" },
          ],
          pagination: {},
        }),
      )
    const service = makeService()
    const emotes = await service.userEmotes("42")
    expect(emotes.map((emote) => emote.name)).toEqual(["canalHype", "Kappa"])
    expect(emotes[1]).toEqual({
      name: "Kappa",
      provider: "twitch",
      url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0",
      zeroWidth: false,
    })
    expect(sentRequests().map((request) => request.url)).toEqual([
      "https://api.twitch.tv/helix/chat/emotes/user?broadcaster_id=42&user_id=viewer-id",
      "https://api.twitch.tv/helix/chat/emotes/user?after=siguiente&broadcaster_id=42&user_id=viewer-id",
    ])
    await service.userEmotes("42")
    expect(requests).toHaveBeenCalledTimes(2)
  })

  it("sin el permiso (vinculada antes de CHAT-1), ninguno y sin preguntar", async () => {
    expect(await makeService().userEmotes("42")).toEqual([])
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
