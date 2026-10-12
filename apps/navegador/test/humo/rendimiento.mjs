// Rendimiento del reproductor en la interfaz de escritorio, en Chrome for Testing: para cada canal, el arranque por
// hitos (desde que se abre el canal hasta el primer fotograma y hasta que avanza), y durante unos segundos de
// reproducción la latencia respecto al emisor, el margen hasta el final del búfer, las paradas, los fotogramas
// perdidos, el trabajo del hilo principal y la CPU de todo el navegador.
// Uso, desde la raíz y con la extensión compilada:
//   node apps/navegador/test/humo/rendimiento.mjs --canales a,b,c [--rondas 2] [--segundos 60] [--modo adaptativo]
//     [--wayland goodttv-lab] [--etiqueta base] [--detalle] [--extension otra/dist] [--precalentar 500]
//     [--navegador chrome|firefox] [--chat 30 | --chatreal]
// --canales auto:N toma los N directos con más espectadores. --wayland usa el compositor del laboratorio (GPU real y
// decodificación por hardware, herramientas/laboratorio/weston.sh); sin él, sin ventana y por software.
// Escribe una línea JSON por canal y ronda, y un resumen al final.
import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { launchChrome } from "./chrome.mjs"
import { launchFirefox } from "./firefox.mjs"

const { values: options } = parseArgs({
  options: {
    canales: { type: "string" },
    chat: { default: "0", type: "string" },
    chatreal: { default: false, type: "boolean" },
    detalle: { default: false, type: "boolean" },
    etiqueta: { default: "", type: "string" },
    extension: { type: "string" },
    modo: { default: "adaptativo", type: "string" },
    navegador: { default: "chrome", type: "string" },
    precalentar: { default: "0", type: "string" },
    rondas: { default: "1", type: "string" },
    segundos: { default: "45", type: "string" },
    wayland: { type: "string" },
  },
})
if (!options.canales) throw new Error("falta --canales canal1,canal2 o --canales auto:N")
// --extension: otra compilación (por ejemplo, la de otra rama) para compararlas.
const extension = resolve(options.extension ?? resolve(import.meta.dirname, "../../dist"))
const out = (event) => console.log(JSON.stringify({ etiqueta: options.etiqueta, ...event }))
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// Los directos con más espectadores, como invitado (la misma API que el reproductor web).
const topChannels = async (count) => {
  const response = await fetch("https://gql.twitch.tv/gql", {
    body: JSON.stringify({
      query: `query { streams(first: ${count * 2}) { edges { node { type broadcaster { login } } } } }`,
    }),
    headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Content-Type": "text/plain" },
    method: "POST",
  })
  const { data } = await response.json()
  return data.streams.edges
    .filter(({ node }) => node.type === "live")
    .map(({ node }) => node.broadcaster.login)
    .slice(0, count)
}

// CPU (en ticks de reloj) de un proceso y todos sus descendientes.
const cpuTicks = async (root) => {
  const parents = new Map()
  const ticks = new Map()
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue
    try {
      const stat = await readFile(`/proc/${name}/stat`, "utf8")
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
      parents.set(Number(name), Number(fields[1]))
      ticks.set(Number(name), Number(fields[11]) + Number(fields[12]))
    } catch {
      // El proceso terminó mientras se leía.
    }
  }
  let total = 0
  for (const [pid, value] of ticks) {
    for (let current = pid; current > 1; current = parents.get(current) ?? 0) {
      if (current === root) {
        total += value
        break
      }
    }
  }
  return total
}
const TICKS_PER_S = 100

