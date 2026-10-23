import { afterEach, describe, expect, it, vi } from "vitest"
import { Empalme, type EmpalmeEvent, type EmpalmeOptions, type Published } from "./empalme"
import type { VodSegment, VodSource } from "./twitch-source"

// Listas sintéticas. Índice común i ↔ PDT 12:00:00 + 2·i s, URL https://x/u{i}.ts (con una consulta propia de la
// sesión, como en Twitch).
const t = (i: number, extra = 0): string =>
  new Date(Date.UTC(2026, 9, 10, 12, 0, 0) + i * 2000 + extra * 1000).toISOString()
type Item =
  | readonly ["l", number, number?]
  | readonly ["A"]
  | readonly ["D"]
  | readonly ["p", number]
  | readonly ["pA"]
const playlist = (
  mseq: number,
  lseq: number | null,
  items: readonly Item[],
  pdtShift = 0,
): string => {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:2",
    `#EXT-X-MEDIA-SEQUENCE:${mseq}`,
  ]
  if (lseq !== null) lines.push(`#EXT-X-TWITCH-LIVE-SEQUENCE:${lseq}`)
  let ad = 0
  for (const item of items) {
    if (item[0] === "D") lines.push("#EXT-X-DISCONTINUITY")
    else if (item[0] === "l") {
      lines.push(
        `#EXT-X-PROGRAM-DATE-TIME:${t(item[1] + pdtShift, item[2] ?? 0)}`,
        "#EXTINF:2.000,live",
        `https://x/u${item[1]}.ts?s=${mseq}`,
      )
    } else if (item[0] === "A") {
      lines.push(
        `#EXT-X-PROGRAM-DATE-TIME:${t(1000 + ad)}`,
        "#EXTINF:2.000,Amazon|1",
        `https://x/ad${ad++}.ts`,
      )
    } else if (item[0] === "p") lines.push(`#EXT-X-TWITCH-PREFETCH:https://x/pf${item[1]}.ts`)
    else lines.push("#EXT-X-TWITCH-PREFETCH:https://x/adpf.ts")
  }
  return lines.join("\n")
}
const L = (a: number, b: number): Item[] =>
  Array.from({ length: b - a + 1 }, (_, k) => ["l", a + k] as const)
const A = (n: number): Item[] => Array.from({ length: n }, () => ["A"] as const)

// Tiempo de contenido simulado: índice común i empieza en 1000 + 2·(i − 100); el trozo k del VOD (10 s, cinco
// fragmentos) empieza en 1000 + shift + 10·k.
const probeWith =
  (shift = 0) =>
  async (url: string): Promise<number> => {
    const vod = url.match(/vod(\d+)/)
    if (vod !== null) return 1000 + shift + Number(vod[1]) * 10
    return 1000 + 2 * (Number(url.match(/u(\d+)/)?.[1]) - 100)
  }

const created: Empalme[] = []
const make = (options: Partial<EmpalmeOptions> & { readonly sources: readonly string[] }) => {
  const events: EmpalmeEvent[] = []
  const empalme = new Empalme({
    channel: "x",
    fillPollMs: 1,
    log: (e) => events.push(e),
    ...options,
  })
  created.push(empalme)
  for (const session of empalme.sessionsForTests)
    Object.assign(session, { state: "abierta", url: "x" })
  return { empalme, events, sessions: empalme.sessionsForTests }
}
afterEach(() => {
  for (const empalme of created.splice(0)) empalme.stop()
  vi.useRealTimers()
})
const shape = (out: readonly Published[]): string =>
  out.map((o) => `${o.source === "vod" ? "V" : o.seq}${o.discontinuity ? "D" : ""}`).join(" ")
const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 30))

