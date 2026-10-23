// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type Standby, useSoleSound, WAITS } from "./sonido"

const SILENT_MS = WAITS.silentMs
const WARM_MS = WAITS.warmMs

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// Dos «pestañas» en la misma página de prueba: cada una con su hook y su BroadcastChannel.
type Seen = { standby: Standby; warm: boolean }
const roots: Root[] = []
let visibility: DocumentVisibilityState = "visible"
const mount = (login: string | undefined, seen: Seen, stoppable = true): Root => {
  const Tab = ({ watching }: { readonly watching: string | undefined }) => {
    const sole = useSoleSound(watching, stoppable)
    seen.standby = sole.standby
    seen.warm = sole.warm
    return null
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  act(() => root.render(createElement(Tab, { watching: login })))
  return root
}
// Los mensajes entre BroadcastChannel llegan por el bucle de eventos, no por temporizadores.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((done) => setImmediate(done))
    })
  }
}
const setVisible = async (visible: boolean): Promise<void> => {
  visibility = visible ? "visible" : "hidden"
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await settle()
}
const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  visibility = "visible"
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility)
  // La hora también, para que una pestaña reclame después que otra (el desempate es por hora).
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("suena una sola pestaña", () => {
  it("al abrir un canal en otra pestaña a la vista, esta se silencia; oculta un rato, se para y luego se enfría", async () => {
    const a: Seen = { standby: "no", warm: true }
    const b: Seen = { standby: "no", warm: true }
    mount("uno", a)
    await settle()
    advance(5)
    mount("dos", b)
    await settle()
    expect(a.standby).toBe("silencio")
    expect(b.standby).toBe("no")
    // A la vista no pasa de silencio.
    advance(SILENT_MS * 2)
    expect(a.standby).toBe("silencio")
    await setVisible(false)
    advance(SILENT_MS)
    expect(a.standby).toBe("parado")
    expect(a.warm).toBe(true)
    advance(WARM_MS)
    expect(a.warm).toBe(false)
  })

  it("si dos pestañas reclaman a la vez, suena una y solo una", async () => {
    // Dos ventanas ocultas que vuelven a la vista en el mismo instante: reclaman a la misma hora.
    visibility = "hidden"
    const a: Seen = { standby: "no", warm: true }
    const b: Seen = { standby: "no", warm: true }
    mount("uno", a)
    mount("dos", b)
    await setVisible(true)
    expect([a.standby, b.standby].filter((standby) => standby === "no")).toHaveLength(1)
  })

  it("pausada por la persona, no se para", async () => {
    const a: Seen = { standby: "no", warm: true }
    mount("uno", a, false)
    await settle()
    advance(5)
    mount("dos", { standby: "no", warm: true })
    await settle()
    await setVisible(false)
    advance(SILENT_MS * 3)
    expect(a.standby).toBe("silencio")
  })

  it("un canal abierto en una pestaña oculta espera parado, y al mirarla suena", async () => {
    visibility = "hidden"
    const a: Seen = { standby: "no", warm: true }
    mount("uno", a)
    expect(a.standby).toBe("parado")
    await setVisible(true)
    expect(a.standby).toBe("no")
  })

  it("en Inicio no espera ni avisa a las demás", async () => {
    const a: Seen = { standby: "no", warm: true }
    mount("uno", a)
    await settle()
    advance(5)
    mount(undefined, { standby: "no", warm: true })
    await settle()
    expect(a.standby).toBe("no")
  })
})