// Abre el canal desde Inicio, como un clic, y espera el primer fotograma y que el vídeo avance. Tiempos en ms desde
// que cambia la dirección; los del reproductor (lista, fragmentos) salen de window.marcasPrueba.
// Con --precalentar MS, antes se precalienta el canal, como al parar el ratón encima MS ms antes de pulsar.
const OPEN = (login) => `(async () => {
  if (${Number(options.precalentar)} > 0) {
    void fetch("/stream/${login}/precalentar?modo=${options.modo}")
    await new Promise((r) => setTimeout(r, ${Number(options.precalentar)}))
  }
  const t0 = performance.now()
  // Desde cuándo son de esta apertura los eventos del empalme (con el precalentado): el registro es de toda la página.
  globalThis.desdePrueba = t0 - ${Number(options.precalentar)} - 100
  globalThis.marcasPrueba.length = 0
  location.hash = "#/canal/${login}"
  const marks = {}
  const at = () => Math.round(performance.now() - t0)
  let video = null
  // Todo dentro de 25 s: las órdenes CDP tienen un plazo de 30.
  const left = () => Math.max(0, 25000 - (performance.now() - t0))
  while (left() > 0) {
    video = document.querySelector(".stage__surface video")
    if (video !== null) break
    await new Promise((r) => setTimeout(r, 5))
  }
  if (video === null) return { error: "sin <video>" }
  marks.video = at()
  globalThis.esperasPrueba = 0
  video.addEventListener("waiting", () => globalThis.esperasPrueba++)
  // fotograma: el primero que se presenta (requestVideoFrameCallback; en Firefox, en el Weston del laboratorio, a
  // veces no llega). datos: el primero decodificado (readyState 2). avanza: la posición crece tras reproducir (el
  // reproductor empieza ya en el objetivo, no en 0).
  marks.fotograma = null
  marks.datos = null
  marks.reproduciendo = null
  marks.avanza = null
  video.requestVideoFrameCallback(() => (marks.fotograma ??= at()))
  video.addEventListener("playing", () => (marks.reproduciendo ??= at()), { once: true })
  let from = null
  while (left() > 0) {
    if (marks.datos === null && video.readyState >= 2) marks.datos = at()
    if (from === null && marks.reproduciendo !== null) from = video.currentTime
    if (from !== null && video.currentTime > from + 0.1) {
      marks.avanza = at()
      break
    }
    await new Promise((r) => setTimeout(r, 5))
  }
  for (const { ev, ms } of globalThis.marcasPrueba) marks[ev] ??= Math.round(ms - t0)
  const events = globalThis.registroEmpalme.filter(
    (e) => e.canal === "${login}" && e.s * 1000 >= globalThis.desdePrueba,
  )
  marks.info = events.findLast((e) => e.ev === "info")?.ms ?? null
  marks.desdeVod = events.some((e) => e.ev === "arranque-vod")
  return marks
})()`

const SAMPLE = `(() => {
  const video = document.querySelector(".stage__surface video")
  const hls = globalThis.hlsPrueba
  if (video === null || hls === undefined) return null
  const quality = video.getVideoPlaybackQuality()
  const end = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : video.currentTime
  return {
    latencia: hls.playingDate === null ? null : (Date.now() - hls.playingDate.getTime()) / 1000,
    objetivo: hls.targetLatency,
    bufer: end - video.currentTime,
    tiempo: video.currentTime,
    pausado: video.paused,
    velocidad: video.playbackRate,
    alto: video.videoHeight,
    perdidos: quality.droppedVideoFrames,
    total: quality.totalVideoFrames,
    esperas: globalThis.esperasPrueba,
  }
})()`

// Qué pasó en el empalme de un canal desde que se abrió (para explicar una parada): anuncios por sesión, rellenos con
// el VOD, huecos y emisiones nuevas, del registro sin datos sensibles de la página (?registro).
const EMPALME = (login) => `(() => {
  const events = globalThis.registroEmpalme.filter(
    (e) => e.canal === "${login}" && e.s * 1000 >= globalThis.desdePrueba,
  )
  const count = (ev) => events.filter((e) => e.ev === ev).length
  const anuncios = {}
  for (const e of events) if (e.ev === "anuncio") anuncios[e.type] = (anuncios[e.type] ?? 0) + 1
  return { anuncios, rellenos: count("relleno-inicio"), vodError: count("vod-error") > 0, huecos: count("hueco"),
    emisionNueva: count("nueva-emision"), erroresLista: count("error-lista") }
})()`

