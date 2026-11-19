// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ControlsMenu,
  useControlsAwake,
  useSurfaceClicks,
  useVolume,
  VolumeControl,
} from "./PlayerControls"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  })
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
})
afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  vi.useRealTimers()
})
const render = (element: ReturnType<typeof createElement>): void => {
  act(() => root?.render(element))
}
const wait = (ms: number): void => {
  act(() => vi.advanceTimersByTime(ms))
}

describe("los controles a la vista", () => {
  let now: ReturnType<typeof useControlsAwake> | undefined
  const Probe = () => {
    now = useControlsAwake()
    return null
  }

  it("salen al abrir y se ocultan solos a los 3 s", () => {
    render(createElement(Probe))
    expect(now?.awake).toBe(true)
    wait(2999)
    expect(now?.awake).toBe(true)
    wait(1)
    expect(now?.awake).toBe(false)
  })

  it("mover el ratón vuelve a empezar la cuenta, y salir de él los oculta ya", () => {
    render(createElement(Probe))
    wait(2000)
    act(() => now?.wake())
    wait(2000)
    expect(now?.awake).toBe(true)
    act(() => now?.sleep())
    expect(now?.awake).toBe(false)
  })
})

describe("un clic y dos en el vídeo", () => {
  const toggle = vi.fn()
  const fullscreen = vi.fn()
  let clicks: ReturnType<typeof useSurfaceClicks> | undefined
  const Probe = () => {
    clicks = useSurfaceClicks(toggle, fullscreen)
    return null
  }
  afterEach(() => {
    toggle.mockClear()
    fullscreen.mockClear()
  })

  it("un clic pausa, tras esperar por si llega el segundo", () => {
    render(createElement(Probe))
    act(() => clicks?.onClick({ detail: 1 }))
    wait(200)
    expect(toggle).not.toHaveBeenCalled()
    wait(20)
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(fullscreen).not.toHaveBeenCalled()
  })

  it("dos clics van a pantalla completa sin pausar", () => {
    render(createElement(Probe))
    act(() => clicks?.onClick({ detail: 1 }))
    wait(100)
    act(() => clicks?.onClick({ detail: 2 }))
    act(() => clicks?.onDoubleClick())
    wait(1000)
    expect(toggle).not.toHaveBeenCalled()
    expect(fullscreen).toHaveBeenCalledTimes(1)
  })

  it("con un doble clic del sistema más lento, la pausa del primero se deshace", () => {
    render(createElement(Probe))
    act(() => clicks?.onClick({ detail: 1 }))
    wait(300) // el primero ya ha pausado
    act(() => clicks?.onClick({ detail: 2 }))
    act(() => clicks?.onDoubleClick())
    wait(1000)
    expect(toggle).toHaveBeenCalledTimes(2)
    expect(fullscreen).toHaveBeenCalledTimes(1)
  })

  it("una pausa hecha aposta justo antes de un doble clic se queda", () => {
    render(createElement(Probe))
    act(() => clicks?.onClick({ detail: 1 }))
    wait(500) // pausado, y enseguida otro gesto: un doble clic rápido para ampliar
    act(() => clicks?.onClick({ detail: 1 }))
    wait(80)
    act(() => clicks?.onClick({ detail: 2 }))
    act(() => clicks?.onDoubleClick())
    wait(1000)
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(fullscreen).toHaveBeenCalledTimes(1)
  })

  it("el clic que espera se olvida al cancelarlo y al salir", () => {
    render(createElement(Probe))
    act(() => clicks?.onClick({ detail: 1 }))
    act(() => clicks?.cancel())
    wait(1000)
    act(() => clicks?.onClick({ detail: 1 }))
    act(() => root?.unmount())
    root = undefined
    wait(1000)
    expect(toggle).not.toHaveBeenCalled()
  })
})

describe("el volumen", () => {
  it("se queda entre 0 y 1 y llega al reproductor", () => {
    const apply = vi.fn()
    let volume: ReturnType<typeof useVolume> | undefined
    const Probe = () => {
      volume = useVolume(apply)
      return null
    }
    render(createElement(Probe))
    act(() => volume?.[1](1.4))
    expect(volume?.[0]).toBe(1)
    act(() => volume?.[1](-0.2))
    expect(volume?.[0]).toBe(0)
    expect(apply.mock.calls).toEqual([[1], [0]])
  })

  it("quitar el silencio con el volumen a 0 lo sube a la mitad; si no, solo quita el silencio", () => {
    const onToggleMuted = vi.fn()
    const onVolume = vi.fn()
    const button = (): HTMLButtonElement => {
      const found = container.querySelector("button")
      if (found === null) throw new Error("sin botón")
      return found
    }
    render(createElement(VolumeControl, { muted: false, onToggleMuted, onVolume, volume: 0 }))
    expect(button().getAttribute("aria-label")).toBe("Quitar el silencio")
    act(() => button().click())
    expect(onVolume).toHaveBeenCalledWith(0.5)
    render(createElement(VolumeControl, { muted: true, onToggleMuted, onVolume, volume: 0.7 }))
    act(() => button().click())
    expect(onToggleMuted).toHaveBeenCalledTimes(1)
    expect(container.querySelector("input")?.value).toBe("0")
    render(createElement(VolumeControl, { muted: false, onToggleMuted, onVolume, volume: 0.7 }))
    expect(button().getAttribute("aria-label")).toBe("Silenciar")
    expect(container.querySelector("input")?.value).toBe("0.7")
  })
})

describe("un menú de los controles", () => {
  const menu = (open: boolean, onToggle: (open: boolean) => void) =>
    createElement(ControlsMenu, {
      // biome-ignore lint/correctness/noChildrenProp: con children obligatorio, createElement solo lo acepta en las props.
      children: "opciones",
      label: "Auto",
      onToggle,
      open,
      title: "Calidad",
    })
  const pressEscape = (): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })
    act(() => {
      document.body.dispatchEvent(event)
    })
    return event
  }

  it("abierto, Esc solo lo cierra: el Esc general de la ventana ya no lo atiende", () => {
    const onToggle = vi.fn()
    render(menu(true, onToggle))
    const event = pressEscape()
    expect(onToggle).toHaveBeenCalledWith(false)
    expect(event.defaultPrevented).toBe(true)
  })

  it("cerrado, Esc pasa de largo", () => {
    const onToggle = vi.fn()
    render(menu(false, onToggle))
    const event = pressEscape()
    expect(onToggle).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
