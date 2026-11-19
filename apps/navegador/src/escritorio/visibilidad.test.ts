// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const setVisibility = (state: "hidden" | "visible"): void => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state })
  document.dispatchEvent(new Event("visibilitychange"))
}

// «Vista» es de la página, no de cada pantalla: el módulo se importa de nuevo en cada prueba, con la pestaña como
// empieza.
const load = async (state: "hidden" | "visible") => {
  vi.resetModules()
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state })
  return import("./visibilidad")
}

let root: Root | undefined
type Seen = { seen: boolean; visible: boolean }
const mount = ({ usePageSeen, usePageVisible }: Awaited<ReturnType<typeof load>>): Seen => {
  const now: Seen = { seen: false, visible: false }
  const Probe = () => {
    now.seen = usePageSeen()
    now.visible = usePageVisible()
    return null
  }
  root = createRoot(document.createElement("div"))
  act(() => root?.render(createElement(Probe)))
  return now
}

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  setVisibility("visible")
})

describe("usePageSeen", () => {
  it("una pestaña abierta a la vista ya está vista, y lo sigue al ocultarse", async () => {
    const now = mount(await load("visible"))
    expect(now).toEqual({ seen: true, visible: true })
    act(() => setVisibility("hidden"))
    expect(now).toEqual({ seen: true, visible: false })
  })

  it("abierta sin verse, no está vista hasta que se mira, y desde entonces sí", async () => {
    const now = mount(await load("hidden"))
    expect(now).toEqual({ seen: false, visible: false })
    act(() => setVisibility("visible"))
    expect(now).toEqual({ seen: true, visible: true })
    act(() => setVisibility("hidden"))
    expect(now).toEqual({ seen: true, visible: false })
  })

  it("lo que se monta después de haberla mirado la da por vista, aunque esté oculta", async () => {
    const module = await load("hidden")
    setVisibility("visible")
    setVisibility("hidden")
    expect(mount(module)).toEqual({ seen: true, visible: false })
  })
})