const median = (values) => {
  const sorted = values.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b)
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)]
}
const percentile = (values, p) => {
  const sorted = values.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b)
  return sorted.length === 0
    ? null
    : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}
const round = (value, digits = 2) => (value === null ? null : +value.toFixed(digits))

const metric = (metrics, name) => metrics.find((m) => m.name === name)?.value ?? 0

const watch = async (browser, seconds) => {
  const samples = []
  // Las métricas del hilo principal solo existen por CDP (Chrome).
  const metrics = () =>
    browser.cdp === undefined ? { metrics: [] } : browser.cdp("Performance.getMetrics")
  const before = await metrics()
  const cpuBefore = await cpuTicks(browser.pid)
  const started = Date.now()
  while (Date.now() - started < seconds * 1000) {
    await sleep(1000)
    const sample = await browser.evaluate(SAMPLE)
    if (sample !== null) samples.push({ s: (Date.now() - started) / 1000, ...sample })
    if (sample !== null && options.detalle) out({ muestra: true, ...samples.at(-1) })
  }
  const wall = (Date.now() - started) / 1000
  const after = await metrics()
  const cpuAfter = await cpuTicks(browser.pid)
  const first = samples[0]
  const last = samples.at(-1)
  // Paradas: muestras seguidas en las que el vídeo no avanza sin estar en pausa.
  let stalled = 0
  for (let i = 1; i < samples.length; i++) {
    const [a, b] = [samples[i - 1], samples[i]]
    if (!b.pausado && b.tiempo - a.tiempo < 0.5 * (b.s - a.s)) stalled += b.s - a.s
  }
  const frames = last.total - first.total
  return {
    latencia: round(median(samples.map((s) => s.latencia))),
    latenciaP90: round(
      percentile(
        samples.map((s) => s.latencia),
        0.9,
      ),
    ),
    objetivo: round(median(samples.map((s) => s.objetivo))),
    bufer: round(median(samples.map((s) => s.bufer))),
    buferMin: round(Math.min(...samples.map((s) => s.bufer))),
    paradaS: round(stalled, 1),
    esperas: last.esperas - first.esperas,
    alto: last.alto,
    fotogramas: frames,
    perdidos: last.perdidos - first.perdidos,
    perdidosPct: frames > 0 ? round((100 * (last.perdidos - first.perdidos)) / frames, 3) : null,
    // Hilo principal ocupado (tareas) y CPU de todo el navegador, en % de un núcleo.
    hiloPct:
      browser.cdp === undefined
        ? null
        : round(
            (100 *
              (metric(after.metrics, "TaskDuration") - metric(before.metrics, "TaskDuration"))) /
              wall,
            1,
          ),
    scriptPct:
      browser.cdp === undefined
        ? null
        : round(
            (100 *
              (metric(after.metrics, "ScriptDuration") -
                metric(before.metrics, "ScriptDuration"))) /
              wall,
            1,
          ),
    layoutPct:
      browser.cdp === undefined
        ? null
        : round(
            (100 *
              (metric(after.metrics, "LayoutDuration") -
                metric(before.metrics, "LayoutDuration"))) /
              wall,
            1,
          ),
    estiloPct:
      browser.cdp === undefined
        ? null
        : round(
            (100 *
              (metric(after.metrics, "RecalcStyleDuration") -
                metric(before.metrics, "RecalcStyleDuration"))) /
              wall,
            1,
          ),
    cpuPct: round((100 * (cpuAfter - cpuBefore)) / TICKS_PER_S / wall, 1),
    heapMB: round(metric(after.metrics, "JSHeapUsedSize") / 1048576, 0),
  }
}

const channels = options.canales.startsWith("auto:")
  ? await topChannels(Number(options.canales.slice(5)))
  : options.canales.split(",")