describe("numeración común", () => {
  it("casa sesiones con numeraciones distintas (preroll y midroll) sin repetir ni publicar anuncios", () => {
    const { empalme, sessions } = make({ sources: ["site", "embed"] })
    const [site, embed] = sessions
    if (site === undefined || embed === undefined) throw new Error("sin sesiones")
    empalme.receive(site, playlist(100, 100, [...L(100, 104), ["p", 105], ["p", 106]]))
    empalme.receive(embed, playlist(0, null, A(3)))
    empalme.receive(embed, playlist(0, 103, [...A(3), ["D"], ...L(103, 106)], -0.4))
    empalme.receive(site, playlist(102, 102, [...L(102, 106), ["D"], ["pA"], ["pA"]]))
    empalme.receive(site, playlist(104, 104, [...L(104, 106), ["D"], ...A(3)]))
    empalme.receive(embed, playlist(4, 104, L(104, 110)))
    empalme.receive(site, playlist(110, 111, [...A(3), ["D"], ...L(111, 112)]))
    empalme.receive(embed, playlist(8, 108, L(108, 112)))
    const out = empalme.publishedForTests
    expect(out.map((o) => o.seq)).toEqual([103, 104, 105, 106, 107, 108, 109, 110, 111, 112])
    expect(out.some((o) => o.url.includes("ad"))).toBe(false)
    // Hora publicada en el reloj común, aunque embed vaya 0,8 s por detrás.
    expect(out.every((o) => o.pdt === t(o.seq ?? 0))).toBe(true)
  })

  it("publica los últimos 100 s, más de lo que el reproductor deja quedarse atrás", () => {
    const { empalme, sessions } = make({ sources: ["embed"] })
    const [embed] = sessions
    if (embed === undefined) throw new Error("sin sesiones")
    // Un hueco (121-124 no llegan nunca) deja una discontinuidad que luego sale de la lista.
    for (let k = 0; k <= 80; k++) {
      const last = 104 + k
      if (last >= 121 && last <= 124) continue
      const first = last > 124 ? Math.max(100 + k, 125) : 100 + k
      empalme.receive(embed, playlist(first, first, L(first, last)))
    }
    const out = empalme.publishedForTests
    expect(out.at(-1)?.seq).toBe(184)
    expect(out.reduce((total, o) => total + o.duration, 0)).toBe(100)
    expect(out[0]?.seq).toBe(135)
    expect(empalme.playlist()).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:1")
  })

  it("retira los prefetch que dejan de estar confirmados", () => {
    const { empalme, sessions, events } = make({ sources: ["site", "embed"] })
    const [site, embed] = sessions
    if (site === undefined || embed === undefined) throw new Error("sin sesiones")
    empalme.receive(embed, playlist(50, 50, L(50, 52)))
    empalme.receive(site, playlist(48, 48, [...L(48, 52), ["p", 53], ["p", 54]]))
    empalme.receive(site, playlist(53, null, A(16)))
    expect([...site.live.values()].some((e) => e.prefetch)).toBe(false)
    expect(events.filter((e) => e.ev === "reclasificado")).toHaveLength(2)
  })

  it("con una sola sesión, espera durante el anuncio y retoma en el primer directo", () => {
    const { empalme, sessions, events } = make({ sources: ["embed"] })
    const [embed] = sessions
    if (embed === undefined) throw new Error("sin sesiones")
    empalme.receive(embed, playlist(100, 100, L(100, 104)))
    empalme.receive(embed, playlist(100, 100, [...L(100, 104), ["D"], ...A(5)]))
    empalme.receive(embed, playlist(105, null, A(20)))
    empalme.receive(embed, playlist(110, 115, [...A(15), ["D"], ...L(115, 116)]))
    expect(shape(empalme.publishedForTests)).toBe("101 102 103 104 115D 116")
    expect(events.some((e) => e.ev === "tardio")).toBe(false)
  })

  it("descarta un fragmento con otra ruta para el mismo índice", () => {
    const { empalme, sessions } = make({ sources: ["site", "embed"] })
    const [site, embed] = sessions
    if (site === undefined || embed === undefined) throw new Error("sin sesiones")
    empalme.receive(site, playlist(10, 10, L(10, 13)))
    empalme.receive(
      embed,
      playlist(10, 10, L(10, 13)).replace("https://x/u12.ts", "https://y/otra12.ts"),
    )
    expect(embed.live.has(12)).toBe(false)
  })

  it("en el modo sin paradas empieza a publicar más atrás del borde", () => {
    const { empalme, sessions } = make({ sources: ["site"], startBackSeconds: 10 })
    const [site] = sessions
    if (site === undefined) throw new Error("sin sesiones")
    empalme.receive(site, playlist(100, 100, L(100, 114)))
    expect(empalme.publishedForTests[0]?.seq).toBe(109) // 114 − 10 s / 2 s
  })

  it("con relleno, TARGETDURATION es fija desde el principio", () => {
    const vodSource: VodSource = { refresh: async () => undefined, segments: [] }
    const { empalme, sessions } = make({ sources: ["site"], vodSource })
    const [site] = sessions
    if (site === undefined) throw new Error("sin sesiones")
    empalme.receive(site, playlist(100, 100, L(100, 104)))
    expect(empalme.playlist()).toContain("#EXT-X-TARGETDURATION:13")
    expect(empalme.playlist()).toContain("#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES")
  })
})

