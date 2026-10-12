// Modos de retraso y relleno con el VOD en la interfaz de escritorio, con los criterios de la tele
// (herramientas/laboratorio/README.md): pausas globales simuladas (?pausa=, como GOODTTV_PAUSA_SIMULADA) y muestras
// del <video> cada 2 s. Escenarios:
//   adaptativo   Adaptativo, una pausa de 45 s cada 150 s, 400 s: una parada en la primera pausa y ninguna después.
//   arranque     Adaptativo, una sola pausa al abrir (0,20,1), 90 s: empieza en el VOD y vuelve sin salto ni paradas.
//   sin-paradas  Sin paradas, una pausa de 45 s cada 150 s, 400 s: ninguna parada.
// Uso, desde la raíz y con la extensión compilada:
//   node apps/navegador/test/humo/modos.mjs --canales a,b --escenario adaptativo [--navegador chrome|firefox|ambos]
// Escribe una línea JSON por muestra y un veredicto por navegador; sale con 1 si alguno falla. Muestras y eventos
// cuentan los segundos desde que se abrió la página. Las paradas se estiman con muestras cada 2 s: una de menos de 2 s
// puede pasar inadvertida.
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { launchChrome } from "./chrome.mjs"
import { launchFirefox } from "./firefox.mjs"

const SCENARIOS = {
  adaptativo: { mode: "adaptativo", pause: "150,45", seconds: 400 },
  arranque: { mode: "adaptativo", pause: "0,20,1", seconds: 90 },
  "sin-paradas": { mode: "sin-paradas", pause: "150,45", seconds: 400 },
}

const { values: options } = parseArgs({
  options: {
    canales: { type: "string" },
    escenario: { default: "adaptativo", type: "string" },
    navegador: { default: "ambos", type: "string" },
  },
})
const scenario = SCENARIOS[options.escenario]
if (!options.canales || scenario === undefined) {
  throw new Error(`falta --canales, o --escenario no es ${Object.keys(SCENARIOS).join(", ")}`)
}
const extension = resolve(import.meta.dirname, "../../dist")
const out = (event) => console.log(JSON.stringify({ t: +(Date.now() / 1000).toFixed(1), ...event }))
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const SAMPLE = `(() => {
  const video = document.querySelector(".stage__surface video")
  if (video === null) return null
  const ahead = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) - video.currentTime : 0
  const quality = video.getVideoPlaybackQuality?.()
  return { buf: +ahead.toFixed(1), perdidos: quality?.droppedVideoFrames ?? null, pausado: video.paused,
    s: Math.round(performance.now() / 100) / 10, tiempo: +video.currentTime.toFixed(2),
    total: quality?.totalVideoFrames ?? null }
})()`

// Paradas: muestras seguidas en las que el vídeo no avanza sin estar en pausa (la pausa es otro fallo).
const stopsOf = (samples) => {
  const stops = []
  let current
  for (let i = 1; i < samples.length; i++) {
    const [previous, sample] = [samples[i - 1], samples[i]]
    if (!sample.pausado && sample.tiempo - previous.tiempo < 0.5) {
      if (current === undefined) current = [previous.s, sample.s]
      else current[1] = sample.s
    } else if (current !== undefined) {
      stops.push(current)
      current = undefined
    }
  }
  if (current !== undefined) stops.push(current)
  return stops
}

