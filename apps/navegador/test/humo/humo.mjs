// Prueba de humo del reproductor de la extensión en Chrome for Testing y en Firefox, sin ventana y sin sonido: abre un
// canal en directo en la página de la extensión (goodttv.html#/canal/<login>, con ?registro) y comprueba que el vídeo
// avanza sin errores fatales de hls.js ni avisos encima («Twitch no responde», stuck.ts). Con --oculta S, a los 20 s deja
// la pestaña oculta S segundos (con el vídeo sonando, silenciado o en pausa) y comprueba la vuelta.
// Uso, desde la raíz y con la extensión compilada (bun run build:navegador):
//   node apps/navegador/test/humo/humo.mjs [--canales a,b] [--navegador chrome|firefox|ambos] [--segundos 60]
//     [--modo adaptativo] [--pausa 150,45] [--oculta 360] [--como sonando|silenciado|pausado]
// Sin --canales, prueba con los directos con más espectadores de ahora.
// Escribe una línea JSON por muestra y un veredicto por navegador; sale con 1 si alguno falla.
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { topChannels } from "./canales.mjs"
import { launchChrome } from "./chrome.mjs"
import { launchFirefox } from "./firefox.mjs"

const { values: options } = parseArgs({
  options: {
    canales: { type: "string" },
    como: { default: "sonando", type: "string" },
    modo: { default: "adaptativo", type: "string" },
    navegador: { default: "ambos", type: "string" },
    oculta: { default: "0", type: "string" },
    pausa: { default: "", type: "string" },
    segundos: { default: "60", type: "string" },
  },
})
const candidates = options.canales ? options.canales.split(",") : await topChannels(6)
const extension = resolve(import.meta.dirname, "../../dist")
const hidden = Number(options.oculta)
const seconds = Math.max(Number(options.segundos), hidden > 0 ? hidden + 60 : 0) // 20 s antes y 40 s después
// Con una pausa simulada que caiga dentro de la prueba, el relleno con el VOD tiene que verse (salvo en modo directo).
const [pauseEvery = 0, , pauseAtStart = 0] = options.pausa.split(",").map(Number)
const expectsVod =
  options.pausa !== "" &&
  options.modo !== "directo" &&
  (pauseAtStart === 1 || (pauseEvery > 0 && pauseEvery < seconds))
const out = (event) => console.log(JSON.stringify({ t: +(Date.now() / 1000).toFixed(1), ...event }))
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// Cada muestra engancha, una vez por reproductor, lo que cuenta la prueba: los errores de hls.js (tipo y detalle, sin
// la URL, que lleva el token), los fragmentos cargados del directo y del VOD con el host de los del directo (para los
// permisos del manifest) y las esperas del <video>. hlsPrueba y el <video> pueden cambiar durante la prueba, así que se
// engancha cada vez que se ve uno nuevo, y lo contado sigue en humoPrueba. El resto se lee del <video> en el momento,
// porque los temporizadores de la página se frenan con la pestaña oculta, y del registro del empalme (?registro), que
// no lleva datos sensibles (src/lab.ts).
const SAMPLE = (login) => `(() => {
  const humo = (globalThis.humoPrueba ??= { avisos: [], errores: [], esperas: 0, fatales: 0, fragmentos: { directo: 0, vod: 0 }, hosts: [] })
  const hls = globalThis.hlsPrueba
  if (hls !== undefined && !hls.humoPrueba) {
    hls.humoPrueba = true
    hls.on("hlsError", (_event, data) => {
      humo.errores.push(data.type + "/" + data.details + (data.fatal ? " (fatal)" : ""))
      if (humo.errores.length > 20) humo.errores.shift()
      if (data.fatal) humo.fatales++
    })
    hls.on("hlsFragLoaded", (_event, data) => {
      const url = new URL(data.frag.url)
      if (url.pathname.startsWith("/stream/vod")) humo.fragmentos.vod++
      else {
        humo.fragmentos.directo++
        const host = url.host.replace(/^[^.]+/, "*")
        if (!humo.hosts.includes(host)) humo.hosts.push(host)
      }
    })
  }
  const video = document.querySelector(".stage__surface video")
  if (video !== null && video.dataset.humo !== "1") {
    video.dataset.humo = "1"
    video.addEventListener("waiting", () => humo.esperas++)
  }
  // Un aviso sobre el vídeo («Twitch no responde», el error) con el directo en marcha sería falso.
  const aviso = document.querySelector(".stage__notice p")?.textContent
  if (aviso && !humo.avisos.includes(aviso)) humo.avisos.push(aviso)
  const registro = (globalThis.registroEmpalme ?? []).filter((e) => e.canal === undefined || e.canal === "${login}")
  const eventos = {}
  for (const e of registro) eventos[e.ev] = (eventos[e.ev] ?? 0) + 1
  return {
    video: video !== null,
    tiempo: video?.currentTime ?? 0,
    alto: video?.videoHeight ?? 0,
    pausado: video?.paused ?? true,
    retrasoS: hls?.playingDate ? (Date.now() - hls.playingDate.getTime()) / 1000 : null,
    visible: document.visibilityState,
    esperas: humo.esperas,
    avisos: humo.avisos,
    errores: humo.errores.length,
    listaErrores: [...new Set(humo.errores)],
    fatales: humo.fatales,
    fragmentos: humo.fragmentos,
    hosts: humo.hosts,
    eventos,
    registro: registro.slice(-40).map((e) => JSON.stringify(e)),
  }
})()`

