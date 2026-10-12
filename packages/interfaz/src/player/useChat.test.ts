import type { ChatMessage } from "@goodttv/contratos"
import { describe, expect, it } from "vitest"
import { applyChatEvents, CHAT_HISTORY, CHAT_MAX_HELD, ChatDelayQueue } from "./useChat"

const message = (id: string, userId = "1"): ChatMessage => ({
  action: false,
  badges: [],
  color: "#bf94ff",
  displayName: "Viewer",
  id,
  tokens: [{ kind: "text", text: id }],
  userId,
})

describe("applyChatEvents", () => {
  it("appends messages and keeps a bounded history", () => {
    const events = Array.from({ length: CHAT_HISTORY + 10 }, (_, index) => ({
      kind: "message" as const,
      message: message(String(index)),
    }))
    const state = applyChatEvents({ messages: [], status: "connected" }, events)
    expect(state.messages).toHaveLength(CHAT_HISTORY)
    expect(state.messages[0]?.id).toBe("10")
  })

  it("applies moderation in order", () => {
    const state = applyChatEvents(
      { messages: [message("a", "1"), message("b", "2")], status: "connected" },
      [
        { kind: "delete", messageId: "a" },
        { kind: "message", message: message("c", "2") },
        { kind: "clear-user", userId: "2" },
        { kind: "message", message: message("d", "3") },
      ],
    )
    expect(state.messages.map((entry) => entry.id)).toEqual(["d"])
  })

  it("clears everything and tracks the connection status", () => {
    const state = applyChatEvents({ messages: [message("a")], status: "connecting" }, [
      { kind: "clear" },
      { kind: "status", status: "reconnecting" },
    ])
    expect(state).toEqual({ messages: [], status: "reconnecting" })
  })
})

describe("ChatDelayQueue", () => {
  it("shows each batch the given delay after it arrived, in order", () => {
    let delay = 5
    const queue = new ChatDelayQueue(() => delay)
    queue.push([{ kind: "message", message: message("a") }], 0)
    queue.push([{ kind: "delete", messageId: "a" }], 1000)
    expect(queue.due(4999)).toEqual([])
    expect(queue.due(5000).map((event) => event.kind)).toEqual(["message"])
    // A shorter delay (picture catching up) releases what is now due.
    delay = 2
    expect(queue.due(3000).map((event) => event.kind)).toEqual(["delete"])
    expect(queue.due(10_000)).toEqual([])
  })

  it("drops the oldest held events past the limit (a long pause)", () => {
    const queue = new ChatDelayQueue(() => 60)
    for (let index = 0; index < CHAT_MAX_HELD + 5; index++)
      queue.push([{ kind: "message", message: message(String(index)) }], index)
    const released = queue.due(CHAT_MAX_HELD + 5 + 60_000)
    expect(released).toHaveLength(CHAT_MAX_HELD)
    expect(released[0]).toMatchObject({ message: { id: "5" } })
    // The count stays right after releasing.
    queue.push([{ kind: "clear" }], 0)
    expect(queue.due(60_000)).toEqual([{ kind: "clear" }])
  })

  it("holds everything while the delay is not known", () => {
    let delay: number | null = null
    const queue = new ChatDelayQueue(() => delay)
    queue.push([{ kind: "message", message: message("a") }], 0)
    expect(queue.due(60_000)).toEqual([])
    delay = 20
    expect(queue.due(19_999)).toEqual([])
    expect(queue.due(20_000).map((event) => event.kind)).toEqual(["message"])
  })

  it("with no delay, releases at once", () => {
    const queue = new ChatDelayQueue(() => 0)
    queue.push([{ kind: "clear" }], 100)
    expect(queue.due(100)).toEqual([{ kind: "clear" }])
  })
})
