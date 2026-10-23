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
  act(() => root?.render(createElement(ChatPanel, { chat, scale: "normal", writing: "no" })))
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

  it("con el ratón en un emote no baja; al salir de él vuelve a bajar, también si lo has pulsado", () => {
    const list = mount()
    const emote = list.querySelector(".emote")
    const text = list.querySelector("li")
    if (emote === null || text === null) throw new Error("sin mensajes")
    act(() => {
      emote.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
      emote.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
    })
    height = 1052
    act(() => resized?.())
    frame()
    expect(list.scrollTop).toBe(1000)
    act(() => {
      text.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    })
    height = 1080
    act(() => resized?.())
    frame()
    expect(list.scrollTop).toBe(1080)
  })
})

describe("escribir en el chat (CHAT-1)", () => {
  const writeIn = (
    send: (text: string) => Promise<string | null>,
    writing: "si" | "vincular" = "si",
  ) => {
    const container = document.body.appendChild(document.createElement("div"))
    root = createRoot(container)
    const chat: ChatView = { delay: 12, messages: [], send, status: "connected" }
    act(() => root?.render(createElement(ChatPanel, { chat, scale: "normal", writing })))
    return container
  }
  const type = (input: HTMLInputElement, text: string): void => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  const submit = async (container: HTMLElement): Promise<void> => {
    await act(async () => {
      container.querySelector("form")?.requestSubmit()
    })
  }

  it("envía con Enter y vacía la caja; dice que lo propio sale ya", async () => {
    const send = vi.fn(async () => null)
    const container = writeIn(send)
    const input = container.querySelector("input") as HTMLInputElement
    type(input, "  hola  ")
    await submit(container)
    expect(send).toHaveBeenCalledWith("hola")
    expect(input.value).toBe("")
    expect(container.textContent).toContain("Va 12 s por detrás, como la imagen. Lo tuyo sale ya.")
  })

  it("si Twitch no lo envía, enseña el motivo y conserva el texto", async () => {
    const container = writeIn(async () => "Este chat es solo para seguidores.")
    const input = container.querySelector("input") as HTMLInputElement
    type(input, "hola")
    await submit(container)
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Este chat es solo para seguidores.",
    )
    expect(input.value).toBe("hola")
  })

  it("Esc sale de la caja sin dejar el canal", () => {
    const container = writeIn(async () => null)
    const input = container.querySelector("input") as HTMLInputElement
    input.focus()
    const key = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })
    act(() => {
      input.dispatchEvent(key)
    })
    expect(key.defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe(input)
  })

  it("con una cuenta sin el permiso, invita a vincularla otra vez", () => {
    const container = writeIn(async () => null, "vincular")
    expect(container.querySelector("input")).toBeNull()
    expect(container.textContent).toContain("vuelve a vincular la cuenta")
  })
})
