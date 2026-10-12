// Prueba de la cuenta de Twitch en la extensión, con una persona: abre GoodTTV en un navegador sin ventana y con un
// perfil temporal (que se borra al terminar), pide el código de dispositivo y espera a que lo autorices en
// twitch.tv/activate desde cualquier navegador o móvil. Después comprueba, sin registrar tokens ni el chat:
// seguidos en la columna y miniaturas en Inicio, que llegan mensajes del chat de un directo, que un token caducado se renueva solo
// y que cerrar sesión borra la sesión guardada.
// Uso, desde la raíz y con la extensión compilada:
//   node apps/navegador/test/humo/cuenta.mjs [--navegador chrome|firefox]
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { launchChrome } from "./chrome.mjs"
import { launchFirefox } from "./firefox.mjs"

const { values: options } = parseArgs({
  options: { navegador: { default: "chrome", type: "string" } },
})
const launch = { chrome: launchChrome, firefox: launchFirefox }[options.navegador]
if (launch === undefined) throw new Error("--navegador chrome o firefox")
const extension = resolve(import.meta.dirname, "../../dist")
const out = (event) => console.log(JSON.stringify({ t: +(Date.now() / 1000).toFixed(1), ...event }))
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const { HUMO_CHROME: chrome, HUMO_FIREFOX: firefox } = process.env
const browser = await launch({ chrome, extension, firefox })
const steps = []
const step = (label, ok, details = {}) => {
  steps.push(ok)
  out({ ok, paso: label, ...details })
}
const waitFor = async (expression, ms) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await browser.evaluate(expression).catch(() => false)) return true
    await sleep(500)
  }
  return false
}
const STORED = `chrome.storage.local.get("twitch-token").then((items) => items["twitch-token"] ?? null)`

try {
  await browser.open("goodttv.html#/ajustes")
  await waitFor(`document.querySelector(".settings-group .button--primary") !== null`, 10_000)
  await browser.click(".settings-group .button--primary")
  await waitFor(`document.querySelector(".link-code__code [aria-hidden]") !== null`, 20_000)
  const code = await browser.evaluate(
    `document.querySelector(".link-code__code [aria-hidden]").textContent`,
  )
  out({ abre: "https://www.twitch.tv/activate", codigo: code, espera: "hasta 15 min" })

  const signedIn = await waitFor(`document.body.innerText.includes("Conectado como")`, 15 * 60_000)
  step("autoriza la cuenta", signedIn)
  if (!signedIn) throw new Error("no se autorizó a tiempo")
  step("guarda la sesión sin cifrar", (await browser.evaluate(STORED)) !== null)

  await browser.evaluate(`(location.hash = "#/", 0)`)
  const home = await waitFor(`document.querySelectorAll(".thumb").length > 0`, 20_000)
  const counts = await browser.evaluate(
    `({ columna: document.querySelectorAll(".sidebar__channel").length, miniaturas: document.querySelectorAll(".thumb").length })`,
  )
  step("seguidos en la columna y miniaturas en Inicio", home && counts.columna > 0, counts)

  // Un directo con chat: el primero de la columna de seguidos.
  await browser.click(".sidebar__channel")
  const chat = await waitFor(`document.querySelectorAll(".chat .message").length >= 3`, 60_000)
  step("llegan mensajes del chat", chat, {
    mensajes: await browser.evaluate(`document.querySelectorAll(".chat .message").length`),
  })

  // Token caducado: se cambia el de acceso por uno inválido; al validarlo, Twitch da 401 y se renueva solo.
  await browser.evaluate(
    `chrome.storage.local.get("twitch-token").then((items) => chrome.storage.local.set({ "twitch-token": { ...items["twitch-token"], accessToken: "caducado" } })).then(() => { location.hash = "#/ajustes"; location.reload() })`,
  )
  await sleep(3000)
  const renewed = await waitFor(`document.body.innerText.includes("Conectado como")`, 20_000)
  const token = await browser.evaluate(
    `${STORED}.then((token) => token !== null && token.accessToken !== "caducado")`,
  )
  step("renueva solo un token caducado", renewed && token)

  await browser.click(".settings-group .button")
  const loggedOut = await waitFor(`document.body.innerText.includes("Vincular cuenta")`, 20_000)
  step(
    "cerrar sesión borra la sesión guardada",
    loggedOut && (await browser.evaluate(STORED)) === null,
  )
} catch (error) {
  step("sin errores", false, { motivo: String(error) })
} finally {
  await browser.close()
}
out({ ok: steps.every(Boolean), pasos: steps.length, veredicto: true })
process.exit(steps.every(Boolean) ? 0 : 1)
