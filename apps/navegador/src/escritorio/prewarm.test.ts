// @vitest-environment jsdom

import { useHlsPlayer, useOpeningPrewarm } from "@goodttv/interfaz"
import { act, createElement, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PREWARM_MS, usePointerPrewarm } from "./prewarm"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
const render = (element: React.ReactElement): void => {
  const container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  act(() => root?.render(element))
}

const fetched = vi.fn((_url: string) => new Promise<Response>(() => undefined)) // nunca contesta
const prewarmed = (): string[] =>
  fetched.mock.calls.map(([url]) => url).filter((url) => url.includes("/precalentar"))

const link = (login: string): HTMLAnchorElement => {
  const element = document.body.appendChild(document.createElement("a"))
  element.href = `#/canal/${login}`
  return element
}
const pointer = (type: string, target: Element): void => {
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true }))
  })
}
const wait = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}
// Como el navegador: al entrar en un elemento, pointerover y luego pointermove.
const enter = (target: Element): void => {
  pointer("pointerover", target)
  pointer("pointermove", target)
}

const Prewarm = ({ offline = [] }: { readonly offline?: readonly string[] }) => {
  usePointerPrewarm("viendo", new Set(offline), "adaptativo")
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("fetch", fetched)
})
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  fetched.mockClear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("precalentar con el ratón", () => {
  it("precalienta el canal sobre el que el ratón se queda parado", () => {
    render(createElement(Prewarm))
    enter(link("b"))
    wait(PREWARM_MS)
    expect(prewarmed()).toEqual(["/stream/b/precalentar?modo=adaptativo"])
  })

  it("no precalienta mientras el ratón sigue moviéndose por encima", () => {
    render(createElement(Prewarm))
    const b = link("b")
    enter(b)
    for (let step = 0; step < 5; step++) {
      wait(PREWARM_MS - 50)
      pointer("pointermove", b)
    }
    enter(link("c")) // sigue hacia otro canal y se para
    wait(PREWARM_MS)
    expect(prewarmed()).toEqual(["/stream/c/precalentar?modo=adaptativo"])
  })

  it("con el ratón encima no precalienta un canal desconectado, pero sí al pulsarlo", () => {
    render(createElement(Prewarm, { offline: ["b"] }))
    const b = link("b")
    enter(b)
    wait(PREWARM_MS * 2)
    expect(prewarmed()).toEqual([])
    pointer("pointerdown", b)
    expect(prewarmed()).toEqual(["/stream/b/precalentar?modo=adaptativo"])
  })

  it("ni el que ya se ve", () => {
    render(createElement(Prewarm))
    const watching = link("viendo")
    enter(watching)
    wait(PREWARM_MS)
    pointer("pointerdown", watching)
    expect(prewarmed()).toEqual([])
  })
})

describe("precalentar con una calidad elegida a mano", () => {
  let player: ReturnType<typeof useHlsPlayer> | undefined
  const Player = () => {
    const surface = useRef<HTMLDivElement>(null)
    player = useHlsPlayer(surface, "a", true, "adaptativo")
    return createElement("div", { ref: surface })
  }

  beforeEach(() => {
    vi.stubGlobal("api", { player: { setWatching: async () => undefined } })
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
  })

  it("pide la del reproductor abierto, que es con la que se abrirá el canal siguiente", () => {
    render(createElement("div", null, createElement(Player), createElement(Prewarm)))
    const b = link("b")
    enter(b)
    wait(PREWARM_MS)
    act(() => player?.setQuality("1280x720@60"))
    pointer("pointerdown", b)
    expect(prewarmed()).toEqual([
      "/stream/b/precalentar?modo=adaptativo",
      "/stream/b/precalentar?modo=adaptativo&q=1280x720%4060",
    ])
  })

  it("sin reproductor abierto, la última elegida, con la que se abrirá el canal", () => {
    render(createElement(Player))
    act(() => player?.setQuality("1280x720@60"))
    act(() => root?.render(createElement(Prewarm)))
    pointer("pointerdown", link("b"))
    expect(prewarmed()).toEqual(["/stream/b/precalentar?modo=adaptativo&q=1280x720%4060"])
    // Otro reproductor (al volver de un VOD, o abierto desde Inicio) la pide.
    fetched.mockClear()
    act(() => root?.render(createElement(Player)))
    expect(fetched.mock.calls.map(([url]) => url).find((url) => url.includes("/info"))).toContain(
      "q=1280x720%4060",
    )
  })
})

describe("la calidad elegida, guardada", () => {
  let player: ReturnType<typeof useHlsPlayer> | undefined
  const Player = () => {
    const surface = useRef<HTMLDivElement>(null)
    player = useHlsPlayer(surface, "a", true, "adaptativo")
    return createElement("div", { ref: surface })
  }

  beforeEach(() => {
    vi.stubGlobal("api", { player: { setWatching: async () => undefined } })
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
  })

  it("se guarda en localStorage, como el volumen, y «Auto» la quita", () => {
    render(createElement("div", null, createElement(Player), createElement(Prewarm)))
    act(() => player?.setQuality("852x480@30"))
    expect(localStorage.getItem("calidad-directo")).toBe("852x480@30")
    expect(player?.chosenQuality).toBe("852x480@30")
    act(() => player?.setQuality(null))
    expect(localStorage.getItem("calidad-directo")).toBeNull()
    expect(player?.chosenQuality).toBeNull()
    pointer("pointerdown", link("b"))
    expect(prewarmed()).toEqual(["/stream/b/precalentar?modo=adaptativo"])
  })
})

describe("precalentar al abrir (REN-1)", () => {
  // La lógica se prueba en @goodttv/interfaz (opening-prewarm.test.ts); aquí, que en la extensión va al directo de la
  // página, con el modo guardado.
  const Opening = () => {
    useOpeningPrewarm(
      true,
      { displayName: "ultimo", live: true, login: "ultimo" },
      "sin-paradas",
      true,
    )
    return null
  }

  it("precalienta el último canal visto en el directo de la página", () => {
    render(createElement(Opening))
    // Con la calidad elegida en esta página, si la hay (aquí, la de una prueba anterior).
    expect(prewarmed()).toHaveLength(1)
    expect(prewarmed()[0]).toMatch(/^\/stream\/ultimo\/precalentar\?modo=sin-paradas(&q=|$)/)
  })
})
