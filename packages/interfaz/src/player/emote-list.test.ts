// @vitest-environment jsdom

import type { ChatEmote, ChatEmoteGroups, ChatMessage } from "@goodttv/contratos"
import { act, createElement, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Message } from "./ChatPanel"
import {
  chatEmoteDetails,
  chatEmoteOf,
  EMOTE_LOAD_DELAY_MS,
  emoteSections,
  useLazyEmoteImages,
} from "./emote-list"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const emote = (name: string, provider: ChatEmote["provider"] = "7tv"): ChatEmote => ({
  name,
  provider,
  url: `https://e/${name}`,
  zeroWidth: false,
})

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("emoteSections", () => {
  const groups: ChatEmoteGroups = {
    channel: [emote("knekroLove"), emote("knekroPog")],
    global: [emote("OMEGALUL", "bttv"), emote("catJAM")],
    twitch: [],
  }

  it("da los del canal, los tuyos de Twitch y los globales, sin los grupos vacíos", () => {
    const sections = emoteSections(groups, "")
    expect(sections.map((section) => section.key)).toEqual(["channel", "global"])
    expect(sections.map((section) => section.title)).toEqual(["Del canal", "Globales"])
    expect(sections[0]?.emotes.map((each) => each.name)).toEqual(["knekroLove", "knekroPog"])
  })

  it("busca dentro del nombre, sin distinguir mayúsculas ni los espacios de los lados", () => {
    const sections = emoteSections(groups, "  LOVE ")
    expect(sections).toHaveLength(1)
    expect(sections[0]?.emotes.map((each) => each.name)).toEqual(["knekroLove"])
    expect(
      emoteSections(groups, "a").flatMap((section) => section.emotes.map((each) => each.name)),
    ).toEqual(["OMEGALUL", "catJAM"])
  })

  it("sin ninguno que se llame así, no da grupos", () => {
    expect(emoteSections(groups, "nadie")).toEqual([])
  })
})

describe("la ficha de un emote del chat", () => {
  // El emote como lo pinta el chat (Message), para leerlo de sus imágenes.
  const painted = (base: ChatEmote, overlays: readonly ChatEmote[] = []): Element => {
    const message: ChatMessage = {
      action: false,
      badges: [],
      color: "#bf94ff",
      displayName: "Viewer",
      id: "1",
      tokens: [{ emote: base, kind: "emote", overlays: [...overlays] }],
      userId: "1",
    }
    const container = document.body.appendChild(document.createElement("ol"))
    root = createRoot(container)
    act(() => root?.render(createElement(Message, { message })))
    const element = container.querySelector(".emote")
    if (element === null) throw new Error("sin emote")
    return element
  }

  it("lee el nombre, de dónde es, sus capas y la imagen del emote que pinta el chat", () => {
    const info = chatEmoteOf(painted(emote("catJAM"), [emote("RainTime"), emote("SteerR")]))
    expect(info).toEqual({
      name: "catJAM",
      overlays: ["RainTime", "SteerR"],
      provider: "7tv",
      url: "https://e/catJAM",
    })
    expect(info === null ? null : chatEmoteDetails(info)).toBe("7TV · con RainTime, SteerR")
  })

  it("sin data-*, el nombre del texto alternativo y sin proveedor; sin imagen, nada", () => {
    const element = document.createElement("span")
    element.innerHTML = '<img alt="Kappa" src="https://e/kappa" data-provider="otro">'
    const info = chatEmoteOf(element)
    expect(info).toEqual({
      name: "Kappa",
      overlays: [],
      provider: undefined,
      url: "https://e/kappa",
    })
    expect(info === null ? null : chatEmoteDetails(info)).toBe("")
    expect(chatEmoteOf(document.createElement("span"))).toBeNull()
  })

  it("sin capas, solo de dónde es", () => {
    expect(chatEmoteDetails({ name: "Kappa", overlays: [], provider: "twitch", url: "" })).toBe(
      "Twitch",
    )
  })
})

