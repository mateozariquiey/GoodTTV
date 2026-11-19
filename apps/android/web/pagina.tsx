// La página de la app (index.html): Inicio, la búsqueda, el canal y la cuenta, para el dedo (pantallas/). El vídeo del
// canal es Media3, que la app pone debajo de la página (D21; pantallas/media3.ts), con el empalme en el motor
// (motor.ts). Lo propio de Android en la página es la red (lo que no puede pedir a Twitch desde su origen lo pide la app
// en nativo, red-nativa.ts) y window.api (api.ts), con la sesión cifrada por la app.
import "@fontsource-variable/atkinson-hyperlegible-next"
import { activarIdioma, type Platform, PlatformContext, useIdioma } from "@goodttv/interfaz"
import { pageStorage, readSavedHome } from "@goodttv/servicios"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { android, createAndroidApi } from "./api"
import { App } from "./pantallas/App"
import { atras, cerrarLoAbierto } from "./pantallas/rutas"
import { createRedNativa } from "./red-nativa"
import "./estilos.css"

globalThis.fetch = createRedNativa(globalThis.fetch.bind(globalThis), location.origin)

Object.defineProperty(window, "api", { value: createAndroidApi(android) })
// Atrás de Android (MainActivity): lo resuelve la página, que sabe en qué pantalla está y qué tiene abierto encima.
Object.assign(globalThis, { goodttvAtras: atras, goodttvCerrar: cerrarLoAbierto })

// Inicio de la última vez, que se lee sin esperar (page-home.ts). Sin configuración de hls.js: el vídeo es Media3.
const PLATFORM: Platform = {
  hls: {},
  savedHome: () => readSavedHome(pageStorage()),
}

const element = document.querySelector("#root")
if (element === null) throw new TypeError("Root element is missing")

// Al cambiar de idioma se vuelve a pintar todo sin recargar: el vídeo sigue sonando.
const Raiz = () => {
  useIdioma()
  return <App />
}

activarIdioma()
createRoot(element).render(
  <StrictMode>
    <PlatformContext value={PLATFORM}>
      <Raiz />
    </PlatformContext>
  </StrictMode>,
)