const run = async (name, launch) => {
  const { HUMO_CHROME: chrome, HUMO_FIREFOX: firefox } = process.env
  let browser
  try {
    browser = await launch({ chrome, extension, firefox })
    await browser.open("goodttv.html")
    await sleep(1500)
    const data = {
      preferences: { chatScale: "normal", chatVisible: false, latencyMode: scenario.mode },
      recents: [],
      version: 1,
    }
    await browser.evaluate(
      `chrome.storage.local.set({ "local-data": ${JSON.stringify(JSON.stringify(data))} }).then(() => 0)`,
    )
    // Reproduce si el vídeo avanza: currentTime ya es mayor que 0 antes de empezar, en la posición del directo.
    const plays = async () => {
      let first
      for (let i = 0; i < 80; i++) {
        const time = (await browser.evaluate(SAMPLE).catch(() => null))?.tiempo
        if (time !== undefined) {
          first ??= time
          if (time - first > 1) return true
        }
        await sleep(500)
      }
      return false
    }
    let channel
    for (const candidate of options.canales.split(",")) {
      await browser.open(`goodttv.html?pausa=${scenario.pause}&registro#/canal/${candidate}`)
      if (await plays()) {
        channel = candidate
        break
      }
      out({ canal: candidate, navegador: name, reproduce: false })
    }
    if (channel === undefined)
      return { motivo: "ningún canal reproduce", navegador: name, ok: false }

    const started = Date.now()
    const samples = []
    let missing = 0
    while (Date.now() - started < scenario.seconds * 1000) {
      await sleep(2000)
      const sample = await browser.evaluate(SAMPLE)
      if (sample === null) missing++
      else samples.push(sample)
      out({ navegador: name, ...(sample ?? { video: false }) })
    }
    const events = await browser.evaluate(`globalThis.registroEmpalme ?? []`)
    // vod-error: el canal no deja leer su VOD (por ejemplo, solo para suscriptores) y no hay con qué rellenar.
    const notable = events.filter((event) =>
      [
        "arranque-vod",
        "error-servidor",
        "pausa-simulada",
        "relleno-fin",
        "relleno-inicio",
        "vod-error",
      ].includes(event.ev),
    )
    const stops = stopsOf(samples)
    const last = samples.at(-1)
    // Solo cuenta el relleno que llegó a publicar trozos del VOD: relleno-fin también llega sin ninguno.
    const fills = notable.filter((event) => event.ev === "relleno-fin" && event.fragmentosVod > 0)
    const jumps = fills.map((event) => event.saltoS)
    const pauses = notable.filter((event) => event.ev === "pausa-simulada")
    // Cada pausa que acabó durante la prueba, rellenada con el VOD antes de la siguiente.
    const unfilled = pauses.filter((pause, i) => {
      const next = pauses[i + 1]?.s ?? Number.POSITIVE_INFINITY
      if (pause.s + pause.segundos + 10 > (last?.s ?? 0)) return false
      return !fills.some((fill) => fill.s > pause.s && fill.s < next)
    })
    const [firstPause, secondPause] = pauses
    const firstStop = stops[0]?.[0]
    const checks =
      options.escenario === "adaptativo"
        ? [
            ["como mucho una parada", stops.length <= 1],
            [
              "en la primera pausa",
              firstStop === undefined ||
                (firstPause !== undefined &&
                  firstStop >= firstPause.s &&
                  firstStop < (secondPause?.s ?? Number.POSITIVE_INFINITY)),
            ],
          ]
        : options.escenario === "arranque"
          ? [
              ["empieza en el VOD", notable.some((event) => event.ev === "arranque-vod")],
              ["vuelve sin salto", fills.length >= 1 && jumps.every((jump) => jump === 0)],
              ["sin paradas", stops.length === 0],
            ]
          : [["sin paradas", stops.length === 0]]
    checks.push(
      ["cada pausa, rellenada con el VOD", pauses.length >= 1 && unfilled.length === 0],
      ["nunca en pausa", samples.every((sample) => !sample.pausado)],
      ["el vídeo no desaparece", missing === 0],
      [
        "muestras sin huecos",
        samples.every((sample, i) => i === 0 || sample.s - samples[i - 1].s <= 5),
      ],
      ["sin errores del servidor", !notable.some((event) => event.ev === "error-servidor")],
    )
    const failed = checks.filter(([, ok]) => !ok).map(([check]) => check)
    return {
      canal: channel,
      escenario: options.escenario,
      eventos: notable.map(({ ev, fragmentosVod, s, saltoS }) =>
        ev === "relleno-fin"
          ? `${s} ${ev}: salto ${saltoS} s, ${fragmentosVod} del VOD`
          : `${s} ${ev}`,
      ),
      fallos: failed,
      navegador: name,
      ok: failed.length === 0,
      paradas: stops,
      perdidos: last?.total ? `${last.perdidos} de ${last.total}` : null,
    }
  } catch (error) {
    return { motivo: String(error), navegador: name, ok: false }
  } finally {
    await browser?.close()
  }
}

const browsers = { chrome: launchChrome, firefox: launchFirefox }
const names = options.navegador === "ambos" ? Object.keys(browsers) : [options.navegador]
const results = await Promise.all(names.map((name) => run(name, browsers[name])))
for (const result of results) out({ veredicto: true, ...result })
process.exit(results.every((result) => result.ok) ? 0 : 1)
