import { afterEach, describe, expect, it, vi } from "vitest"
import { createDirecto, type Directo, type DirectoEmpalme, parseSimulatedPause } from "./directo"
import type { EmpalmeOptions, EmpalmeStatus } from "./empalme"

// Empalme falso: lo que publica lo deciden las pruebas.
class FakeEmpalme implements DirectoEmpalme {
  status_: EmpalmeStatus = {
    filling: false,
    offline: false,
    published: 0,
    qualities: [],
    quality: null,
    vodFills: 0,
  }
  text: string | null = null
  stopped = false
  visits = 0
  readonly waits: number[] = []
  readonly vodUrls = new Set<string>()
  constructor(readonly options: EmpalmeOptions) {}
  knowsVodUrl(url: string): boolean {
    return this.vodUrls.has(url)
  }
  last: number | null = null
  lastPublished(): number | null {
    return this.last ?? (this.text === null ? null : 0)
  }
  liveSegmentDuration(): number | null {
    return 2
  }
  newVisit(): void {
    this.visits++
  }
  playlist(): string | null {
    return this.text
  }
  async start(): Promise<void> {}
  status(): EmpalmeStatus {
    return this.status_
  }
  stop(): void {
    this.stopped = true
  }
  async waitFor(n: number): Promise<void> {
    this.waits.push(n)
  }
  private readonly listeners = new Set<() => void>()
  changed(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (this.stopped) return Promise.resolve() // como el de verdad: parado, ya no hay nada que esperar
    return new Promise((done) => {
      const finish = (): void => {
        clearTimeout(timer)
        done()
      }
      const timer = setTimeout(finish, timeoutMs)
      signal?.addEventListener("abort", finish)
      this.listeners.add(finish)
    })
  }
  notify(): void {
    for (const listener of this.listeners) listener()
    this.listeners.clear()
  }
}

const url = (path: string): URL => new URL(path, "chrome-extension://abc/reproductor.html")

let directo: Directo | undefined
const open = (): { directo: Directo; empalmes: FakeEmpalme[]; events: string[] } => {
  const empalmes: FakeEmpalme[] = []
  const events: string[] = []
  directo = createDirecto({
    createEmpalme: (options) => {
      const empalme = new FakeEmpalme(options)
      empalmes.push(empalme)
      return empalme
    },
    log: (event) => events.push(event.ev),
  })
  return { directo, empalmes, events }
}

