// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useRefreshWhileVisible } from "./data"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const MS = 120_000
let visibility: DocumentVisibilityState = "visible"
const ver = (valor: DocumentVisibilityState): void => {
  visibility = valor
  document.dispatchEvent(new Event("visibilitychange"))
}

describe("useRefreshWhileVisible", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    visibility = "visible"
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const montar = (refresh: () => void) => {
    const Prueba = () => {
      useRefreshWhileVisible(refresh, MS)
      return null
    }
    const root = createRoot(document.createElement("div"))
    act(() => root.render(createElement(Prueba)))
    return root
  }

  it("a la vista, refresca cada intervalo", () => {
    const refresh = vi.fn()
    const root = montar(refresh)
    vi.advanceTimersByTime(MS * 2)
    expect(refresh).toHaveBeenCalledTimes(2)
    act(() => root.unmount())
    vi.advanceTimersByTime(MS)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it("oculta no refresca, y si le tocaba, lo hace una vez al volver", () => {
    const refresh = vi.fn()
    const root = montar(refresh)
    ver("hidden")
    vi.advanceTimersByTime(MS * 5)
    expect(refresh).not.toHaveBeenCalled()
    ver("visible")
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(MS - 1)
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    act(() => root.unmount())
  })

  it("si vuelve antes de que le toque, no refresca de más", () => {
    const refresh = vi.fn()
    const root = montar(refresh)
    ver("hidden")
    vi.advanceTimersByTime(MS / 2)
    ver("visible")
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(MS / 2)
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
  })
})
