// Prueba de la interfaz de escritorio de la extensión, en Chrome for Testing y en Firefox (sin ventana ni sonido) y sin
// cuenta: buscar con / y abrir con Enter, que reproduzca, pausar con Espacio y con un clic en el vídeo, modo teatro (T,
// Esc; en Chrome, F a pantalla completa, con su propio chat), chat (C), silencio (M), volver a Inicio con el canal en «Seguir viendo», pedir y cancelar el código de la
// cuenta, un modo de retraso que se conserva al recargar, Inicio sin poder comprobar la cuenta y cerrar sesión así
// (?sinred, EXT-4), un VOD de las emisiones del canal (VOD-1) con el volumen elegido en el directo, que sigue al
// volver a él, y dos pestañas a la vez, con sonido solo en la última (EXT-5) y la nueva con ese volumen.
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

// Inicio de la última vez con una cuenta ficticia (page-home.ts, de @goodttv/servicios), para abrir sin poder comprobarla.
const stream = (login) => ({
  category: "Just Chatting",
  id: `s-${login}`,
  startedAt: new Date().toISOString(),
  tags: [],
  thumbnailUrl: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-{width}x{height}.jpg`,
  title: `Directo de ${login}`,
  userId: "123",
  userLogin: login,
  userName: login,
  viewerCount: 1000,
})
const SAVED_HOME = {
  account: { displayName: "Prueba", kind: "authenticated", login: "prueba" },
  following: [stream("guardado1")],
  popular: [],
  recentLive: [],
  recents: [],
  savedAt: Date.now() - 3_600_000,
  version: 1,
}

const VIDEO = `(() => {
  const video = document.querySelector(".stage__surface video")
  return video === null ? null : { alto: video.videoHeight, pausado: video.paused, silencio: video.muted, tiempo: video.currentTime, volumen: video.volume }
})()`
// Mueve la barra del volumen como al arrastrarla: React solo ve el cambio si el valor se pone con el setter nativo.
const setVolume = (value) => `(() => {
  const input = document.querySelector("input.volume")
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "${value}")
  input.dispatchEvent(new Event("input", { bubbles: true }))
  return 0
})()`
const atVolume = (value) => `Math.abs((${VIDEO})?.volumen - ${value}) < 0.01`

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
    // A pantalla completa, el chat va aparte del de la ventana (D33): la primera vez, solo el vídeo; C lo pone al lado,
    // y se recuerda. El modo teatro es de la ventana: su botón no sale. Solo en Chrome: en Firefox las teclas se simulan
    // en la página, y el navegador no deja pedir la pantalla completa sin una de verdad.
    if (name === "chrome") {
      const completa = `document.fullscreenElement?.classList.contains("watch") && document.querySelector(".stage").getBoundingClientRect().height === innerHeight`
      const chatAlLado = `document.querySelector(".watch > .chat")?.getBoundingClientRect().height === innerHeight`
      await press("f")
      step(
        "F, a pantalla completa solo el vídeo, sin el botón del modo teatro",
        await waitFor(
          `${completa} && document.querySelector(".watch > .chat") === null && document.querySelector('[aria-label="Modo teatro"]') === null`,
        ),
      )
      await press("c")
      step("C pone el chat al lado", await waitFor(`${completa} && ${chatAlLado}`))
      await browser.evaluate("document.exitFullscreen().then(() => 0)")
      step(
        "al salir, sigue en modo teatro, con el chat de la ventana",
        await waitFor(
          `document.fullscreenElement === null && document.querySelector(".desktop--theater") !== null && document.querySelector(".watch > .chat") !== null`,
        ),
      )
      await press("f")
      step("y la próxima vez, con el chat al lado", await waitFor(`${completa} && ${chatAlLado}`))
      await browser.evaluate("document.exitFullscreen().then(() => 0)")
      await waitFor(`document.fullscreenElement === null`)
    }
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
        // Con su nombre de verdad (xQc), que la búsqueda ya trae: sin distinguir mayúsculas.
        `[...document.querySelectorAll(".recent")].some((e) => e.textContent.toLowerCase().includes(${JSON.stringify(channel)}))`,
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

    // Sin red al comprobar la cuenta (?sinred, lab.ts): lo de la última vez con el aviso y «Reintentar», nunca la
    // bienvenida. Con red, «Reintentar» pregunta de verdad: sin cuenta, la bienvenida, y lo guardado se olvida.
    await browser.evaluate(
      `(localStorage.setItem("inicio", JSON.stringify(${JSON.stringify(SAVED_HOME)})), 0)`,
    )
    await browser.open("goodttv.html?sinred")
    const NOTICE = `document.querySelector(".notice-block--warning")?.textContent ?? ""`
    step(
      "sin red: el aviso, con lo de la última vez",
      await waitFor(
        `(${NOTICE}).includes("No se pudo comprobar tu cuenta") && (${NOTICE}).includes("de la última vez")`,
      ),
    )
    step(
      "y los seguidos guardados, en Inicio y en la columna",
      await waitFor(
        `document.querySelector(".thumb")?.textContent.includes("guardado1") && document.querySelector(".sidebar__channel")?.textContent.includes("guardado1")`,
      ),
    )
    step(
      "nunca la bienvenida",
      !(await browser.evaluate(`document.body.innerText.includes("Twitch sin anuncios")`)),
    )
    await browser.evaluate(`(window.redPrueba = true, 0)`)
    await browser.click(".notice-block--warning .button")
    step(
      "con red, «Reintentar» pregunta de verdad: sin cuenta, la bienvenida",
      await waitFor(
        `document.body.innerText.includes("Twitch sin anuncios") && document.querySelector(".notice-block--warning") === null`,
      ),
    )
    step("y lo guardado se olvida", await waitFor(`localStorage.getItem("inicio") === null`))
    // Sin red también se puede cerrar sesión, desde Ajustes.
    await browser.evaluate(
      `(localStorage.setItem("inicio", JSON.stringify(${JSON.stringify(SAVED_HOME)})), 0)`,
    )
    // Desde la misma dirección solo cambia el #: hay que recargar para volver a comprobar la cuenta, sin red.
    await browser.open("goodttv.html?sinred#/ajustes")
    await browser.evaluate(`(location.reload(), 0)`).catch(() => undefined)
    await sleep(1500)
    step(
      "sin red, Ajustes lo dice y ofrece «Reintentar» y «Cerrar sesión»",
      await waitFor(
        `document.body.innerText.includes("No se pudo comprobar la cuenta") && document.querySelectorAll(".setting__actions .button").length === 2`,
      ),
    )
    await browser.click(".setting__actions .button:last-child")
    step(
      "«Cerrar sesión» deja sin cuenta y olvida lo guardado",
      await waitFor(
        `document.body.innerText.includes("Vincula tu cuenta") && localStorage.getItem("inicio") === null`,
      ),
    )

    // VOD-1: debajo de la ficha, las emisiones del canal; abrir una la reproduce, L salta 10 s y se guarda por dónde va.
    await browser.open(`goodttv.html#/canal/${channel}`)
    step(
      "debajo de la ficha, sus emisiones anteriores",
      await waitFor(`document.querySelectorAll(".videos .video-tile").length > 0`, 20_000),
    )
    // El directo y el VOD son pantallas con su propio <video>: el volumen elegido en una sigue en la otra.
    await waitFor(`(${VIDEO})?.tiempo > 1`, 40_000)
    await browser.evaluate(setVolume(0.3))
    step("el volumen, a 30 %", await waitFor(atVolume(0.3)), {
      volumen: await browser.evaluate(`(${VIDEO})?.volumen`),
    })
    // Está debajo del vídeo: a la vista antes del clic (en Chrome el clic es de verdad, en sus coordenadas). La marca
    // dice si la página se ha recargado entre medias.
    await browser.evaluate(
      `(document.querySelector(".videos .video-tile").scrollIntoView({ block: "center" }), globalThis.marcaPrueba = true, 0)`,
    )
    await browser.click(".videos .video-tile")
    step(
      "abrir una la reproduce",
      await waitFor(
        `location.hash.startsWith("#/vod/") && document.querySelector(".controls--vod") !== null && (${VIDEO})?.tiempo > 1 && (${VIDEO})?.pausado === false`,
        30_000,
      ),
    )
    step("con el volumen del directo", await browser.evaluate(atVolume(0.3)), {
      volumen: await browser.evaluate(`(${VIDEO})?.volumen`),
    })
    const before = await browser.evaluate(`(${VIDEO}).tiempo`)
    await press("l")
    step("L salta 10 s", await waitFor(`(${VIDEO}).tiempo >= ${before} + 9`), {
      antes: before,
      ahora: await browser.evaluate(`(${VIDEO}).tiempo`),
      recargada: await browser.evaluate(`globalThis.marcaPrueba !== true`),
    })
    step(
      "y guarda por dónde va",
      await waitFor(
        `Object.keys(JSON.parse(localStorage.getItem("vods-vistos") ?? "{}")).length > 0`,
        15_000,
      ),
    )

    // Varias GoodTTV a la vez (EXT-5): cada pestaña con su canal, y suena una sola, la última que se abrió a la vista.
    await browser.open(`goodttv.html#/canal/${channel}`)
    step(
      "la primera pestaña vuelve a su canal, con sonido",
      await waitFor(`(${VIDEO})?.tiempo > 3 && (${VIDEO})?.silencio === false`, 40_000),
    )
    step("y con el volumen que tenía", await browser.evaluate(atVolume(0.3)), {
      volumen: await browser.evaluate(`(${VIDEO})?.volumen`),
    })
    const other = await browser.openTab(`goodttv.html#/canal/${channel}`)
    const waitIn = async (page, expression, ms = 40_000) => {
      const until = Date.now() + ms
      while (Date.now() < until) {
        if (await page.evaluate(expression).catch(() => false)) return true
        await sleep(250)
      }
      return false
    }
    step("otra pestaña abre el canal y reproduce", await waitIn(other, `(${VIDEO})?.tiempo > 3`))
    step("con sonido", await waitIn(other, `(${VIDEO})?.silencio === false`))
    step("y con el volumen elegido en la primera", await waitIn(other, atVolume(0.3)), {
      volumen: await other.evaluate(`(${VIDEO})?.volumen`),
    })
    step(
      "y la primera sigue, sin sonido",
      await waitFor(`(${VIDEO})?.silencio === true && (${VIDEO})?.pausado === false`),
    )
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
