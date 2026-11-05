import { afterEach, describe, expect, it, vi } from "vitest"
import type { DirectoEmpalme } from "./directo"
import { createDirectoHuecos } from "./directo-huecos"

// Un empalme falso que recuerda su canal, para ver quién atiende cada petición.
const fakeEmpalme = (channel: string, vod: string | null = null): DirectoEmpalme => ({
  changed: async () => undefined,
  knowsVodUrl: (url) => url === vod,
  lastPublished: () => 1,
  liveSegmentDuration: () => 2,
  newVisit: () => undefined,
  playlist: () => `#EXTM3U\n#${channel}\n`,
  start: async () => undefined,
  status: () => ({
    filling: false,
    offline: false,
    playing: null,
    published: 1,
    qualities: [],
    quality: null,
    vodFills: 0,
  }),
  stop: vi.fn(),
  waitFor: async () => undefined,
})

// Las veces que se ha pedido ese trozo: el directo también abre sus conexiones con Twitch por adelantado.
const pedidos = (red: ReturnType<typeof vi.fn>, trozo: string): number =>
  red.mock.calls.filter(([url]) => String(url).includes(trozo)).length

const setup = (vods: Record<string, string> = {}) => {
  const created: { channel: string; empalme: DirectoEmpalme }[] = []
  const red = vi.fn(async () => new Response("trozo"))
  const directo = createDirectoHuecos({
    createEmpalme: ({ channel }) => {
      const empalme = fakeEmpalme(channel, vods[channel] ?? null)
      created.push({ channel, empalme })
      return empalme
    },
    fetch: red,
  })
  const get = (path: string): Promise<Response> => directo.handle(new URL(`https://x${path}`))
  return { created, directo, get, red }
}

describe("createDirectoHuecos", () => {
  let stop: () => void = () => undefined
  afterEach(() => stop())

  it("sin hueco, un canal a la vez, como siempre: pedir otro para el anterior", async () => {
    const { created, directo, get } = setup()
    stop = directo.stop
    await get("/stream/a/live.m3u8")
    await get("/stream/b/live.m3u8")
    expect(created.map(({ channel }) => channel)).toEqual(["a", "b"])
    expect(created[0]?.empalme.stop).toHaveBeenCalledOnce()
    expect(created[1]?.empalme.stop).not.toHaveBeenCalled()
  })

  it("cada hueco tiene su canal, sin parar los demás", async () => {
    const { created, directo, get } = setup()
    stop = directo.stop
    const answers = await Promise.all([
      get("/stream/a/live.m3u8"),
      get("/stream/b/live.m3u8?hueco=1"),
      get("/stream/c/live.m3u8?hueco=2"),
      get("/stream/d/live.m3u8?hueco=3"),
    ])
    expect(await Promise.all(answers.map((answer) => answer.text()))).toEqual(
      ["a", "b", "c", "d"].map((channel) => `#EXTM3U\n#${channel}\n`),
    )
    for (const { empalme } of created) expect(empalme.stop).not.toHaveBeenCalled()
  })

  it("otro canal en un hueco para solo el suyo", async () => {
    const { created, directo, get } = setup()
    stop = directo.stop
    await get("/stream/a/live.m3u8")
    await get("/stream/b/live.m3u8?hueco=1")
    await get("/stream/c/live.m3u8?hueco=1")
    expect(created.find(({ channel }) => channel === "a")?.empalme.stop).not.toHaveBeenCalled()
    expect(created.find(({ channel }) => channel === "b")?.empalme.stop).toHaveBeenCalledOnce()
  })

  it("un hueco que no existe va al principal", async () => {
    const { created, directo, get } = setup()
    stop = directo.stop
    await get("/stream/a/live.m3u8")
    await get("/stream/a/live.m3u8?hueco=9")
    expect(created).toHaveLength(1)
  })

  it("los trozos del VOD los atiende quien los publicó, en cualquier hueco", async () => {
    const vod = "https://vod/b.ts"
    const { directo, get, red } = setup({ b: vod })
    stop = directo.stop
    await get("/stream/a/live.m3u8")
    await get("/stream/b/live.m3u8?hueco=2")
    const answer = await get(`/stream/vod?u=${encodeURIComponent(vod)}`)
    expect(answer.status).toBe(200)
    expect(pedidos(red, "/b.ts")).toBe(1)
  })

  it("en una pausa global de varios a la vez, cada uno rellena con su VOD", async () => {
    const vods = { a: "https://vod/a.ts", b: "https://vod/b.ts", c: "https://vod/c.ts" }
    const { directo, get, red } = setup(vods)
    stop = directo.stop
    await get("/stream/a/live.m3u8")
    await get("/stream/b/live.m3u8?hueco=1")
    await get("/stream/c/live.m3u8?hueco=3")
    for (const vod of Object.values(vods)) {
      const answer = await get(`/stream/vod?u=${encodeURIComponent(vod)}`)
      expect(answer.status).toBe(200)
    }
    for (const trozo of ["/a.ts", "/b.ts", "/c.ts"]) expect(pedidos(red, trozo)).toBe(1)
  })

  it("en el registro, cada evento dice de qué celda es", async () => {
    const eventos: Record<string, unknown>[] = []
    const directo = createDirectoHuecos({
      createEmpalme: ({ channel, log }) => {
        log?.({ canal: channel, ev: "prueba" })
        return fakeEmpalme(channel)
      },
      fetch: vi.fn(async () => new Response("")),
      log: (evento) => eventos.push(evento),
    })
    stop = directo.stop
    await directo.handle(new URL("https://x/stream/a/live.m3u8"))
    await directo.handle(new URL("https://x/stream/b/live.m3u8?hueco=2"))
    expect(eventos.map(({ canal, celda }) => [canal, celda])).toEqual([
      ["a", undefined],
      ["b", 2],
    ])
  })

  it("un trozo que nadie ha publicado sigue dando 403, sin pedir nada", async () => {
    const { directo, get, red } = setup()
    stop = directo.stop
    await get("/stream/a/live.m3u8")
    await get("/stream/b/live.m3u8?hueco=1")
    const answer = await get(`/stream/vod?u=${encodeURIComponent("https://otro/x.ts")}`)
    expect(answer.status).toBe(403)
    expect(pedidos(red, "/x.ts")).toBe(0)
  })
})
