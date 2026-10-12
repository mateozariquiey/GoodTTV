// @vitest-environment jsdom

import type { ChatMessage } from "@goodttv/contratos"
import type { ChatView } from "@goodttv/interfaz"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatPanel } from "./ChatPanel"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const message = (id: string, emote = false): ChatMessage => ({
  action: false,
  badges: [],
  color: "#bf94ff",
  displayName: "Viewer",
  id,
  tokens: emote
    ? [
        {
          // Sin width ni height (como los de Twitch): no ocupa nada hasta que carga.
          emote: { name: "Kappa", provider: "twitch", url: "https://e/kappa", zeroWidth: false },
          kind: "emote",
          overlays: [],
        },
      ]
    : [{ kind: "text", text: id }],
  userId: "1",
})

// jsdom no calcula la disposición ni trae ResizeObserver: las alturas y el aviso de cambio de tamaño, a mano.
let resized: (() => void) | undefined
class FakeResizeObserver {
  constructor(callback: () => void) {
    resized = callback
  }
  observe(): void {}
  disconnect(): void {}
}

let root: Root | undefined
let height = 1000
const mount = (): HTMLOListElement => {
  const container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  const chat: ChatView = {
    delay: null,
    messages: [message("a"), message("b", true)],
    status: "connected",
  }
  act(() => root?.render(createElement(ChatPanel, { chat, scale: "normal" })))
  const list = container.querySelector("ol")
  if (list === null) throw new Error("sin lista")
  Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => height })
  Object.defineProperty(list, "clientHeight", { configurable: true, value: 300 })
  Object.defineProperty(list, "scrollTop", { configurable: true, value: height, writable: true })
  return list
}
const frame = (): void => {
  act(() => {
    vi.advanceTimersByTime(20)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout"] })
  vi.stubGlobal("ResizeObserver", FakeResizeObserver)
  height = 1000
})
afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("chat de escritorio abajo del todo", () => {
  it("sigue abajo si la lista encoge sin mensajes nuevos (al salir del modo teatro)", () => {
    const list = mount()
    height = 1052
    act(() => resized?.())
    frame()
    expect(list.scrollTop).toBe(1052)
  })

  it("sigue abajo cuando un emote sin tamaño conocido carga y alarga su mensaje", () => {
    const list = mount()
    height = 1030
    act(() => {
      list.querySelector("img")?.dispatchEvent(new Event("load")) // como el navegador: no sube
    })
    frame()
    expect(list.scrollTop).toBe(1030)
  })

  it("si subiste a leer, se queda donde estás", () => {
    const list = mount()
    list.scrollTop = 200
    act(() => {
      list.dispatchEvent(new Event("scroll"))
    })
    height = 1052
    act(() => resized?.())
    frame()
    expect(list.scrollTop).toBe(200)
  })
})
