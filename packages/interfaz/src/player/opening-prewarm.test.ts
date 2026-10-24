// @vitest-environment jsdom

import type { LatencyMode } from "@goodttv/contratos"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OPENING_PREWARM_MS, useOpeningPrewarm } from "./opening-prewarm"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
const prewarm = vi.fn((_login: string, _mode: LatencyMode) => undefined)

type Props = {
  readonly atHome?: boolean
  readonly live?: boolean | null // null: aún no hay último canal visto
  readonly login?: string
  readonly ready?: boolean
}
const Opening = ({ atHome = true, live = true, login = "ultimo", ready = true }: Props) => {
  useOpeningPrewarm(
    atHome,
    live === null ? undefined : { displayName: login, live, login },
    "sin-paradas",
    ready,
    prewarm,
  )
  return null
}
const render = (props: Props = {}): void => {
  act(() => root?.render(createElement(Opening, props)))
}
const prewarmed = (): string[] => prewarm.mock.calls.map(([login, mode]) => `${login} ${mode}`)

beforeEach(() => {
  vi.useFakeTimers()
  prewarm.mockClear()
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  vi.useRealTimers()
})

describe("precalentar al abrir (REN-1)", () => {
  it("precalienta el último canal visto si emite, con el modo guardado", () => {
    render()
    expect(prewarmed()).toEqual(["ultimo sin-paradas"])
  })

  it("espera al modo guardado y no repite", () => {
    render({ ready: false })
    expect(prewarmed()).toEqual([])
    render({ ready: true })
    render({ login: "otro" })
    expect(prewarmed()).toEqual(["ultimo sin-paradas"])
  })

  it("si lo guardado no dice que emite, espera a lo de ahora unos segundos", () => {
    render({ live: false })
    render({ live: null })
    expect(prewarmed()).toEqual([])
    render({ live: true })
    expect(prewarmed()).toEqual(["ultimo sin-paradas"])
  })

  it("pasado el plazo, ya no", () => {
    render({ live: false })
    act(() => {
      vi.advanceTimersByTime(OPENING_PREWARM_MS + 1)
    })
    render({ live: true })
    expect(prewarmed()).toEqual([])
  })

  it("ni si se abrió en otra vista", () => {
    render({ atHome: false })
    render({ atHome: true })
    expect(prewarmed()).toEqual([])
  })
})