// Lo que se escribe en cada muestra: sin las listas, que van en el veredicto.
const brief = ({ eventos: _e, hosts: _h, listaErrores: _l, registro: _r, ...now }) => now

const run = async (name, launch) => {
  // Si los navegadores no están donde se esperan: HUMO_CHROME (Chrome for Testing) y HUMO_FIREFOX.
  const { HUMO_CHROME: chrome, HUMO_FIREFOX: firefox } = process.env
  let browser
  let channel
  const sample = () => browser.evaluate(SAMPLE(channel))
  try {
    browser = await launch({ chrome, extension, firefox })
    // --modo, como en Ajustes: se guarda antes de abrir el canal, sin chat (es una prueba del reproductor).
    await browser.open("goodttv.html")
    await sleep(1500)
    const data = {
      preferences: { chatScale: "normal", chatVisible: false, latencyMode: options.modo },
      recents: [],
      version: 1,
    }
    await browser.evaluate(
      `chrome.storage.local.set({ "local-data": ${JSON.stringify(JSON.stringify(data))} }).then(() => 0)`,
    )
    const query = options.pausa === "" ? "registro" : `registro&pausa=${options.pausa}`
    // Reproduce si el vídeo avanza en 40 s: currentTime ya es mayor que 0 antes de empezar, en la posición del directo.
    const plays = async () => {
      let first
      for (let i = 0; i < 80; i++) {
        const now = await sample().catch(() => null)
        if (now?.video && !now.pausado) {
          first ??= now.tiempo
          if (now.tiempo - first > 1) return true
        }
        await sleep(500)
      }
      return false
    }
    for (const candidate of candidates) {
      channel = candidate
      await browser.open(`goodttv.html?${query}#/canal/${candidate}`)
      const playing = await plays()
      out({ canal: candidate, navegador: name, reproduce: playing })
      if (playing) break
      channel = undefined
    }
    if (channel === undefined)
      return { navegador: name, ok: false, motivo: "ningún canal reproduce" }

    const start = await sample()
    const started = Date.now()
    const checks = []
    let hiddenReport
    while (Date.now() - started < seconds * 1000) {
      await sleep(5000)
      const elapsed = (Date.now() - started) / 1000
      if (hidden > 0 && hiddenReport === undefined && elapsed >= 20) {
        hiddenReport = await hide(browser, sample, name)
      }
      out({ navegador: name, s: Math.round(elapsed), ...brief(await sample()) })
    }
    const end = await sample()
    const watched = (Date.now() - started) / 1000 - (hiddenReport?.segundos ?? 0)
    const advanced = end.tiempo - start.tiempo - (hiddenReport?.avanceOculta ?? 0)
    checks.push(
      ["reproduce", end.video && !end.pausado],
      ["avanza", advanced >= 0.75 * watched],
      ["sin errores fatales", end.fatales === 0],
      ["sin avisos", end.avisos.length === 0],
    )
    if (expectsVod) checks.push(["rellena con el VOD", end.fragmentos.vod > 0])
    if (hiddenReport !== undefined) {
      const playing = options.como !== "pausado"
      checks.push(
        ["se ocultó", hiddenReport.visibleDurante === "hidden"],
        ["sigue oculta", !playing || hiddenReport.avanceOculta >= 0.75 * hiddenReport.segundos],
        ["vuelve", hiddenReport.vuelve],
      )
    }
    const failed = checks.filter(([, ok]) => !ok).map(([check]) => check)
    return {
      alto: end.alto,
      avisos: end.avisos,
      avance: +(advanced / watched).toFixed(2),
      canal: channel,
      errores: end.listaErrores,
      esperas: end.esperas,
      eventos: end.eventos,
      fallos: failed,
      fragmentos: end.fragmentos,
      hosts: end.hosts,
      navegador: name,
      ok: failed.length === 0,
      oculta: hiddenReport,
      registro: end.registro,
      retrasoS: end.retrasoS,
    }
  } finally {
    await browser?.close()
  }
}