out({ canales: channels, modo: options.modo, wayland: options.wayland ?? null })

// Si los navegadores no están donde se esperan: HUMO_CHROME (Chrome for Testing) y HUMO_FIREFOX (también Zen).
const browser = await (options.navegador === "firefox" ? launchFirefox : launchChrome)({
  chrome: process.env.HUMO_CHROME,
  extension,
  firefox: process.env.HUMO_FIREFOX,
  wayland: options.wayland,
})
const results = []
try {
  await browser.cdp?.("Performance.enable")
  await browser.open("goodttv.html")
  await sleep(1000)
  const data = {
    preferences: { chatScale: "normal", chatVisible: true, latencyMode: options.modo },
    recents: [],
    version: 1,
  }
  await browser.evaluate(
    `chrome.storage.local.set({ "local-data": ${JSON.stringify(JSON.stringify(data))} }).then(() => 0)`,
  )
  // --chat N: un chat sintético de N mensajes por segundo (lab.ts), con una cuenta ficticia.
  // --chatreal: el chat real del canal, leído por IRC anónimo (lab.ts).
  const chat =
    Number(options.chat) > 0
      ? `&chatsintetico=${options.chat}`
      : options.chatreal
        ? "&chatreal"
        : ""
  await browser.open(`goodttv.html?registro${chat}#/`)
  await sleep(2000)
  for (let r = 0; r < Number(options.rondas); r++) {
    for (const login of channels) {
      const marks = await browser.evaluate(OPEN(login)).catch((error) => ({ error: String(error) }))
      if (marks.error !== undefined || marks.avanza === null) {
        out({ canal: login, ronda: r, ...marks, ok: false })
        await browser.evaluate(`location.hash = "#/"`)
        await sleep(1500)
        continue
      }
      const playback = await watch(browser, Number(options.segundos))
      const result = {
        canal: login,
        ronda: r,
        ...marks,
        ...playback,
        empalme: await browser.evaluate(EMPALME(login)),
        ok: true,
      }
      results.push(result)
      out(result)
      await browser.evaluate(`location.hash = "#/"`)
      await sleep(1500)
    }
  }
} finally {
  await browser.close()
}

const summary = (key) => ({
  mediana: round(median(results.map((r) => r[key])), 2),
  p90: round(
    percentile(
      results.map((r) => r[key]),
      0.9,
    ),
    2,
  ),
})
const vodStarts = results.filter((r) => r.desdeVod).length
const fromLive = results.filter((r) => !r.desdeVod)
out({
  resumen: true,
  muestras: results.length,
  arranquesDesdeVod: vodStarts,
  // El arranque desde el directo y desde el VOD (todas las sesiones con anuncio de entrada) se resumen aparte.
  // Primer fotograma presentado o, si el navegador no lo dice, decodificado.
  fotogramaMs: {
    mediana: median(fromLive.map((r) => r.fotograma ?? r.datos)),
    p90: percentile(
      fromLive.map((r) => r.fotograma ?? r.datos),
      0.9,
    ),
  },
  avanzaMs: { mediana: median(fromLive.map((r) => r.avanza)) },
  infoMs: { mediana: median(fromLive.map((r) => r.info)) },
  latencia: summary("latencia"),
  latenciaP90: summary("latenciaP90"),
  bufer: summary("bufer"),
  buferMin: summary("buferMin"),
  paradaS: {
    total: round(
      results.reduce((sum, r) => sum + r.paradaS, 0),
      1,
    ),
  },
  esperas: { total: results.reduce((sum, r) => sum + r.esperas, 0) },
  perdidosPct: {
    global: round(
      (100 * results.reduce((sum, r) => sum + r.perdidos, 0)) /
        Math.max(
          1,
          results.reduce((sum, r) => sum + r.fotogramas, 0),
        ),
      3,
    ),
  },
  hiloPct: summary("hiloPct"),
  cpuPct: summary("cpuPct"),
})
