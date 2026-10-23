// @vitest-environment jsdom

// Escribir emotes en el chat (CHAT-1): Tab completa y pasa al siguiente, «:» sugiere, la lista se pide al ir a escribir
// y un clic en un emote del chat lo pone en la caja.
import type { ChatEmote, ChatEmoteGroups, ChatMessage } from "@goodttv/contratos"
import type { ChatView } from "@goodttv/interfaz"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatPanel } from "./ChatPanel"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const emote = (name: string, provider: ChatEmote["provider"] = "7tv"): ChatEmote => ({
  name,
  provider,
  url: `https://cdn.7tv.app/emote/${name}/2x.webp`,
  zeroWidth: false,
})
const GROUPS: ChatEmoteGroups = {
  channel: [emote("KEKWait"), emote("KEKW")],
  global: [emote("catJAM", "bttv")],
  twitch: [],
}
const withEmote: ChatMessage = {
  action: false,
  badges: [],
  color: "#bf94ff",
  displayName: "Viewer",
  id: "m1",
  tokens: [{ emote: emote("catJAM", "bttv"), kind: "emote", overlays: [] }],
  userId: "1",
}

let root: Root | undefined
let load: ReturnType<typeof vi.fn>
let send: ReturnType<typeof vi.fn>
const mount = async (): Promise<{ input: HTMLInputElement; list: HTMLOListElement }> => {
  const container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  const chat: ChatView = {
    delay: null,
    emotes: load as unknown as () => Promise<ChatEmoteGroups>,
    messages: [withEmote],
    send: send as unknown as (text: string) => Promise<string | null>,
    status: "connected",
  }
  await act(async () =>
    root?.render(createElement(ChatPanel, { chat, scale: "normal", writing: "si" })),
  )
  const input = container.querySelector<HTMLInputElement>(".chat__input")
  const list = container.querySelector("ol")
  if (input === null || list === null) throw new Error("sin caja")
  return { input, list }
}
const focus = async (input: HTMLInputElement): Promise<void> => {
  await act(async () => input.focus())
}
// Como al teclear: el valor, el cursor al final y el evento que lee React.
const typeIn = (input: HTMLInputElement, value: string): void => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input.setSelectionRange(value.length, value.length)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const key = (input: HTMLInputElement, name: string, shiftKey = false): void => {
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name, shiftKey }),
    )
  })
}
const options = (): string[] =>
  [...document.querySelectorAll(".emote-suggestions__name")].map((each) => each.textContent ?? "")

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  )
  load = vi.fn(async () => GROUPS)
  send = vi.fn(async () => null)
})
afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe("emotes al escribir", () => {
  it("se piden al ir a escribir, no al abrir el canal", async () => {
    const { input } = await mount()
    expect(load).not.toHaveBeenCalled()
    await focus(input)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("Tab completa con el más corto; seguido, el siguiente, y Mayús+Tab vuelve", async () => {
    const { input } = await mount()
    await focus(input)
    typeIn(input, "jaja kek")
    key(input, "Tab")
    expect(input.value).toBe("jaja KEKW ")
    expect(input.selectionStart).toBe(10)
    key(input, "Tab")
    expect(input.value).toBe("jaja KEKWait ")
    key(input, "Tab", true)
    expect(input.value).toBe("jaja KEKW ")
  })

  it("«:» y dos letras: sugerencias; ↓ y Enter ponen la elegida, sin enviar", async () => {
    const { input } = await mount()
    await focus(input)
    typeIn(input, ":ke")
    expect(options()).toEqual(["KEKW", "KEKWait"])
    key(input, "ArrowDown")
    key(input, "Enter")
    expect(input.value).toBe("KEKWait ")
    expect(send).not.toHaveBeenCalled()
    expect(options()).toEqual([])
  })

  it("Esc descarta las sugerencias de esa palabra", async () => {
    const { input } = await mount()
    await focus(input)
    typeIn(input, ":ke")
    key(input, "Escape")
    expect(options()).toEqual([])
  })

  it("un clic en un emote del chat lo pone en la caja, tras lo escrito", async () => {
    const { input, list } = await mount()
    typeIn(input, "mira")
    const image = list.querySelector(".emote img")
    if (image === null) throw new Error("sin emote")
    act(() => {
      image.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    })
    expect(document.querySelector(".emote-tip__name")?.textContent).toBe("catJAM")
    expect(document.querySelector(".emote-tip__meta")?.textContent).toBe("BTTV")
    act(() => {
      image.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(input.value).toBe("mira catJAM ")
  })
})