describe("arranque", () => {
  const variant = (resolution: string, url: string) => ({
    bandwidth: resolution === "1920x1080" ? 6000 : 3000,
    fps: 60,
    name: resolution,
    resolution,
    url,
  })
  const opened = (main: ReturnType<typeof variant>, ...others: ReturnType<typeof variant>[]) => ({
    ...main,
    broadcastId: "b1",
    expires: 0,
    variants: [main, ...others],
  })

  it("abre las sesiones a la vez y publica con la primera que da directo, sin esperar a las demás", async () => {
    const order: string[] = []
    let releaseSite = (): void => undefined
    const empalme = new Empalme({
      channel: "x",
      fetchPlaylist: async () => playlist(100, 100, L(100, 104)),
      openSession: async (_channel, type) => {
        if (type === "site") await new Promise<void>((done) => (releaseSite = done))
        order.push(type)
        return opened(variant("1920x1080", `https://x/${type}.m3u8`))
      },
      sources: ["site", "embed"],
    })
    created.push(empalme)
    void empalme.start()
    await empalme.waitFor(0, 1000)
    expect(order).toEqual(["embed"]) // site sigue abriendo
    expect(shape(empalme.publishedForTests)).toBe("101 102 103 104")
    releaseSite()
  })

  it("si otra sesión ya fijó la calidad, usa esa misma de su lista maestra", async () => {
    let releaseEmbed = (): void => undefined
    const empalme = new Empalme({
      channel: "x",
      fetchPlaylist: async () => playlist(100, 100, L(100, 104)),
      openSession: async (_channel, type) => {
        if (type === "site") return opened(variant("1920x1080", "https://x/site-1080.m3u8"))
        await new Promise<void>((done) => (releaseEmbed = done))
        // Pedida sin calidad (las dos a la vez), embed habría elegido otra.
        return opened(
          variant("1280x720", "https://x/embed-720.m3u8"),
          variant("1920x1080", "https://x/embed-1080.m3u8"),
        )
      },
      sources: ["site", "embed"],
    })
    created.push(empalme)
    const started = empalme.start()
    await tick()
    releaseEmbed()
    await started
    expect(empalme.sessionsForTests.map((s) => s.url)).toEqual([
      "https://x/site-1080.m3u8",
      "https://x/embed-1080.m3u8",
    ])
    expect(empalme.status()).toMatchObject({ playing: "1920x1080@60", quality: "1920x1080@60" })
  })

  // Como openVariant (pickVariant): la variante pedida o, si el canal no la tiene, la misma resolución, la mejor que no
  // pase de ella o la primera de su lista.
  const offering =
    (...variants: ReturnType<typeof variant>[]) =>
    async (
      _channel: string,
      _type: string,
      _device: string,
      want: { readonly fps: number; readonly resolution: string } | null,
    ) => {
      const height = (resolution: string): number => Number(resolution.split("x")[1])
      const main =
        want === null
          ? variants[0]
          : (variants.find((v) => v.resolution === want.resolution && v.fps === want.fps) ??
            variants.find((v) => v.resolution === want.resolution) ??
            variants.find((v) => height(v.resolution) <= height(want.resolution)) ??
            variants[0])
      if (main === undefined) throw new Error("sin variantes")
      return opened(main, ...variants.filter((v) => v !== main))
    }

  it("si una sesión no tiene la calidad que fijó otra, usa la más parecida; suena la de la primera (REP-4)", async () => {
    let releaseEmbed = (): void => undefined
    const empalme = new Empalme({
      channel: "x",
      fetchPlaylist: async () => playlist(100, 100, L(100, 104)),
      openSession: async (...args) => {
        if (args[1] === "site") {
          return offering(
            variant("1920x1080", "https://x/site-1080.m3u8"),
            variant("1280x720", "https://x/site-720.m3u8"),
          )(...args)
        }
        await new Promise<void>((done) => (releaseEmbed = done))
        return offering(variant("1280x720", "https://x/embed-720.m3u8"))(...args)
      },
      sources: ["site", "embed"],
    })
    created.push(empalme)
    const started = empalme.start()
    await tick()
    releaseEmbed()
    await started
    expect(empalme.sessionsForTests.map((s) => s.url)).toEqual([
      "https://x/site-1080.m3u8",
      "https://x/embed-720.m3u8",
    ])
    expect(empalme.status()).toMatchObject({ playing: "1920x1080@60", quality: "1920x1080@60" })
  })

  it("si el canal no tiene la calidad pedida (elegida en otro canal), usa la de reserva", async () => {
    const empalme = new Empalme({
      channel: "x",
      fetchPlaylist: async () => playlist(100, 100, L(100, 104)),
      openSession: offering(variant("1920x1080", "https://x/1080.m3u8")),
      sources: ["site", "embed"],
      want: { fps: 60, resolution: "1280x720" },
    })
    created.push(empalme)
    await empalme.start()
    await empalme.waitFor(0, 1000)
    expect(empalme.status()).toMatchObject({ offline: false, published: 4 })
    expect(empalme.sessionsForTests.map((s) => s.url)).toEqual([
      "https://x/1080.m3u8",
      "https://x/1080.m3u8",
    ])
    // El menú enseña la que suena; la pedida sigue siendo con la que se compara una petición nueva (directo.ts).
    expect(empalme.status()).toMatchObject({ playing: "1920x1080@60", quality: "1280x720@60" })
  })

  it("si la emisión nueva ya no tiene la calidad fijada, reinicia la línea de tiempo con la de reserva", async () => {
    vi.useFakeTimers()
    let broadcast = 1
    const events: EmpalmeEvent[] = []
    const empalme = new Empalme({
      channel: "x",
      // La lista de la emisión anterior deja de existir; la nueva empieza su numeración de cero.
      fetchPlaylist: async (url) => {
        if (url.includes("e1")) {
          if (broadcast === 2) throw new Error("HTTP 404")
          return playlist(5000, 5000, L(5000, 5004))
        }
        return playlist(0, 0, L(0, 3))
      },
      log: (e) => events.push(e),
      openSession: async (...args) =>
        broadcast === 1
          ? opened(variant("1920x1080", "https://x/e1-1080.m3u8"))
          : {
              ...(await offering(variant("1280x720", "https://x/e2-720.m3u8"))(...args)),
              broadcastId: "b2",
            },
      sources: ["site", "embed"],
    })
    created.push(empalme)
    void empalme.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(shape(empalme.publishedForTests)).toBe("5001 5002 5003 5004")
    broadcast = 2
    await vi.advanceTimersByTimeAsync(5000)
    expect(events.some((e) => e.ev === "nueva-emision")).toBe(true)
    expect(shape(empalme.publishedForTests)).toBe("5001 5002 5003 5004 0D 1 2 3")
    expect(empalme.status()).toMatchObject({ playing: "1280x720@60", quality: "1920x1080@60" })
  })
})

