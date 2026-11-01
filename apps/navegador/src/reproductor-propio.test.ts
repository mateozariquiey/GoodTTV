// @vitest-environment jsdom

// useHlsPlayer (@goodttv/interfaz) con un hls.js falso: la recuperación de errores de medios, el margen que sobra,
// retroceder dentro de la lista y el plazo de un canal que no arranca. Va aquí porque este paquete trae react-dom y jsdom.
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
    // El objetivo (5 s del final de la lista, con su edad), en 32.
    // Sin fragmentos: ← y → van al punto exacto (con ellos, al fotograma clave más cercano).
    latestLevelDetails: {
      age: number
      edge: number
      fragmentStart: number
      fragments: { start: number; startPTS?: number }[]
    } | null = {
      age: 0.5,
      edge: 36.5,
      fragmentStart: 0,
      fragments: [],
    }
    playingDate = null
    targetLatency: number | null = 5
    readonly config: {
      liveMaxLatencyDuration?: number
      liveSyncDuration?: number
      progressive?: boolean
    }
    constructor(config: {
      liveMaxLatencyDuration?: number
      liveSyncDuration?: number
      progressive?: boolean
    }) {
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
let current: ReturnType<typeof useHlsPlayer> | undefined
let mode: "adaptativo" | "directo" = "adaptativo"
let canGoLive = true
const Player = ({ channel }: { readonly channel: string }) => {
  const surface = useRef<HTMLDivElement>(null)
  current = useHlsPlayer(surface, channel, true, mode, canGoLive)
  phase = current.state.phase
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
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"],
  })
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
  mode = "adaptativo"
  canGoLive = true
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
  it("se queda con fMP4 (EXT-X-MAP), con el mismo margen que con MPEG-TS (hls.js 1.7.4, REN-4)", async () => {
    const { player: fmp4 } = await open()
    expect(fmp4.config.progressive).toBe(true)
    fmp4.emit("levelLoaded", { details: { edge: 30, fragments: [{ initSegment: {} }] } })
    expect(fmp4.config.progressive).toBe(true)
    expect(fmp4.calls).toEqual(["startLoad 25"]) // 2,5 fragmentos de 2 s
    expect(fmp4.config.liveSyncDuration).toBe(5)

    await show("b")
    const ts = players.at(-1)
    if (ts === undefined) throw new Error("sin reproductor")
    ts.emit("levelLoaded", { details: { edge: 30, fragments: [{ initSegment: null }] } })
    expect(ts.config.progressive).toBe(true)
    expect(ts.calls).toEqual(["startLoad 25"]) // 2,5 fragmentos
  })
})

describe("margen que sobra", () => {
  it("salta el margen que sobra en los primeros segundos", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    player.latency = 7 // 2 s por encima del objetivo
    second()
    expect(video.currentTime).toBe(12)
  })

  // En Firefox y Zen, cada cambio de velocidad deja el sonido algo más atrás de la imagen, y no vuelve.
  it("también más tarde (una parada): lo salta, sin acelerar", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    wait(60_000)
    player.latency = 7
    second()
    expect(video.currentTime).toBe(12)
    expect(video.playbackRate).toBe(1)
  })

  const pauseFor = (video: HTMLVideoElement, ms = 5000): void => {
    paused = true
    fire(video, "pause")
    wait(ms)
    paused = false
    fire(video, "playing")
  }

  it("tras una pausa no salta lo que se pausó: lo conserva, como lo retrocedido, y sin acelerar", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    pauseFor(video)
    player.latency = 10 // los 5 s de la pausa
    second()
    expect(video.currentTime).toBe(10)
    expect(video.playbackRate).toBe(1)
    expect(current?.rewound).toBe(true)
    expect(player.config.liveMaxLatencyDuration).toBe(Number.POSITIVE_INFINITY)
  })

  it("una pausa de un instante no es retroceder: lo que sobra se salta", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    pauseFor(video, 300)
    player.latency = 7
    second()
    expect(video.currentTime).toBe(12)
    expect(current?.rewound).toBe(false)
  })

  it("una pausa de un instante justo después de una larga no la borra", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    pauseFor(video)
    pauseFor(video, 300) // antes de que lo mire el intervalo
    player.latency = 10
    second()
    expect(video.currentTime).toBe(10)
    expect(current?.rewound).toBe(true)
  })

  // La tele no tiene «Ir al directo»: conservarlo la dejaría atrás para siempre.
  it("sin «Ir al directo», tras una pausa, lo salta", async () => {
    canGoLive = false
    const { player, video } = await open()
    fire(video, "playing")
    pauseFor(video)
    player.latency = 8
    second()
    expect(video.currentTime).toBe(13)
    expect(current?.rewound).toBe(false)
  })

  it("en el modo directo, tras una pausa, lo salta", async () => {
    mode = "directo"
    const { player, video } = await open()
    fire(video, "playing")
    pauseFor(video)
    player.latency = 8
    second()
    expect(video.currentTime).toBe(13)
    expect(current?.rewound).toBe(false)
  })

  it("con la lista parada no salta: ese retraso no es margen que sobre", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    player.latestLevelDetails = { age: 8, edge: 36.5, fragmentStart: 0, fragments: [] }
    player.latency = 8
    second()
    expect(video.currentTime).toBe(10)
  })
})

