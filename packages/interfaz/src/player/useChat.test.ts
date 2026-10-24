import type { ChatMessage } from "@goodttv/contratos"
import { describe, expect, it } from "vitest"
import {
  applyChatEvents,
  CHAT_HISTORY,
  CHAT_MAX_HELD,
  CHAT_TRIM,
  ChatDelayQueue,
  chatWindowStart,
} from "./useChat"

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
    const events = Array.from({ length: CHAT_HISTORY + CHAT_TRIM + 10 }, (_, index) => ({
      kind: "message" as const,
      message: message(String(index)),
    }))
    const state = applyChatEvents({ messages: [], status: "connected" }, events)
    expect(state.messages).toHaveLength(CHAT_HISTORY)
    expect(state.messages[0]?.id).toBe(String(CHAT_TRIM + 10))
  })

  it("drops the oldest messages in batches, so the ones shown stay in place", () => {
    const events = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        kind: "message" as const,
        message: message(String(from + index)),
      }))
    let state = applyChatEvents({ messages: [], status: "connected" }, events(0, CHAT_HISTORY))
    // Each new message used to push the first one out; now the first stays until CHAT_TRIM more have arrived.
    for (let n = CHAT_HISTORY; n < CHAT_HISTORY + CHAT_TRIM; n++) {
      state = applyChatEvents(state, events(n, 1))
      expect(state.messages[0]?.id).toBe("0")
    }
    expect(state.messages).toHaveLength(CHAT_HISTORY + CHAT_TRIM)
    state = applyChatEvents(state, events(CHAT_HISTORY + CHAT_TRIM, 1))
    expect(state.messages).toHaveLength(CHAT_HISTORY)
    expect(state.messages.at(-1)?.id).toBe(String(CHAT_HISTORY + CHAT_TRIM))
  })

  it("puts the copy from EventSub in place of one's own message, already shown", () => {
    const own = { ...message("mine"), color: "#ffffff" }
    const state = applyChatEvents(
      { messages: [message("a"), own, message("b")], status: "connected" },
      [
        {
          kind: "message",
          message: { ...message("mine"), badges: [{ title: "Sub", url: "https://x/b.png" }] },
        },
      ],
    )
    expect(state.messages.map((entry) => entry.id)).toEqual(["a", "mine", "b"])
    expect(state.messages[1]?.badges).toHaveLength(1)
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

describe("chatWindowStart", () => {
  it("shows between CHAT_HISTORY and CHAT_HISTORY + CHAT_TRIM, moving the start in steps of CHAT_TRIM", () => {
    let previous = 0
    for (let length = 0; length <= 1000; length++) {
      const start = chatWindowStart(length)
      expect(length - start).toBeLessThanOrEqual(CHAT_HISTORY + CHAT_TRIM)
      if (length >= CHAT_HISTORY) expect(length - start).toBeGreaterThanOrEqual(CHAT_HISTORY)
      expect(start % CHAT_TRIM).toBe(0)
      expect(start).toBeGreaterThanOrEqual(previous)
      previous = start
    }
  })
})
