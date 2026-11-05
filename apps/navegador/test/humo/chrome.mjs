// Chrome for Testing sin ventana con la extensión cargada (el Chrome de marca ya no carga extensiones por línea de
// comandos), controlado por CDP sin dependencias. No con Playwright: activa la emulación de foco, con la que Chrome
// da por visibles todas las pestañas, y quita el freno a las pestañas en segundo plano, que es lo que hay que probar.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { connect, launch } from "./proceso.mjs"

// Teclas con nombre que usan las pruebas; las letras se deducen.
const KEYS = {
  " ": { code: "Space", keyCode: 32, text: " " },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  End: { code: "End", keyCode: 35 },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
}

// wayland: en vez de sin ventana, en el compositor del laboratorio con ese socket (GPU y decodificación por hardware).
export const launchChrome = async ({
  extension,
  chrome = join(homedir(), ".cache/chrome-for-testing/chrome-linux64/chrome"),
  wayland,
}) => {
  const profile = await mkdtemp(join(tmpdir(), "goodttv-humo-chrome-"))
  // Las pruebas buscan los textos en español, y en Linux Chrome no hace caso de --lang: lo saca de su perfil.
  // HUMO_IDIOMA=en: un sistema en otro idioma, para un recorrido.
  const idioma = process.env.HUMO_IDIOMA ?? "es"
  await mkdir(join(profile, "Default"))
  await writeFile(
    join(profile, "Default", "Preferences"),
    JSON.stringify({ intl: { accept_languages: idioma, selected_languages: idioma } }),
  )
  const { address, pid, stop } = await launch(
    chrome,
    [
      ...(wayland === undefined
        ? ["--headless"]
        : ["--ozone-platform=wayland", "--start-maximized"]),
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      // Sin el llavero del sistema: si está bloqueado (una sesión sin escritorio, como la VM de agentes), Chrome
      // espera a que se desbloquee antes de abrir las cookies, y ninguna petición de red sale. El perfil es temporal.
      "--password-store=basic",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      "about:blank",
    ],
    profile,
    /DevTools listening on (ws:\/\/\S+)/,
    wayland,
  )
  try {
    const { close, command } = await connect(address)
    // Al instalarse, la extensión abre su página (fondo.ts).
    let page
    for (let i = 0; i < 50 && page === undefined; i++) {
      const { targetInfos } = await command("Target.getTargets")
      page = targetInfos.find(
        (target) => target.type === "page" && target.url.startsWith("chrome-extension://"),
      )
      if (page === undefined) await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (page === undefined) throw new Error("la extensión no abrió su página")
    const origin = `chrome-extension://${new URL(page.url).host}` // URL.origin da "null" en Node
    const { sessionId } = await command("Target.attachToTarget", {
      flatten: true,
      targetId: page.targetId,
    })
    const evaluateIn = async (session, expression) => {
      const { exceptionDetails, result } = await command(
        "Runtime.evaluate",
        { awaitPromise: true, expression, returnByValue: true },
        session,
      )
      if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
      }
      return result.value
    }
    const evaluate = (expression) => evaluateIn(sessionId, expression)
    return {
      // Una orden CDP a la página (métricas de rendimiento, dominio Media…).
      cdp: (method, params = {}) => command(method, params, sessionId),
      pid,
      // Con otro canal solo cambia el #: la página se recarga sola.
      open: async (path) => {
        await command("Page.navigate", { url: `${origin}/${path}` }, sessionId)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      },
      evaluate,
      // Texto en el campo con el foco, como si se tecleara.
      type: (text) => command("Input.insertText", { text }, sessionId),
      // Un clic de verdad en el elemento (doble con count 2): en su centro o, si otro lo tapa ahí, en el primer punto
      // donde se ve, como haría una persona. En la ventana pequeña de Chrome sin pantalla, la barra de controles con
      // «Ir al directo» tapa el centro del vídeo (29 oct).
      click: async (selector, count = 1) => {
        const box = await evaluate(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)})
          element.scrollIntoView({ block: "nearest" }) // un clic fuera de la ventana no llega a nada
          const rect = element.getBoundingClientRect()
          for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.25], [0.25, 0.25], [0.75, 0.25], [0.5, 0.75]]) {
            const x = rect.left + rect.width * fx
            const y = rect.top + rect.height * fy
            if (element.contains(document.elementFromPoint(x, y))) return { x, y }
          }
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        })()`)
        for (let clickCount = 1; clickCount <= count; clickCount++) {
          for (const type of ["mousePressed", "mouseReleased"]) {
            await command(
              "Input.dispatchMouseEvent",
              { button: "left", clickCount, type, x: box.x, y: box.y },
              sessionId,
            )
          }
        }
      },
      // Captura PNG de la página a un tamaño de ventana dado.
      screenshot: async (width, height) => {
        await command(
          "Emulation.setDeviceMetricsOverride",
          { deviceScaleFactor: 1, height, mobile: false, width },
          sessionId,
        )
        const { data } = await command("Page.captureScreenshot", { format: "png" }, sessionId)
        return Buffer.from(data, "base64")
      },
      // Otra pestaña con una página de la extensión, para leerla. inWindow: en su propia ventana, a la vista junto a la
      // primera.
      openTab: async (path, { inWindow = false } = {}) => {
        const { targetId } = await command("Target.createTarget", {
          newWindow: inWindow,
          url: `${origin}/${path}`,
        })
        const tab = await command("Target.attachToTarget", { flatten: true, targetId })
        return {
          close: () => command("Target.closeTarget", { targetId }),
          evaluate: (expression) => evaluateIn(tab.sessionId, expression),
        }
      },
      // Una pulsación de verdad (llega a la página como un KeyboardEvent de confianza).
      press: async (key) => {
        const { code, keyCode, text } = KEYS[key] ?? {
          code: `Key${key.toUpperCase()}`,
          keyCode: key.toUpperCase().charCodeAt(0),
          text: key,
        }
        const base = { code, key, windowsVirtualKeyCode: keyCode }
        await command("Input.dispatchKeyEvent", { ...base, text, type: "keyDown" }, sessionId)
        await command("Input.dispatchKeyEvent", { ...base, type: "keyUp" }, sessionId)
      },
      close: async () => {
        close()
        await stop()
      },
    }
  } catch (error) {
    await stop()
    throw error
  }
}
