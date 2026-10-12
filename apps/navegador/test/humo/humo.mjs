// Prueba de humo de la extensión en Chrome for Testing y en Firefox, sin ventana y sin sonido: abre la página de
// prueba del reproductor con un canal en directo y comprueba que el vídeo avanza sin errores fatales. Con --oculta S,
// a los 20 s deja la pestaña oculta S segundos (con el vídeo sonando, silenciado o en pausa) y comprueba la vuelta.
// Uso, desde la raíz y con la extensión compilada (bun run --cwd apps/navegador build):
//   node apps/navegador/test/humo/humo.mjs --canales a,b [--navegador chrome|firefox|ambos] [--segundos 60]
//     [--modo adaptativo] [--pausa 150,45] [--oculta 360] [--como sonando|silenciado|pausado]
// Escribe una línea JSON por muestra y un veredicto por navegador; sale con 1 si alguno falla.
import { resolve } from "node:path"
import { parseArgs } from "node:util"
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
if (!options.canales) throw new Error("falta --canales canal1,canal2")
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

// Se lee del <video> en el momento: los temporizadores de la página se frenan con la pestaña oculta.
const SAMPLE = `(() => {
  const video = document.querySelector("video")
  const { hosts, eventos, registro, ...estado } = globalThis.estadoPrueba
  return JSON.stringify({ ...estado, errores: estado.errores.length, listaErrores: [...new Set(estado.errores)],

    tiempo: video.currentTime, alto: video.videoHeight, pausado: video.paused, visible: document.visibilityState,
    hosts, eventos, registro })
})()`

const run = async (name, launch) => {
  // Si los navegadores no están donde se esperan: HUMO_CHROME (Chrome for Testing) y HUMO_FIREFOX.
  const { HUMO_CHROME: chrome, HUMO_FIREFOX: firefox } = process.env
  let browser
  const sample = async () => JSON.parse(await browser.evaluate(SAMPLE))
  try {
    browser = await launch({ chrome, extension, firefox })
    let channel
    for (const candidate of options.canales.split(",")) {
      const query = new URLSearchParams({ modo: options.modo })
      if (options.pausa !== "") query.set("pausa", options.pausa)
      await browser.open(`reproductor.html?${query}#${candidate}`)
      for (let i = 0; i < 50; i++) {
        const { fase } = await sample()
        if (fase !== "cargando") break
        await sleep(500)
      }
      const { fase } = await sample()
      out({ canal: candidate, fase, navegador: name })
      if (fase === "reproduciendo") {
        channel = candidate
        break
      }
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
      const { hosts: _h, eventos: _e, listaErrores: _l, registro: _r, ...now } = await sample()
      out({ navegador: name, s: Math.round(elapsed), ...now })
    }
    const end = await sample()
    const watched = (Date.now() - started) / 1000 - (hiddenReport?.segundos ?? 0)
    const advanced = end.tiempo - start.tiempo - (hiddenReport?.avanceOculta ?? 0)
    checks.push(
      ["reproduce", end.fase === "reproduciendo" && !end.pausado],
      ["avanza", advanced >= 0.75 * watched],
      ["sin errores fatales", end.fatales === 0],
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
const hide = async (browser, sample, name) => {
  if (options.como === "silenciado")
    await browser.evaluate(`document.querySelector("video").muted = true`)
  if (options.como === "pausado") await browser.evaluate(`document.querySelector("video").pause()`)
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
    const { hosts: _h, eventos: _e, listaErrores: _l, registro: _r, ...now } = await sample()
    out({ navegador: name, ...now, oculta: Math.round((Date.now() - hiddenAt) / 1000) })
  }
  const during = await sample()
  await show()
  const shownAt = Date.now()
  if (options.como === "pausado") await browser.evaluate(`document.querySelector("video").play()`)
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
      fase: after.fase,
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
