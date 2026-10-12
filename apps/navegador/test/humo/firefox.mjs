// Firefox sin ventana controlado por WebDriver BiDi, sin dependencias: instala la extensión como temporal, con un
// UUID fijo para conocer la dirección de sus páginas, y evalúa código en ellas.
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connect, launch } from "./proceso.mjs"

const EXTENSION_ID = "goodttv@mateozariquiey.github.io"
const UUID = "7d1c4c2e-5b1a-4a0e-9a7e-3f0c1b2a9e11"

// wayland: en vez de sin ventana, en el compositor del laboratorio con ese socket (GPU y decodificación por hardware).
export const launchFirefox = async ({ extension, firefox = "/usr/bin/firefox", wayland }) => {
  const profile = await mkdtemp(join(tmpdir(), "goodttv-humo-firefox-"))
  const prefs = {
    "browser.shell.checkDefaultBrowser": false,
    "browser.startup.homepage_override.mstone": "ignore",
    "datareporting.policy.dataSubmissionEnabled": false,
    "extensions.webextensions.uuids": JSON.stringify({ [EXTENSION_ID]: UUID }),
    "media.autoplay.default": 0,
    "media.volume_scale": "0.0", // sin sonido, aunque la página crea que suena
    "toolkit.telemetry.reportingpolicy.firstRun": false,
  }
  await writeFile(
    join(profile, "user.js"),
    Object.entries(prefs)
      .map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`)
      .join("\n"),
  )
  // --remote-allow-system-access: sin él, BiDi no deja evaluar código en las páginas de una extensión.
  const { address, pid, stop } = await launch(
    firefox,
    [
      ...(wayland === undefined ? ["--headless"] : []),
      "--no-remote",
      "--profile",
      profile,
      "--remote-debugging-port=0",
      "--remote-allow-system-access",
    ],
    profile,
    /WebDriver BiDi listening on (ws:\/\/\S+)/,
    wayland,
  )
  try {
    const { close, command } = await connect(`${address}/session`)
    await command("session.new", { capabilities: {} })
    await command("webExtension.install", { extensionData: { path: extension, type: "path" } })
    // Al instalarse, la extensión abre su página (fondo.ts).
    let context
    for (let i = 0; i < 50 && context === undefined; i++) {
      const { contexts } = await command("browsingContext.getTree")
      context = contexts.find((each) => each.url.startsWith(`moz-extension://${UUID}/`))?.context
      if (context === undefined) await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (context === undefined) throw new Error("la extensión no abrió su página")
    // Devuelve valores de JavaScript, como Chrome con returnByValue: BiDi serializa los objetos a su manera.
    const evaluateIn = async (target, expression) => {
      const { exceptionDetails, result } = await command("script.evaluate", {
        awaitPromise: true,
        expression: `(async () => JSON.stringify(await (${expression})))()`,
        target: { context: target },
      })
      if (exceptionDetails) throw new Error(exceptionDetails.text)
      return result.value === undefined ? undefined : JSON.parse(result.value)
    }
    const evaluate = (expression) => evaluateIn(context, expression)
    return {
      pid,
      // BiDi no deja navegar a moz-extension://: la página navega sola (con otro canal, se recarga al cambiar el #).
      open: async (path) => {
        await evaluate(`(location.replace(${JSON.stringify(path)}), 0)`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      },
      evaluate,
      // Otra pestaña con una página de la extensión, para leerla (la abre la propia página: BiDi no navega a ellas).
      openTab: async (path) => {
        const id = await evaluate(
          `chrome.tabs.create({ url: ${JSON.stringify(path)} }).then((tab) => tab.id)`,
        )
        let other
        for (let i = 0; i < 50 && other === undefined; i++) {
          const { contexts } = await command("browsingContext.getTree")
          other = contexts.find(
            (each) => each.context !== context && each.url.startsWith(`moz-extension://${UUID}/`),
          )?.context
          if (other === undefined) await new Promise((resolve) => setTimeout(resolve, 200))
        }
        if (other === undefined) throw new Error("no se abrió la otra pestaña")
        return {
          close: () => evaluate(`chrome.tabs.remove(${id})`),
          evaluate: (expression) => evaluateIn(other, expression),
        }
      },
      // Sin acciones de BiDi en las páginas de una extensión: texto y clics se simulan en la página.
      type: (text) =>
        evaluate(`(() => {
          const input = document.activeElement
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set
          setter.call(input, input.value + ${JSON.stringify(text)})
          input.dispatchEvent(new Event("input", { bubbles: true }))
          return 0
        })()`),
      click: (selector, count = 1) =>
        evaluate(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)})
          for (let i = 0; i < ${count}; i++) element.click()
          if (${count} === 2) element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
          return 0
        })()`),
      // BiDi no admite acciones de teclado en las páginas de una extensión: la tecla se simula en la página. Recorre el
      // mismo camino de teclas a acciones (keyboard.ts), pero no es de confianza: no activa nada por sí sola.
      press: async (key) => {
        await evaluate(`(() => {
          const target = document.activeElement ?? document.body
          for (const type of ["keydown", "keyup"]) {
            target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: ${JSON.stringify(key)} }))
          }
          return 0
        })()`)
      },
      close: async () => {
        await command("session.end").catch(() => undefined)
        close()
        await stop()
      },
    }
  } catch (error) {
    await stop()
    throw error
  }
}
