import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../../../shared/chat"
import { applyChatEvents, CHAT_HISTORY } from "./useChat"

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
