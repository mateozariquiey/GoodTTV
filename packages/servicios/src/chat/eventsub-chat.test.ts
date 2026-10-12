import type { ChatBatch, ChatEmote } from "@goodttv/contratos"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type ChatApi, ChatScopeError, type ChatSocket, EventSubChat } from "./eventsub-chat"

class FakeSocket implements ChatSocket {
  readonly listeners = new Map<string, ((event: { readonly data?: unknown }) => void)[]>()
  closed = false
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: { readonly data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const listener of this.listeners.get("close") ?? []) listener({})
  }
  send(message: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: JSON.stringify(message) })
    }
  }
}

const welcome = (id: string, reconnectUrl?: string) => ({
  metadata: { message_type: reconnectUrl === undefined ? "session_welcome" : "session_reconnect" },
  payload: {
    session: { id, keepalive_timeout_seconds: 30, reconnect_url: reconnectUrl ?? null },
  },
})

const chatMessage = (broadcasterId: string, id: string, text: string) => ({
  metadata: { message_type: "notification", subscription_type: "channel.chat.message" },
  payload: {
    event: {
      badges: [{ id: "1", info: "", set_id: "moderator" }],
      broadcaster_user_id: broadcasterId,
      chatter_user_id: "42",
      chatter_user_login: "viewer",
      chatter_user_name: "Viewer",
      color: "#1E90FF",
      message: { fragments: [{ emote: null, text, type: "text" }], text },
      message_id: id,
      reply: null,
    },
  },
})

const notification = (type: string, event: Record<string, unknown>) => ({
  metadata: { message_type: "notification", subscription_type: type },
  payload: { event },
})

const catJam: ChatEmote = {
  name: "catJAM",
  provider: "7tv",
  url: "https://cdn.7tv.app/emote/x/2x.webp",
  zeroWidth: false,
}

const setup = (overrides: Partial<ChatApi> = {}) => {
  const sockets: FakeSocket[] = []
  const batches: ChatBatch[] = []
  let subscriptionIds = 0
  const api = {
    badges: vi.fn(
      async () =>
        new Map([
          [
            "moderator/1",
            { title: "Moderador", url: "https://static-cdn.jtvnw.net/badges/v1/mod/2" },
          ],
        ]),
    ),
    emotes: vi.fn(async () => new Map([["catJAM", catJam]])),
    subscribe: vi.fn(async () => {
      subscriptionIds += 1
      return `sub-${subscriptionIds}`
    }),
    unsubscribe: vi.fn(async () => undefined),
    viewer: vi.fn(async () => ({ scopes: ["user:read:follows", "user:read:chat"], userId: "7" })),
    ...overrides,
  } satisfies ChatApi
  const chat = new EventSubChat({
    api,
    createSocket: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    emit: (batch) => batches.push(batch),
  })
  const events = () => batches.flatMap((batch) => batch.events)
  return { api, batches, chat, events, sockets }
}