// Oculta la pestaña, con el vídeo como pida --como, y comprueba que al volver sigue en directo.
const VIDEO = `document.querySelector(".stage__surface video")`
const hide = async (browser, sample, name) => {
  if (options.como === "silenciado") await browser.evaluate(`(${VIDEO}.muted = true, 0)`)
  if (options.como === "pausado") await browser.evaluate(`(${VIDEO}.pause(), 0)`)
  const before = await sample()
  // Otra pestaña en la misma ventana, abierta por la propia extensión (igual en los dos navegadores).
  const other = await browser.evaluate(
    `chrome.tabs.create({ url: "about:blank" }).then((tab) => tab.id)`,
  )
  const show = () =>
    browser.evaluate(`(async () => {
      const own = await chrome.tabs.getCurrent()
      await chrome.tabs.update(own.id, { active: true })
      await chrome.tabs.remove(${other})
    })()`)
  const hiddenAt = Date.now()
  while (Date.now() - hiddenAt < hidden * 1000) {
    await sleep(30_000)
    out({
      navegador: name,
      ...brief(await sample()),
      oculta: Math.round((Date.now() - hiddenAt) / 1000),
    })
  }
  const during = await sample()
  await show()
  const shownAt = Date.now()
  if (options.como === "pausado") await browser.evaluate(`${VIDEO}.play().then(() => 0)`)
  const back = await sample()
  await sleep(20_000)
  const after = await sample()
  return {
    avanceOculta: +(during.tiempo - before.tiempo).toFixed(1),
    como: options.como,
    esperasOculta: during.esperas - before.esperas,
    segundos: Math.round((shownAt - hiddenAt) / 1000),
    tras20s: {
      avance: +(after.tiempo - back.tiempo).toFixed(1),
      pausado: after.pausado,
      retrasoS: after.retrasoS,
    },
    visibleDurante: during.visible,
    vuelve: after.tiempo - back.tiempo >= 15 && !after.pausado,
  }
}

const browsers = {
  chrome: launchChrome,
  firefox: launchFirefox,
}
const names = options.navegador === "ambos" ? Object.keys(browsers) : [options.navegador]
const results = await Promise.all(
  names.map((name) =>
    run(name, browsers[name]).catch((error) => ({
      motivo: String(error),
      navegador: name,
      ok: false,
    })),
  ),
)
for (const result of results) out({ veredicto: true, ...result })
process.exit(results.every((result) => result.ok) ? 0 : 1)