afterEach(() => {
  directo?.stop()
  directo = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("parseSimulatedPause", () => {
  it("lee cada, duración y arranque", () => {
    expect(parseSimulatedPause("150,45")).toEqual({ atStart: false, every: 150, length: 45 })
    expect(parseSimulatedPause("0,20,1")).toEqual({ atStart: true, every: 0, length: 20 })
  })
  it("sin duración, o sin cada ni arranque, no hay pausa", () => {
    expect(parseSimulatedPause("")).toBeNull()
    expect(parseSimulatedPause("150,0")).toBeNull()
    expect(parseSimulatedPause("0,20")).toBeNull()
  })
})

describe("createDirecto", () => {
  it("rechaza rutas desconocidas y nombres de canal no válidos", async () => {
    const { directo, empalmes } = open()
    expect((await directo.handle(url("/otra"))).status).toBe(404)
    expect((await directo.handle(url("/stream/Mayus/live.m3u8"))).status).toBe(404)
    expect((await directo.handle(url("/stream/canal/otra"))).status).toBe(404)
    expect(empalmes).toHaveLength(0)
  })

  it("elige el modo y la calidad del empalme por la consulta", async () => {
    const { directo, empalmes } = open()
    await directo.handle(url("/stream/canal/live.m3u8?modo=sin-paradas&q=1920x1080@60"))
    expect(empalmes[0]?.options).toMatchObject({
      channel: "canal",
      fillSlack: null,
      startBackSeconds: 24,
      vod: true,
      want: { fps: 60, resolution: "1920x1080" },
    })
    await directo.handle(url("/stream/canal/live.m3u8?modo=inventado"))
    expect(empalmes[0]?.stopped).toBe(true)
    expect(empalmes[1]?.options).toMatchObject({ fillSlack: 2, startBackSeconds: null, vod: true })
  })

  it("reutiliza el empalme del mismo canal y modo, y avisa de cada visita nueva", async () => {
    const { directo, empalmes } = open()
    await directo.handle(url("/stream/canal/live.m3u8?modo=directo&visita=a1"))
    await directo.handle(url("/stream/canal/live.m3u8?modo=directo&visita=a1"))
    await directo.handle(url("/stream/canal/live.m3u8?modo=directo&visita=b2"))
    expect(empalmes).toHaveLength(1)
    expect(empalmes[0]?.visits).toBe(1)
    await directo.handle(url("/stream/otro/live.m3u8?modo=directo"))
    expect(empalmes).toHaveLength(2)
    expect(empalmes[0]?.stopped).toBe(true)
  })

  it("la lista espera al fragmento pedido y responde según lo publicado", async () => {
    const { directo, empalmes } = open()
    const first = await directo.handle(url("/stream/canal/live.m3u8"))
    expect(first.status).toBe(503)
    const empalme = empalmes[0]
    if (empalme === undefined) throw new Error("sin empalme")
    empalme.text = "#EXTM3U\n"
    const second = await directo.handle(url("/stream/canal/live.m3u8?_HLS_msn=42"))
    expect(empalme.waits).toEqual([42])
    expect(second.status).toBe(200)
    expect(second.headers.get("content-type")).toBe("application/vnd.apple.mpegurl")
    expect(await second.text()).toBe("#EXTM3U\n")
    empalme.text = null
    empalme.status_ = { ...empalme.status_, offline: true }
    expect((await directo.handle(url("/stream/canal/live.m3u8"))).status).toBe(404)
  })

  it("precalentar abre otro empalme sin parar el que suena, y al abrir ese canal pasa a activo", async () => {
    const { directo, empalmes, events } = open()
    await directo.handle(url("/stream/uno/live.m3u8?visita=a1"))
    const warm = await directo.handle(url("/stream/dos/precalentar?modo=adaptativo"))
    expect(warm.status).toBe(204)
    expect(empalmes.map((e) => [e.options.channel, e.stopped])).toEqual([
      ["uno", false],
      ["dos", false],
    ])
    expect(events).toContain("precalentado")
    await directo.handle(url("/stream/dos/live.m3u8?visita=b2"))
    expect(empalmes).toHaveLength(2) // el precalentado, ya en marcha
    expect(empalmes[0]?.stopped).toBe(true)
    expect(empalmes[1]?.visits).toBe(1)
  })

  it("solo hay un precalentado, y precalentar el que suena no abre otro", async () => {
    const { directo, empalmes } = open()
    await directo.handle(url("/stream/uno/live.m3u8"))
    await directo.handle(url("/stream/uno/precalentar"))
    expect(empalmes).toHaveLength(1)
    await directo.handle(url("/stream/dos/precalentar"))
    await directo.handle(url("/stream/dos/precalentar"))
    await directo.handle(url("/stream/tres/precalentar"))
    expect(empalmes.map((e) => [e.options.channel, e.stopped])).toEqual([
      ["uno", false],
      ["dos", true],
      ["tres", false],
    ])
    // Otro modo es otro empalme: el precalentado no sirve.
    await directo.handle(url("/stream/tres/live.m3u8?modo=directo"))
    expect(empalmes.map((e) => e.stopped)).toEqual([true, true, false, false])
  })

  it("un precalentado que nadie abre se para como cualquier otro", async () => {
    vi.useFakeTimers()
    const { directo, empalmes } = open()
    await directo.handle(url("/stream/dos/precalentar"))
    await vi.advanceTimersByTimeAsync(36_000)
    expect(empalmes[0]?.stopped).toBe(true)
  })

  it("sin _HLS_msn, el reproductor que ya tiene lo último espera a algo nuevo; uno nuevo, no", async () => {
    const { directo, empalmes } = open()
    await directo.handle(url("/stream/canal/live.m3u8?visita=a1"))
    const empalme = empalmes[0]
    if (empalme === undefined) throw new Error("sin empalme")
    empalme.text = "#EXTM3U\n"
    empalme.last = 41
    await directo.handle(url("/stream/canal/live.m3u8?visita=a1")) // la primera lista que recibe
    expect(empalme.waits).toEqual([])
    await directo.handle(url("/stream/canal/live.m3u8?visita=a1")) // tras una sin novedades
    expect(empalme.waits).toEqual([42])
    await directo.handle(url("/stream/canal/live.m3u8?visita=b2")) // otro reproductor: enseguida
    expect(empalme.waits).toEqual([42])
  })

  it("info espera a que haya algo publicado", async () => {
    vi.useFakeTimers()
    const { directo, empalmes } = open()
    let answered = false
    const pending = directo.handle(url("/stream/canal/info")).then((response) => {
      answered = true
      return response
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(answered).toBe(false)
    const empalme = empalmes[0]
    if (empalme === undefined) throw new Error("sin empalme")
    empalme.status_ = { ...empalme.status_, published: 3, quality: "1280x720@30" }
    empalme.notify() // responde en cuanto el empalme publica, sin esperar a ningún temporizador
    await vi.advanceTimersByTimeAsync(0)
    const response = await pending
    expect(await response.json()).toMatchObject({
      published: 3,
      quality: "1280x720@30",
      segmentDuration: 2,
    })
  })

  it("info deja de esperar, sin bloquear la página, si su empalme se para por otro canal", async () => {
    const { directo, empalmes } = open()
    const started = Date.now()
    const pending = directo.handle(url("/stream/uno/info"))
    await directo.handle(url("/stream/dos/live.m3u8"))
    expect(empalmes[0]?.stopped).toBe(true)
    // Si el bucle de info no cediera el hilo, este temporizador correría tarde. undefined: aún no ha corrido (con
    // Date.now(), lo que tarda puede ser 0 ms).
    let timer: number | undefined
    setTimeout(() => (timer = Date.now() - started), 0)
    expect((await pending).status).toBe(200)
    await new Promise((done) => setTimeout(done, 10))
    expect(timer).toBeDefined()
    expect(timer).toBeLessThan(1000)
  })

  it("info deja de esperar si quien pide se va", async () => {
    vi.useFakeTimers()
    const { directo } = open()
    const gone = new AbortController()
    const pending = directo.handle(url("/stream/canal/info"), { signal: gone.signal })
    gone.abort()
    await vi.advanceTimersByTimeAsync(250)
    expect((await pending).status).toBe(200)
  })

  it("solo sirve trozos del VOD que el empalme ha publicado, con su Range", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-range": "bytes 0-2/10", "content-type": "video/mp2t", "x-otra": "1" },
          status: 206,
        }),
    )
    vi.stubGlobal("fetch", fetch)
    const { directo, empalmes } = open()
    const vod = "https://d1.cloudfront.net/v/1.ts"
    const path = `/stream/vod?${new URLSearchParams({ u: vod })}`
    expect((await directo.handle(url(path))).status).toBe(403) // sin empalme
    await directo.handle(url("/stream/canal/live.m3u8"))
    expect((await directo.handle(url(path))).status).toBe(403) // no publicado
    empalmes[0]?.vodUrls.add(vod)
    const response = await directo.handle(url(path), { range: "bytes=0-2" })
    expect(fetch).toHaveBeenCalledWith(
      vod,
      expect.objectContaining({ headers: { Range: "bytes=0-2" } }),
    )
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe("bytes 0-2/10")
    expect(response.headers.get("x-otra")).toBeNull()
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it("un fallo de red da 500 y se registra", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("sin red")
      }),
    )
    const { directo, empalmes, events } = open()
    const vod = "https://d1.cloudfront.net/v/2.ts"
    await directo.handle(url("/stream/canal/live.m3u8"))
    empalmes[0]?.vodUrls.add(vod)
    const response = await directo.handle(url(`/stream/vod?${new URLSearchParams({ u: vod })}`))
    expect(response.status).toBe(500)
    expect(events).toContain("error-servidor")
  })

  it("una petición abandonada no se registra como error del servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        init.signal?.throwIfAborted()
        return new Response()
      }),
    )
    const { directo, empalmes, events } = open()
    const vod = "https://d1.cloudfront.net/v/3.ts"
    await directo.handle(url("/stream/canal/live.m3u8"))
    empalmes[0]?.vodUrls.add(vod)
    const gone = new AbortController()
    gone.abort()
    await directo.handle(url(`/stream/vod?${new URLSearchParams({ u: vod })}`), {
      signal: gone.signal,
    })
    expect(events).not.toContain("error-servidor")
  })

  it("para el empalme tras 30 s sin peticiones", async () => {
    vi.useFakeTimers()
    const { directo, empalmes } = open()
    await directo.handle(url("/stream/canal/live.m3u8"))
    await vi.advanceTimersByTimeAsync(31_000)
    expect(empalmes[0]?.stopped).toBe(false) // aún no ha pasado la revisión siguiente
    await vi.advanceTimersByTimeAsync(5000)
    expect(empalmes[0]?.stopped).toBe(true)
  })
})