const tick = () => vi.advanceTimersByTimeAsync(150)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("EventSubChat", () => {
  it("subscribes to the channel after the welcome and reports connected", async () => {
    const { api, chat, events, sockets } = setup()
    chat.open("100")
    await tick()
    expect(sockets).toHaveLength(1)
    sockets[0]?.send(welcome("session-a"))
    await tick()
    expect(api.subscribe).toHaveBeenCalledTimes(4)
    expect(api.subscribe).toHaveBeenCalledWith("channel.chat.message", "100", "7", "session-a")
    expect(events().map((event) => event.kind === "status" && event.status)).toEqual([
      "connecting",
      "connected",
    ])
  })

  it("delivers tokenized messages with readable colours and badges", async () => {
    const { chat, events, sockets } = setup()
    const session = chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    sockets[0]?.send(chatMessage("100", "m1", "hola catJAM"))
    await tick()
    const message = events().find((event) => event.kind === "message")
    expect(message).toMatchObject({
      kind: "message",
      message: {
        badges: [{ title: "Moderador" }],
        displayName: "Viewer",
        id: "m1",
        tokens: [
          { kind: "text", text: "hola " },
          { emote: catJam, kind: "emote", overlays: [] },
        ],
      },
    })
    expect(message?.kind === "message" && message.message.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(session).toBeGreaterThan(0)
  })

  it("maps moderation events and ignores other channels", async () => {
    const { chat, events, sockets } = setup()
    chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    sockets[0]?.send(chatMessage("999", "other", "no"))
    sockets[0]?.send(
      notification("channel.chat.message_delete", { broadcaster_user_id: "100", message_id: "m1" }),
    )
    sockets[0]?.send(
      notification("channel.chat.clear_user_messages", {
        broadcaster_user_id: "100",
        target_user_id: "42",
      }),
    )
    sockets[0]?.send(notification("channel.chat.clear", { broadcaster_user_id: "100" }))
    await tick()
    expect(events().filter((event) => event.kind !== "status")).toEqual([
      { kind: "delete", messageId: "m1" },
      { kind: "clear-user", userId: "42" },
      { kind: "clear" },
    ])
  })

  it("swaps subscriptions on the same socket when the channel changes", async () => {
    const { api, batches, chat, sockets } = setup()
    const first = chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    const second = chat.open("200")
    await tick()
    expect(sockets).toHaveLength(1)
    expect(api.unsubscribe).toHaveBeenCalledTimes(4)
    expect(api.subscribe).toHaveBeenLastCalledWith("channel.chat.clear", "200", "7", "session-a")
    sockets[0]?.send(chatMessage("100", "late", "old channel"))
    sockets[0]?.send(chatMessage("200", "new", "new channel"))
    await tick()
    const messages = batches
      .filter((batch) => batch.session === second)
      .flatMap((batch) => batch.events)
      .filter((event) => event.kind === "message")
    expect(messages.map((event) => event.kind === "message" && event.message.id)).toEqual(["new"])
    expect(second).toBeGreaterThan(first)
  })

  it("asks to re-link when the token lacks the chat scope", async () => {
    const { chat, events, sockets } = setup({
      viewer: vi.fn(async () => ({ scopes: ["user:read:follows"], userId: "7" })),
    })
    chat.open("100")
    await tick()
    expect(sockets).toHaveLength(0)
    expect(events().at(-1)).toEqual({ kind: "status", status: "missing-scope" })
  })

  it("reports a missing session without opening a socket", async () => {
    const { chat, events, sockets } = setup({ viewer: vi.fn(async () => undefined) })
    chat.open("100")
    await tick()
    expect(sockets).toHaveLength(0)
    expect(events().at(-1)).toEqual({ kind: "status", status: "unauthenticated" })
  })

  it("reports a scope rejection from Twitch", async () => {
    const { chat, events, sockets } = setup({
      subscribe: vi.fn(async () => {
        throw new ChatScopeError()
      }),
    })
    chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    expect(events().at(-1)).toEqual({ kind: "status", status: "missing-scope" })
  })

  it("follows a session_reconnect without resubscribing", async () => {
    const { api, chat, sockets } = setup()
    chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    sockets[0]?.send(welcome("session-a", "wss://eventsub.wss.twitch.tv/ws?reconnect=1"))
    expect(sockets[1]?.url).toBe("wss://eventsub.wss.twitch.tv/ws?reconnect=1")
    sockets[1]?.send(welcome("session-b"))
    await tick()
    expect(sockets[0]?.closed).toBe(true)
    expect(api.subscribe).toHaveBeenCalledTimes(4)
  })

  it("reconnects and resubscribes after the socket drops", async () => {
    const { api, chat, events, sockets } = setup()
    chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    sockets[0]?.close()
    await tick()
    expect(events().at(-1)).toEqual({ kind: "status", status: "reconnecting" })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(2)
    sockets[1]?.send(welcome("session-b"))
    await tick()
    expect(api.subscribe).toHaveBeenLastCalledWith("channel.chat.clear", "100", "7", "session-b")
  })

  it("treats keepalive silence as a dead connection", async () => {
    const { chat, sockets } = setup()
    chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    await vi.advanceTimersByTimeAsync(41_000)
    expect(sockets[0]?.closed).toBe(true)
  })

  it("stops reading and drops subscriptions on close", async () => {
    const { api, batches, chat, sockets } = setup()
    chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    chat.close()
    const before = batches.length
    sockets[0]?.send(chatMessage("100", "after", "late"))
    await tick()
    expect(api.unsubscribe).toHaveBeenCalledTimes(4)
    expect(sockets[0]?.closed).toBe(true)
    expect(batches).toHaveLength(before)
  })
})

describe("EventSubChat lifecycle edge cases", () => {
  it("keeps retrying when the session cannot be validated for a moment", async () => {
    const viewer = vi
      .fn<ChatApi["viewer"]>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue({ scopes: ["user:read:chat"], userId: "7" })
    const { chat, events, sockets } = setup({ viewer })
    chat.open("100")
    await tick()
    expect(events().at(-1)).toEqual({ kind: "status", status: "reconnecting" })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(1)
  })

  it("never lets a pending reconnect revive chat after it was closed", async () => {
    const { batches, chat, sockets } = setup()
    chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    sockets[0]?.send(welcome("session-a", "wss://eventsub.wss.twitch.tv/ws?reconnect=1"))
    chat.close()
    expect(sockets[1]?.closed).toBe(true)
    const before = batches.length
    sockets[1]?.send(welcome("session-b"))
    sockets[1]?.send(chatMessage("100", "ghost", "boo"))
    await tick()
    expect(batches).toHaveLength(before)
  })

  it("removes a partial set of subscriptions when one of them fails", async () => {
    let calls = 0
    const subscribe = vi.fn(async () => {
      calls += 1
      if (calls === 3) throw new Error("500")
      return `sub-${calls}`
    })
    const unsubscribe = vi.fn(async (_id: string) => undefined)
    const { chat, events, sockets } = setup({ subscribe, unsubscribe })
    chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    expect(unsubscribe.mock.calls.map(([id]) => id).sort()).toEqual(["sub-1", "sub-2", "sub-4"])
    expect(events().at(-1)).toEqual({ kind: "status", status: "reconnecting" })
    expect(sockets[0]?.closed).toBe(true)
  })

  it("closes the connection when Twitch rejects the chat scope", async () => {
    const { chat, sockets } = setup({
      subscribe: vi.fn(async () => {
        throw new ChatScopeError()
      }),
    })
    chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    expect(sockets[0]?.closed).toBe(true)
  })

  it("bounds the work queued while emotes are still loading", async () => {
    let release: () => void = () => undefined
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    const { chat, events, sockets } = setup({
      emotes: vi.fn(async () => {
        await slow
        return new Map<string, ChatEmote>()
      }),
    })
    chat.open("100")
    await tick()
    sockets[0]?.send(welcome("session-a"))
    await tick()
    for (let index = 0; index < 1_000; index += 1) {
      sockets[0]?.send(chatMessage("100", `m${index}`, "spam"))
    }
    sockets[0]?.send(
      notification("channel.chat.message_delete", { broadcaster_user_id: "100", message_id: "m1" }),
    )
    release()
    for (let step = 0; step < 10; step += 1) await tick()
    const delivered = events()
    expect(delivered.filter((event) => event.kind === "message").length).toBeLessThanOrEqual(300)
    expect(delivered).toContainEqual({ kind: "delete", messageId: "m1" })
  })
})
