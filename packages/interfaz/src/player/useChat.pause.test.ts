// @vitest-environment jsdom

import type { ChatBatch, ChatMessage } from "@goodttv/contratos"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type ChatView, useChat } from "./useChat"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const message = (id: string): ChatMessage => ({
  action: false,
  badges: [],
  color: "#bf94ff",
  displayName: "Viewer",
  id,
  tokens: [{ kind: "text", text: id }],
  userId: "1",
})

let root: Root | undefined
let view: ChatView | undefined
const listeners = new Set<(batch: ChatBatch) => void>()
const chat = {
  close: vi.fn(async () => undefined),
  onBatch: (listener: (batch: ChatBatch) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  open: vi.fn(async () => 1),
}
const Chat = ({ connected }: { readonly connected: boolean }) => {
  view = useChat("canal", true, () => 0, connected)
  return null
}
const render = async (connected: boolean): Promise<void> => {
  await act(async () => root?.render(createElement(Chat, { connected })))
}
const emit = async (id: string): Promise<void> => {
  await act(async () => {
    for (const listener of listeners)
      listener({ events: [{ kind: "message", message: message(id) }], session: 1 })
  })
}

beforeEach(() => {
  vi.stubGlobal("api", { chat })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => {
  act(() => root?.unmount())
  listeners.clear()
  chat.close.mockClear()
  chat.open.mockClear()
  vi.unstubAllGlobals()
})

describe("useChat con la pestaña oculta", () => {
  it("cierra la conexión pero conserva los mensajes, y al volver sigue desde ellos", async () => {
    await render(true)
    await emit("a")
    expect(view?.messages.map((each) => each.id)).toEqual(["a"])

    await render(false)
    expect(chat.close).toHaveBeenCalled()
    expect(listeners.size).toBe(0)
    expect(view?.messages.map((each) => each.id)).toEqual(["a"])

    await render(true)
    expect(chat.open).toHaveBeenCalledTimes(2)
    await emit("b")
    expect(view?.messages.map((each) => each.id)).toEqual(["a", "b"])
  })
})