describe("sesiones por defecto", () => {
  it("son site, embed, popout y, de respaldo, mobile_feed con platform android", () => {
    const empalme = new Empalme({ channel: "x" })
    created.push(empalme)
    expect(empalme.sessionsForTests.map((s) => s.type)).toEqual([
      "site",
      "embed",
      "popout",
      "mobile_feed@android",
    ])
  })
})

describe("arranque con aperturas a la vez", () => {
  const variant = (broadcastId: string, url: string) => ({
    bandwidth: 6000,
    broadcastId,
    expires: 0,
    fps: 60,
    name: "1080p60",
    resolution: "1920x1080",
    url,
    variants: [{ bandwidth: 6000, fps: 60, name: "1080p60", resolution: "1920x1080", url }],
  })

  it("no da el canal por desconectado mientras otra sesión sigue abriendo", async () => {
    vi.useFakeTimers()
    let release = (): void => undefined
    const empalme = new Empalme({
      channel: "x",
      fetchPlaylist: async () => playlist(100, 100, L(100, 104)),
      openSession: async (_channel, type) => {
        if (type !== "popout") throw new Error("HTTP 500")
        await new Promise<void>((done) => (release = done))
        return variant("b1", "https://x/popout.m3u8")
      },
      sources: ["site", "embed", "popout"],
    })
    created.push(empalme)
    void empalme.start()
    await vi.advanceTimersByTimeAsync(5000) // site y embed reintentan y vuelven a fallar
    expect(empalme.status().offline).toBe(false)
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(empalme.status()).toMatchObject({ offline: false, published: 4 })
  })

  it("no arranca desde el VOD por una sesión con anuncio mientras otra sigue abriendo", async () => {
    let release = (): void => undefined
    const vodSource: VodSource = {
      refresh: async () => undefined,
      segments: [0, 1, 2].map((k) => ({
        duration: 10,
        elapsed: 10 * k,
        map: null,
        url: `https://v/vod${k}.ts`,
      })),
    }
    const { empalme, events } = (() => {
      const events: EmpalmeEvent[] = []
      const empalme = new Empalme({
        channel: "x",
        fetchPlaylist: async (url) =>
          url.includes("site") ? playlist(0, null, A(5)) : playlist(100, 100, L(100, 104)),
        log: (e) => events.push(e),
        openSession: async (_channel, type) => {
          if (type === "embed") await new Promise<void>((done) => (release = done))
          return variant("b1", `https://x/${type}.m3u8`)
        },
        probe: probeWith(),
        sources: ["site", "embed"],
        vodSource,
      })
      created.push(empalme)
      return { empalme, events }
    })()
    void empalme.start()
    await tick()
    expect(events.some((e) => e.ev === "arranque-vod")).toBe(false)
    release()
    await empalme.waitFor(0, 1000)
    expect(shape(empalme.publishedForTests)).toBe("101 102 103 104")
  })

  it("una apertura lenta con la emisión anterior no deshace el cambio de emisión", async () => {
    let releaseSite = (): void => undefined
    const events: EmpalmeEvent[] = []
    const empalme = new Empalme({
      channel: "x",
      fetchPlaylist: async () => playlist(100, 100, L(100, 104)),
      log: (e) => events.push(e),
      openSession: async (_channel, type) => {
        if (type === "site") {
          await new Promise<void>((done) => (releaseSite = done))
          return variant("41000000099", "https://x/site.m3u8") // la emisión anterior
        }
        return variant("41000000100", "https://x/embed.m3u8")
      },
      sources: ["site", "embed"],
    })
    created.push(empalme)
    void empalme.start()
    await empalme.waitFor(0, 1000)
    releaseSite()
    await tick()
    expect(events.some((e) => e.ev === "nueva-emision")).toBe(false)
    expect(empalme.sessionsForTests[0]?.state).toBe("error") // se reintentará
    expect(empalme.publishedForTests.length).toBe(4)
  })
})

