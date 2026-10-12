// Prueba de la interfaz de escritorio de la extensión, en Chrome for Testing y en Firefox (sin ventana ni sonido) y sin
// cuenta: buscar con / y abrir con Enter, que reproduzca, pausar con Espacio y con un clic en el vídeo, modo teatro (T,
// Esc), chat (C), silencio (M), volver a Inicio con el canal en «Seguir viendo», pedir y cancelar el código de la
// cuenta, un modo de retraso que se conserva al recargar y una sola GoodTTV abierta.
// En Chrome, teclas, texto y clics son de verdad (CDP); en Firefox se simulan en la página (BiDi no los admite en las
// páginas de una extensión).
// Uso, desde la raíz y con la extensión compilada (bun run build:navegador):
//   node apps/navegador/test/humo/interfaz.mjs --canales a,b [--navegador chrome|firefox|ambos]
// Escribe un paso por línea y un veredicto por navegador; sale con 1 si alguno falla.
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { launchChrome } from "./chrome.mjs"
import { launchFirefox } from "./firefox.mjs"

const { values: options } = parseArgs({
  options: {
    canales: { type: "string" },
    navegador: { default: "ambos", type: "string" },
  },
})
if (!options.canales) throw new Error("falta --canales canal1,canal2")
const extension = resolve(import.meta.dirname, "../../dist")
const out = (event) => console.log(JSON.stringify({ t: +(Date.now() / 1000).toFixed(1), ...event }))
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const VIDEO = `(() => {
  const video = document.querySelector(".stage__surface video")
  return video === null ? null : { alto: video.videoHeight, pausado: video.paused, silencio: video.muted, tiempo: video.currentTime }
})()`

