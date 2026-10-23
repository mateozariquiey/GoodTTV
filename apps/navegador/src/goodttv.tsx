import "@fontsource-variable/atkinson-hyperlegible-next"
import { type Platform, PlatformContext } from "@goodttv/interfaz"
import { pageStorage, readSavedHome } from "@goodttv/servicios"
import { installDirecto } from "@goodttv/sin-anuncios"
import { FetchLoader } from "hls.js"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createExtensionApi } from "./api"
import { Desktop } from "./escritorio/Desktop"
import { parseRoute } from "./escritorio/routes"
import { labApi, labOptions } from "./lab"
import { isTabQuery, showsQuery, type TabFound } from "./pestanas"
import { fakeTokens, fakeTwitchDelay, installFakeTwitch, seedFakeToken } from "./twitch-falso"
import "./escritorio/desktop.css"

// La página de GoodTTV en la extensión: las pantallas de escritorio (escritorio/), con su window.api (api.ts) y el
// directo sin anuncios atendido en la propia página (installDirecto, de @goodttv/sin-anuncios).

// ?twitchfalso: la cuenta y el Helix falsos del laboratorio, con lo guardado en sessionStorage (twitch-falso.ts).
const fakeDelay = fakeTwitchDelay(location.search)
const homeStorage = fakeDelay === undefined ? pageStorage() : sessionStorage

// El reproductor de @goodttv/interfaz, con el FetchLoader de hls.js para que sus peticiones a /stream/ pasen por la
// página, e Inicio de la última vez, que se lee sin esperar (page-home.ts, de @goodttv/servicios).
const PLATFORM: Platform = {
  hls: { loader: FetchLoader },
  savedHome: () => readSavedHome(homeStorage),
}

const element = document.querySelector("#root")
if (element === null) throw new TypeError("Root element is missing")
const root = createRoot(element)

// Varias pestañas a la vez, cada una con su canal (EXT-5). Comparten la sesión de Twitch, los recientes y las
// preferencias (chrome.storage.local): lo que lee, cambia y escribe va en un bloqueo común (storage.ts), y lo que cambia
// otra pestaña se avisa a esta con el evento «goodttv-cambio» (cuenta o preferencias), que atiende Desktop.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return
  const token = changes["twitch-token"]
  // Renovar el token no cambia la cuenta: solo cuenta entrar o salir.
  if (token !== undefined && (token.oldValue === undefined) !== (token.newValue === undefined)) {
    dispatchEvent(new CustomEvent("goodttv-cambio", { detail: "cuenta" }))
  }
  if (changes["local-data"] !== undefined) {
    dispatchEvent(new CustomEvent("goodttv-cambio", { detail: "preferencias" }))
  }
})

// El fondo busca la pestaña que ya muestra una vista (pestanas.ts): contesta esta si es la suya.
chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
  if (!isTabQuery(message) || !showsQuery(message, parseRoute(location.hash))) return false
  void chrome.tabs
    .getCurrent()
    .then((tab) =>
      respond(
        tab?.id === undefined
          ? null
          : ({ tabId: tab.id, windowId: tab.windowId } satisfies TabFound),
      ),
    )
  return true
})

installDirecto(labOptions(location.search))
if (fakeDelay !== undefined) {
  installFakeTwitch(fakeDelay)
  seedFakeToken(sessionStorage)
}
const lab = fakeDelay === undefined ? {} : { homeStorage, tokens: fakeTokens(sessionStorage) }
Object.defineProperty(window, "api", { value: labApi(createExtensionApi(lab), location.search) })
root.render(
  <StrictMode>
    <PlatformContext value={PLATFORM}>
      <Desktop />
    </PlatformContext>
  </StrictMode>,
)