describe("emisión nueva", () => {
  it("reinicia la línea de tiempo, reabre las otras sesiones y descarta sus respuestas antiguas", () => {
    const { empalme, sessions, events } = make({ sources: ["site", "embed"] })
    const [site, embed] = sessions
    if (site === undefined || embed === undefined) throw new Error("sin sesiones")
    empalme.receive(site, playlist(5000, 5000, L(5000, 5004)))
    empalme.receive(embed, playlist(5000, 5000, L(5000, 5004)))
    empalme.receive(site, playlist(0, 0, L(0, 3)))
    expect(events.some((e) => e.ev === "nueva-emision")).toBe(true)
    expect(embed.state).toBe("error")
    expect(embed.url).toBeNull()
    // Una respuesta de embed pedida antes del reinicio (generación anterior) no se publica.
    empalme.receive(embed, playlist(5001, 5001, L(5001, 5008)), -1)
    expect(shape(empalme.publishedForTests).endsWith("0D 1 2 3")).toBe(true)
  })
})

describe("relleno con el VOD", () => {
  const vodOf = (count: number): { segments: VodSegment[]; refresh: () => Promise<void> } => ({
    refresh: async () => undefined,
    segments: Array.from({ length: count }, (_, k) => ({
      duration: 10,
      elapsed: k * 10,
      map: null,
      url: `https://v/vod${k}.ts`,
    })),
  })
  const pause = async (options: Partial<EmpalmeOptions>, vodSource: ReturnType<typeof vodOf>) => {
    const made = make({ sources: ["embed"], vodSource, ...options })
    const [embed] = made.sessions
    if (embed === undefined) throw new Error("sin sesiones")
    made.empalme.receive(embed, playlist(100, 100, L(100, 104)))
    made.empalme.receive(embed, playlist(100, 100, [...L(100, 104), ["D"], ...A(3)]))
    made.empalme.receive(embed, playlist(105, null, A(16)))
    await tick()
    return { ...made, embed }
  }

  it("rellena una pausa global y vuelve al directo exacto (bordes alineados)", async () => {
    const { empalme, embed } = await pause({ probe: probeWith(0) }, vodOf(4))
    empalme.receive(embed, playlist(110, 117, [...A(5), ["D"], ...L(117, 124)]))
    await tick()
    expect(shape(empalme.publishedForTests)).toBe("101 102 103 104 V V V 120 121 122 123 124")
  })

  it("con el recorte comprobado entra sin repetir ni saltar", async () => {
    const { empalme, embed } = await pause(
      { probe: probeWith(4), vodTrimmer: async (_url, from) => from },
      vodOf(4),
    )
    empalme.receive(embed, playlist(110, 117, [...A(5), ["D"], ...L(117, 124)]))
    await tick()
    expect(shape(empalme.publishedForTests)).toBe("101 102 103 104 V V V V 122 123 124")
  })

  it("si el recorte no se puede comprobar, anuncia el salto", async () => {
    const { empalme, embed, events } = await pause(
      { probe: probeWith(4), vodTrimmer: async () => null },
      vodOf(4),
    )
    empalme.receive(embed, playlist(110, 117, [...A(5), ["D"], ...L(117, 124)]))
    await tick()
    expect(events.some((e) => e.ev === "recorte-fallido")).toBe(true)
    expect(shape(empalme.publishedForTests)).toContain("VD")
  })

  it("si el directo vuelve por delante, espera al siguiente trozo del VOD y vuelve exacto", async () => {
    const vod = vodOf(3)
    const { empalme, embed } = await pause({ probe: probeWith(0) }, vod)
    empalme.receive(embed, playlist(110, 117, [...A(5), ["D"], ...L(117, 124)]))
    await tick()
    expect(shape(empalme.publishedForTests)).toBe("101 102 103 104 V V") // esperando
    vod.segments.push({ duration: 10, elapsed: 30, map: null, url: "https://v/vod3.ts" })
    await tick()
    expect(shape(empalme.publishedForTests)).toBe("101 102 103 104 V V V 120 121 122 123 124")
  })

  it("si todas las sesiones arrancan con anuncio, empieza en el VOD y vuelve al directo exacto", async () => {
    // Con la hora que trae la lista del VOD: el trozo k empieza donde el índice 100 + 5k.
    const vod = vodOf(4)
    for (const [k, segment] of vod.segments.entries())
      vod.segments[k] = { ...segment, pdt: t(100 + 5 * k) }
    const { empalme, events, sessions } = make({
      probe: probeWith(0),
      sources: ["site", "embed"],
      vodSource: vod,
    })
    const [site, embed] = sessions
    if (site === undefined || embed === undefined) throw new Error("sin sesiones")
    empalme.receive(site, playlist(50, null, A(5)))
    await tick()
    expect(empalme.publishedForTests).toHaveLength(0) // embed aún no ha dado su lista
    empalme.receive(embed, playlist(70, null, A(5)))
    await tick()
    // Dos trozos antes del final del VOD (1020-1040), con su hora.
    expect(shape(empalme.publishedForTests)).toBe("V V")
    expect(empalme.publishedForTests.map((o) => o.pdt)).toEqual([t(110), t(115)])
    expect(empalme.status().filling).toBe(true)
    // Acaba el anuncio de entrada de site: su directo llega al final de lo publicado (1040 = índice 120).
    empalme.receive(site, playlist(55, 110, [...A(5), ["D"], ...L(110, 125)]))
    await tick()
    expect(shape(empalme.publishedForTests)).toBe("V V 120 121 122 123 124 125")
    // La hora sigue sin saltos del VOD al directo.
    expect(empalme.publishedForTests.at(2)?.pdt).toBe(t(120))
    expect(events.find((e) => e.ev === "relleno-fin")).toMatchObject({ saltoS: 0, seq: 120 })
    expect(events.some((e) => e.ev === "arranque-vod")).toBe(true)
  })

  it("al empezar en el VOD sin hora en su lista, la saca de cuándo empezó a grabarse; sin eso, sin hora", async () => {
    const start = async (vodSource: VodSource) => {
      const { empalme, sessions } = make({ probe: probeWith(0), sources: ["site"], vodSource })
      const [site] = sessions
      if (site === undefined) throw new Error("sin sesiones")
      empalme.receive(site, playlist(50, null, A(5)))
      await tick()
      return empalme.publishedForTests.map((o) => o.pdt)
    }
    const grabado = Date.parse(t(100)) + 2000 // ~2 s por detrás, como en Twitch
    expect(await start({ ...vodOf(4), recordedAt: grabado })).toEqual([
      new Date(grabado + 20_000).toISOString(),
      new Date(grabado + 30_000).toISOString(),
    ])
    expect(await start(vodOf(4))).toEqual([null, null])
  })

  it("si el directo vuelve antes de publicar ningún trozo del VOD, no cuenta como relleno", async () => {
    let release: () => void = () => undefined
    const vod = vodOf(4)
    const vodSource: VodSource = {
      refresh: () => new Promise<void>((done) => (release = done)),
      segments: vod.segments,
    }
    const { empalme, sessions } = make({ probe: probeWith(0), sources: ["site"], vodSource })
    const [site] = sessions
    if (site === undefined) throw new Error("sin sesiones")
    empalme.receive(site, playlist(50, null, A(5)))
    await tick()
    // Mientras se lee el VOD, acaba el anuncio y el directo ya cubre el punto de arranque (1020 = índice 110).
    empalme.receive(site, playlist(55, 110, [...A(5), ["D"], ...L(110, 115)]))
    release()
    await tick()
    expect(shape(empalme.publishedForTests)).toBe("110 111 112 113 114 115")
    // La primera pausa global real seguirá esperando la holgura.
    expect(empalme.status().vodFills).toBe(0)
  })

  it("si el VOD va tan atrasado que no alcanza el directo, acaba saltando a él", async () => {
    // Con el reloj de verdad, un equipo lento agotaba el plazo antes del trozo nuevo del VOD (falló en la CI).
    vi.useFakeTimers()
    const vod = vodOf(4)
    const { empalme, sessions } = make({
      probe: probeWith(0),
      returnAheadMaxMs: 1000,
      sources: ["site"],
      vodSource: vod,
    })
    const [site] = sessions
    if (site === undefined) throw new Error("sin sesiones")
    empalme.receive(site, playlist(50, null, A(5)))
    await vi.advanceTimersByTimeAsync(30)
    expect(shape(empalme.publishedForTests)).toBe("V V")
    // El directo que se conserva empieza mucho después del VOD (1400 frente a 1040).
    empalme.receive(site, playlist(55, 300, [...A(5), ["D"], ...L(300, 305)]))
    await vi.advanceTimersByTimeAsync(30)
    // Dentro del plazo, publica el trozo que llega del VOD en vez de saltar.
    vod.segments.push({ duration: 10, elapsed: 40, map: null, url: "https://v/vod4.ts" })
    await vi.advanceTimersByTimeAsync(30)
    expect(shape(empalme.publishedForTests)).toBe("V V V")
    // Agotado el plazo, salta al directo.
    await vi.advanceTimersByTimeAsync(1000)
    expect(shape(empalme.publishedForTests)).toBe("V V V 300D 301 302 303 304 305")
  })

  it("sin VOD (modo directo), espera a que acabe el anuncio de entrada", async () => {
    const { empalme, sessions } = make({ probe: probeWith(0), sources: ["site"], vod: false })
    const [site] = sessions
    if (site === undefined) throw new Error("sin sesiones")
    empalme.receive(site, playlist(50, null, A(5)))
    await tick()
    expect(empalme.publishedForTests).toHaveLength(0)
    empalme.receive(site, playlist(55, 110, [...A(5), ["D"], ...L(110, 115)]))
    await tick()
    expect(shape(empalme.publishedForTests)).toBe("112 113 114 115")
  })

  it("no suelta el primer trozo del VOD hasta tener el siguiente (una sola parada)", async () => {
    const vod = vodOf(2) // trozos 0 y 1: el cursor (1010) está al principio del 1 y aún no hay 2
    const { empalme } = await pause({ probe: probeWith(0) }, vod)
    expect(shape(empalme.publishedForTests)).toBe("101 102 103 104")
    vod.segments.push({ duration: 10, elapsed: 20, map: null, url: "https://v/vod2.ts" })
    await tick()
    expect(shape(empalme.publishedForTests)).toBe("101 102 103 104 V V")
  })

  it("solo espera esa holgura en el primer relleno de la visita", async () => {
    const vod = vodOf(4)
    const { empalme, embed } = await pause({ probe: probeWith(0) }, vod)
    empalme.receive(embed, playlist(110, 117, [...A(5), ["D"], ...L(117, 124)]))
    await tick()
    expect(empalme.status().vodFills).toBe(1)
    // Segunda pausa global (cursor 1050): el VOD solo cubre 10 s por delante, menos que un trozo más la holgura, y
    // aun así se publica, porque el reproductor ya conserva el margen del primer relleno.
    empalme.receive(embed, playlist(117, 117, [...L(117, 124), ["D"], ...A(3)]))
    empalme.receive(embed, playlist(125, null, A(16)))
    vod.segments.push({ duration: 10, elapsed: 40, map: null, url: "https://v/vod4.ts" })
    vod.segments.push({ duration: 10, elapsed: 50, map: null, url: "https://v/vod5.ts" })
    await tick()
    expect(shape(empalme.publishedForTests).endsWith("124 V")).toBe(true)
  })

  it("una visita nueva al mismo empalme vuelve a esperar la holgura", async () => {
    const vod = vodOf(4)
    const { empalme, embed } = await pause({ probe: probeWith(0) }, vod)
    empalme.receive(embed, playlist(110, 117, [...A(5), ["D"], ...L(117, 124)]))
    await tick()
    empalme.newVisit() // otro reproductor, que arranca con el margen corto
    empalme.receive(embed, playlist(117, 117, [...L(117, 124), ["D"], ...A(3)]))
    empalme.receive(embed, playlist(125, null, A(16)))
    vod.segments.push({ duration: 10, elapsed: 40, map: null, url: "https://v/vod4.ts" })
    vod.segments.push({ duration: 10, elapsed: 50, map: null, url: "https://v/vod5.ts" })
    await tick()
    expect(shape(empalme.publishedForTests).endsWith("124")).toBe(true)
    vod.segments.push({ duration: 10, elapsed: 60, map: null, url: "https://v/vod6.ts" })
    await tick()
    expect(shape(empalme.publishedForTests)).toMatch(/124 V V$/) // con la holgura, el retenido y el siguiente
  })

  it("un relleno anulado por una emisión nueva ya no publica", async () => {
    let release: () => void = () => undefined
    const vodSource: VodSource = {
      refresh: () => new Promise<void>((done) => (release = done)),
      segments: [{ duration: 10, elapsed: 0, map: null, url: "https://v/vod1.ts" }],
    }
    const {
      empalme,
      sessions,
      events: eventsLog,
    } = make({ probe: probeWith(0), sources: ["embed"], vodSource })
    const [embed] = sessions
    if (embed === undefined) throw new Error("sin sesiones")
    empalme.receive(embed, playlist(5000, 5000, L(5000, 5004)))
    empalme.receive(embed, playlist(5005, null, A(16)))
    await tick()
    empalme.receive(embed, playlist(0, 0, L(0, 3))) // emisión nueva mientras el relleno espera al VOD
    release()
    await tick()
    expect(eventsLog.some((e) => e.ev === "nueva-emision")).toBe(true)
    expect(empalme.publishedForTests.some((o) => o.source === "vod")).toBe(false)
  })
})