const run = async (name, launch) => {
  const { HUMO_CHROME: chrome, HUMO_FIREFOX: firefox } = process.env
  let browser
  const steps = []
  const step = (label, ok, details = {}) => {
    steps.push({ label, ok })
    out({ navegador: name, ok, paso: label, ...details })
    if (!ok) throw new Error(`falla: ${label}`)
  }
  const waitFor = async (expression, ms = 10_000) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (await browser.evaluate(expression).catch(() => false)) return true
      await sleep(250)
    }
    return false
  }
  const press = async (...keys) => {
    for (const key of keys) {
      await browser.press(key)
      await sleep(250)
    }
  }
  const advances = async () => {
    const before = await browser.evaluate(VIDEO)
    await sleep(3000)
    const after = await browser.evaluate(VIDEO)
    return after !== null && before !== null && after.tiempo - before.tiempo > 2 && !after.pausado
  }
  try {
    browser = await launch({ chrome, extension, firefox })
    await browser.open("goodttv.html")
    step(
      "arranca en Inicio",
      await waitFor(`document.body.innerText.includes("Twitch sin anuncios")`),
    )

    await press("/")
    step(
      "/ lleva a la búsqueda",
      await waitFor(`document.activeElement?.getAttribute("role") === "combobox"`),
    )

    let channel
    for (const candidate of options.canales.split(",")) {
      await browser.type(candidate)
      await waitFor(`document.querySelector(".search__option--active") !== null`)
      await press("Enter")
      const playing = await waitFor(`(${VIDEO})?.tiempo > 3`, 40_000)
      out({ canal: candidate, navegador: name, reproduce: playing })
      if (playing) {
        channel = candidate
        break
      }
      await press("Escape", "/")
    }
    step("Enter abre el canal y reproduce", channel !== undefined, { canal: channel })
    step("la dirección es la del canal", await waitFor(`location.hash === "#/canal/${channel}"`))
    step("el vídeo avanza", await advances())

    await press(" ")
    step("Espacio pausa", await waitFor(`(${VIDEO})?.pausado === true`))
    await press(" ")
    step("Espacio reanuda y avanza", await advances())

    await browser.click(".stage__surface")
    step("un clic en el vídeo pausa", await waitFor(`(${VIDEO})?.pausado === true`))
    await browser.click(".stage__surface")
    step("otro clic reanuda", await waitFor(`(${VIDEO})?.pausado === false`))

    await press("t")
    step(
      "T: modo teatro, sin barra ni columna",
      await waitFor(
        `document.querySelector(".desktop--theater") !== null && getComputedStyle(document.querySelector(".topbar")).display === "none"`,
      ),
    )
    await press("Escape")
    step(
      "Esc sale del modo teatro",
      await waitFor(`document.querySelector(".desktop--theater") === null`),
    )
    step("y sigue en el canal", (await browser.evaluate(`location.hash`)) === `#/canal/${channel}`)

    await press("c")
    step("C oculta el chat", await waitFor(`document.querySelector(".chat") === null`))
    await press("c")
    step("C lo vuelve a mostrar", await waitFor(`document.querySelector(".chat") !== null`))

    await press("m")
    step("M silencia", await waitFor(`(${VIDEO})?.silencio === true`))
    await press("m")
    step("M quita el silencio", await waitFor(`(${VIDEO})?.silencio === false`))

    await press("Escape")
    step("Esc vuelve a Inicio", await waitFor(`location.hash === "#/" || location.hash === ""`))
    step(
      "con el canal en «Seguir viendo»",
      await waitFor(
        `[...document.querySelectorAll(".recent")].some((e) => e.textContent.includes(${JSON.stringify(channel)}))`,
      ),
    )

    await browser.click('a[href="#/ajustes"]')
    step(
      "el engranaje abre Ajustes",
      await waitFor(`document.body.innerText.includes("Retraso del directo")`),
    )
    await browser.click(".settings-group .button--primary")
    step(
      "Vincular cuenta pide un código a Twitch y lo muestra",
      await waitFor(
        `/^[A-Z0-9]{6,10}$/.test(document.querySelector(".link-code__code [aria-hidden]")?.textContent ?? "")`,
        20_000,
      ),
    )
    await browser.click(".link-code__actions .button:not(.button--primary)")
    step(
      "Cancelar vuelve a «Vincular cuenta»",
      await waitFor(`document.querySelector(".link-code") === null`),
    )

    await browser.click('input[name="latencia"][value="sin-paradas"]')
    await sleep(500)
    await browser.evaluate(`(location.reload(), 0)`).catch(() => undefined)
    await sleep(1500)
    step(
      "el modo de retraso se conserva al recargar",
      await waitFor(
        `document.querySelector('input[name="latencia"][value="sin-paradas"]')?.checked === true`,
      ),
    )

    // Una sola GoodTTV a la vez: la segunda pestaña avisa y puede quedársela; la primera pasa a esperar.
    const other = await browser.openTab("goodttv.html")
    const BUSY = `document.body.innerText.includes("ya está abierto en otra pestaña")`
    const waitIn = async (page, expression) => {
      for (let i = 0; i < 40; i++) {
        if (await page.evaluate(expression).catch(() => false)) return true
        await sleep(250)
      }
      return false
    }
    step("otra pestaña avisa de que ya está abierto", await waitIn(other, BUSY))
    await other.evaluate(`(document.querySelector(".busy button").click(), 0)`)
    step(
      "«Usarlo aquí» se la queda",
      await waitIn(other, `document.querySelector(".topbar") !== null`),
    )
    step("y la primera pasa a esperar", await waitFor(BUSY))
    await other.close()
    return { navegador: name, ok: true, pasos: steps.length }
  } catch (error) {
    return { motivo: String(error), navegador: name, ok: false, pasos: steps.length }
  } finally {
    await browser?.close()
  }
}

const browsers = { chrome: launchChrome, firefox: launchFirefox }
const names = options.navegador === "ambos" ? Object.keys(browsers) : [options.navegador]
const results = await Promise.all(names.map((name) => run(name, browsers[name])))
for (const result of results) out({ veredicto: true, ...result })
process.exit(results.every((result) => result.ok) ? 0 : 1)
