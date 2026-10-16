// @vitest-environment jsdom

// useHlsPlayer (@goodttv/interfaz) con un hls.js falso: la recuperación de errores de medios, el salto del arranque y
// el plazo de un canal que no arranca. Va aquí porque este paquete trae react-dom y jsdom.
import { useHlsPlayer } from "@goodttv/interfaz"
import { act, createElement, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Se define antes que los imports (vi.mock sube arriba del todo).
const { FakeHls, players } = vi.hoisted(() => {
  type Handler = (event: string, data: unknown) => void
  const players: InstanceType<typeof FakeHls>[] = []
  class FakeHls {
    static Events = {
      ERROR: "error",
      FRAG_LOADING: "fragLoading",
      LEVEL_LOADED: "levelLoaded",
      MANIFEST_PARSED: "manifestParsed",
    }
    static ErrorTypes = { MEDIA_ERROR: "mediaError", NETWORK_ERROR: "networkError" }
    readonly calls: string[] = []
    readonly handlers = new Map<string, Handler[]>()
    latency = 0
    latestLevelDetails: { age: number } | null = { age: 0.5 }
    playingDate = null
    targetLatency: number | null = 5
    readonly config: { progressive?: boolean }
    constructor(config: { progressive?: boolean }) {
      this.config = { ...config }
      players.push(this)
    }
    on(event: string, handler: Handler): void {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    }
    once(event: string, handler: Handler): void {
      const once: Handler = (...args) => {
        this.handlers.set(
          event,
          (this.handlers.get(event) ?? []).filter((each) => each !== once),
        )
        handler(...args)
      }
      this.on(event, once)
    }
    emit(event: string, data: unknown): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(event, data)
    }
    attachMedia(): void {}
    loadSource(): void {}
    destroy(): void {}
    recoverMediaError(): void {
      this.calls.push("recoverMediaError")
    }
    startLoad(position: number): void {
      this.calls.push(`startLoad ${position}`)
    }
  }
  return { FakeHls, players }
})
vi.mock("hls.js", () => ({ default: FakeHls }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let paused = false
let phase = ""
const Player = ({ channel }: { readonly channel: string }) => {
  const surface = useRef<HTMLDivElement>(null)
  phase = useHlsPlayer(surface, channel, true, "adaptativo").state.phase
  return createElement("div", { ref: surface })
}
// Otro canal en el mismo reproductor, como al cambiar de canal sin salir de él.
const show = async (channel: string): Promise<void> => {
  await act(async () => root?.render(createElement(Player, { channel })))
}
const open = async () => {
  const container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  await show("a")
  const player = players.at(-1)
  const video = container.querySelector("video")
  if (player === undefined || video === null) throw new Error("sin reproductor")
  // jsdom no reproduce: el estado del <video>, a mano (10 s vistos, búfer hasta el 20).
  Object.defineProperties(video, {
    buffered: { value: { end: () => 20, length: 1 } },
    currentTime: { value: 10, writable: true },
    paused: { get: () => paused },
    readyState: { value: 4 },
  })
  return { player, video }
}
const wait = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}
const second = (): void => wait(1000)
const fire = (video: HTMLVideoElement, type: string): void => {
  act(() => {
    video.dispatchEvent(new Event(type))
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] })
  vi.stubGlobal("api", { player: { setWatching: async () => undefined } })
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => ({
        filling: false,
        offline: false,
        qualities: [],
        quality: "1920x1080@60",
        segmentDuration: 2,
      }),
      ok: true,
    })),
  )
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
  paused = false
})
afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
  players.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("error fatal de medios", () => {
  it("reconecta el vídeo y vuelve a cargar donde iba (hls.js ya ha parado la carga)", async () => {
    const { player } = await open()
    player.emit("error", { fatal: true, type: "mediaError" })
    expect(player.calls).toEqual(["recoverMediaError", "startLoad 10"])
  })

  it("antes de empezar a reproducir, vuelve a cargar desde el principio", async () => {
    const { player, video } = await open()
    video.currentTime = 0
    player.emit("error", { fatal: true, type: "mediaError" })
    expect(player.calls).toEqual(["recoverMediaError", "startLoad -1"])
  })

  it("si falla antes de la primera lista, al llegar esta empieza en el objetivo, y solo esa vez", async () => {
    const { player, video } = await open()
    video.currentTime = 0
    player.emit("error", { fatal: true, type: "mediaError" })
    player.emit("levelLoaded", { details: { edge: 30, fragments: [] } }) // objetivo: 2,5 fragmentos de 2 s
    player.emit("levelLoaded", { details: { edge: 32, fragments: [] } })
    expect(player.calls).toEqual(["recoverMediaError", "startLoad -1", "startLoad 25"])
  })
})

describe("carga progresiva", () => {
  it("con fMP4 (EXT-X-MAP) se quita antes de empezar a cargar; con MPEG-TS se queda", async () => {
    const { player: fmp4 } = await open()
    expect(fmp4.config.progressive).toBe(true)
    fmp4.emit("levelLoaded", { details: { edge: 30, fragments: [{ initSegment: {} }] } })
    expect(fmp4.config.progressive).toBe(false)
    expect(fmp4.calls).toEqual(["startLoad 25"])

    await show("b")
    const ts = players.at(-1)
    if (ts === undefined) throw new Error("sin reproductor")
    ts.emit("levelLoaded", { details: { edge: 30, fragments: [{ initSegment: null }] } })
    expect(ts.config.progressive).toBe(true)
  })
})

describe("salto del arranque", () => {
  it("salta el margen que sobra en los primeros segundos", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    player.latency = 7 // 2 s por encima del objetivo
    second()
    expect(video.currentTime).toBe(12)
  })

  it("tras una pausa no salta lo que se pausó: lo recupera acelerando", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    paused = true
    fire(video, "pause")
    paused = false
    fire(video, "playing")
    player.latency = 10 // los 5 s de la pausa
    second()
    expect(video.currentTime).toBe(10)
    expect(video.playbackRate).toBe(1.05)
  })

  it("con la lista parada no salta: ese retraso no es margen que sobre", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    player.latestLevelDetails = { age: 8 }
    player.latency = 8
    second()
    expect(video.currentTime).toBe(10)
  })
})

describe("canal que no arranca", () => {
  it("el plazo es de cada canal, también si se cambia mientras el anterior sigue cargando", async () => {
    await open()
    wait(19_000)
    await show("b")
    wait(2000)
    expect(phase).toBe("loading")
    wait(18_000)
    expect(phase).toBe("stalled")
  })
})