describe("retroceder dentro de la lista", () => {
  const seekBy = (seconds: number, orStart = false): number | null => {
    let moved: number | null = null
    act(() => {
      moved = current?.seekBy(seconds, orStart) ?? null
    })
    return moved
  }

  it("lo retrocedido se conserva: no acelera, no salta el margen y hls.js no vuelve al directo", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    video.currentTime = 30 // el objetivo, en 32
    expect(seekBy(-10)).toBe(-10) // lo que se ha movido
    expect(video.currentTime).toBe(20)
    expect(current?.rewound).toBe(true)
    expect(player.config.liveMaxLatencyDuration).toBe(Number.POSITIVE_INFINITY)
    player.latency = 17 // 12 s por encima del objetivo, en el arranque
    second()
    expect(video.currentTime).toBe(20)
    expect(video.playbackRate).toBe(1)
  })

  it("hacia delante, como mucho hasta el objetivo; al llegar, todo como antes", async () => {
    const { player, video } = await open()
    video.currentTime = 30
    seekBy(-10)
    expect(seekBy(10)).not.toBeNull()
    expect(video.currentTime).toBe(30)
    expect(current?.rewound).toBe(true)
    expect(seekBy(Number.POSITIVE_INFINITY)).not.toBeNull()
    expect(video.currentTime).toBe(32)
    expect(current?.rewound).toBe(false)
    expect(player.config.liveMaxLatencyDuration).toBe(65) // objetivo + 60
  })

  it("← y → caen en el fotograma clave más cercano; Fin y lo que llega al objetivo, exactos", async () => {
    const { player, video } = await open()
    // Fragmentos de 2 s; el de 20 empieza (según hls.js) un poco antes de su fotograma clave.
    player.latestLevelDetails = {
      age: 0.5,
      edge: 36.5,
      fragmentStart: 0,
      fragments: Array.from({ length: 18 }, (_, index) => ({
        start: index * 2,
        startPTS: index * 2 - 0.02,
      })),
    }
    video.currentTime = 30.7
    expect(seekBy(-10)).toBeCloseTo(-10.62) // 20,08: el de 20, algo después de su principio
    expect(video.currentTime).toBeCloseTo(20.08)
    expect(current?.rewound).toBe(true)
    seekBy(11.5) // 31,58 está a menos de 1 s del objetivo (32): exacto
    expect(video.currentTime).toBeCloseTo(31.58)
    video.currentTime = 25.9
    seekBy(-10) // 15,9: el de 16 (16,08)
    expect(video.currentTime).toBeCloseTo(16.08)
    seekBy(Number.POSITIVE_INFINITY)
    expect(video.currentTime).toBe(32)
  })

  it("más atrás de la lista no se mueve, salvo que se pida su principio (3 fragmentos dentro)", async () => {
    const { video } = await open()
    video.currentTime = 30
    expect(seekBy(-40)).toBeNull()
    expect(video.currentTime).toBe(30)
    expect(seekBy(-40, true)).not.toBeNull()
    expect(video.currentTime).toBe(6)
  })

  it("con la lista aún corta, retroceder no adelanta aunque su principio quede por delante", async () => {
    const { player, video } = await open()
    player.latestLevelDetails = { age: 0.5, edge: 8, fragmentStart: 0, fragments: [] } // el objetivo, en 3,5; el principio, en 6
    video.currentTime = 3.5
    expect(seekBy(-10)).toBeNull()
    expect(seekBy(-10, true)).not.toBeNull()
    expect(video.currentTime).toBe(3.5)
    expect(current?.rewound).toBe(false)
  })

  it("si hls.js vuelve al directo por su cuenta, deja de contar como retrocedido", async () => {
    const { player, video } = await open()
    fire(video, "playing")
    video.currentTime = 30
    seekBy(-10)
    player.latency = 5.5
    second()
    expect(current?.rewound).toBe(false)
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