describe("useLazyEmoteImages", () => {
  // jsdom no trae IntersectionObserver: uno falso, que avisa cuando la prueba lo dice.
  let observers: FakeObserver[] = []
  class FakeObserver {
    readonly observed: Element[] = []
    disconnected = false
    constructor(
      readonly callback: (entries: { isIntersecting: boolean; target: Element }[]) => void,
    ) {
      observers.push(this)
    }
    observe(cell: Element): void {
      this.observed.push(cell)
    }
    disconnect(): void {
      this.disconnected = true
    }
  }
  const current = (): FakeObserver => {
    const observer = observers.at(-1)
    if (observer === undefined || observer.disconnected) throw new Error("sin observador")
    return observer
  }
  const show = (cell: Element, isIntersecting: boolean): void => {
    act(() => current().callback([{ isIntersecting, target: cell }]))
  }
  const wait = (ms: number): void => {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  beforeEach(() => {
    observers = []
    vi.useFakeTimers()
    vi.stubGlobal("IntersectionObserver", FakeObserver)
  })

  const List = ({ names, ready, search }: { names: string[]; ready: boolean; search: string }) => {
    const list = useRef<HTMLDivElement>(null)
    useLazyEmoteImages(list, ".celda", ready, search)
    return createElement(
      "div",
      { ref: list },
      names.map((name) =>
        createElement(
          "button",
          { className: "celda", key: name, type: "button" },
          createElement("img", { alt: "", "data-src": `https://e/${name}` }),
        ),
      ),
    )
  }
  const mount = (props: { names: string[]; ready: boolean; search: string }): HTMLElement => {
    const container = document.body.appendChild(document.createElement("div"))
    root ??= createRoot(container)
    act(() => root?.render(createElement(List, props)))
    return document.body
  }
  const cells = (): Element[] => [...document.querySelectorAll(".celda")]
  const imageOf = (index: number): HTMLImageElement => {
    const image = cells()[index]?.querySelector("img")
    if (image == null) throw new Error("sin imagen")
    return image
  }

  it("pide la imagen de una celda tras estar un momento a la vista, no antes", () => {
    mount({ names: ["a", "b"], ready: true, search: "" })
    expect(current().observed).toEqual(cells())
    const [first] = cells()
    if (first === undefined) throw new Error("sin celdas")
    show(first, true)
    wait(EMOTE_LOAD_DELAY_MS - 1)
    expect(imageOf(0).hasAttribute("src")).toBe(false)
    wait(1)
    expect(imageOf(0).getAttribute("src")).toBe("https://e/a")
    expect(imageOf(1).hasAttribute("src")).toBe(false)
  })

  it("una celda que pasa de largo no se pide, y lo que sale sin haber cargado se cancela", () => {
    mount({ names: ["a", "b"], ready: true, search: "" })
    const [first, second] = cells()
    if (first === undefined || second === undefined) throw new Error("sin celdas")
    show(first, true)
    show(first, false)
    wait(EMOTE_LOAD_DELAY_MS)
    expect(imageOf(0).hasAttribute("src")).toBe(false)
    show(second, true)
    wait(EMOTE_LOAD_DELAY_MS)
    expect(imageOf(1).hasAttribute("src")).toBe(true) // jsdom no carga imágenes: complete es falso
    show(second, false)
    expect(imageOf(1).hasAttribute("src")).toBe(false)
  })

  it("mientras cargan los emotes no observa; con otra búsqueda, vuelve a observar las celdas nuevas", () => {
    mount({ names: [], ready: false, search: "" })
    expect(observers).toHaveLength(0)
    mount({ names: ["a", "b"], ready: true, search: "" })
    expect(observers).toHaveLength(1)
    mount({ names: ["a", "b"], ready: true, search: " " }) // la misma búsqueda, con un espacio
    expect(observers).toHaveLength(1)
    mount({ names: ["b"], ready: true, search: "b" })
    expect(observers).toHaveLength(2)
    expect(observers[0]?.disconnected).toBe(true)
    expect(current().observed).toEqual(cells())
  })
})
