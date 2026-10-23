// La página de la app (index.html): Inicio, la búsqueda, el canal y la cuenta, para el dedo (pantallas/). El vídeo del
// canal es Media3, que la app pone debajo de la página (A, D21; pantallas/media3.ts), con el empalme en el motor
// (motor.ts). Lo propio de Android en la página es la red (lo que no puede pedir a Twitch desde su origen lo pide la app
// en nativo, red-nativa.ts) y window.api (api.ts), con la sesión cifrada por la app.
// Con ?reproductor=b, en cambio, abre el canal con hls.js en la propia página (B), solo para medir (medir-b.tsx).
import "@fontsource-variable/atkinson-hyperlegible-next"
import { type Platform, PlatformContext } from "@goodttv/interfaz"
import { pageStorage, readSavedHome } from "@goodttv/servicios"
import { FetchLoader } from "hls.js"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { android, createAndroidApi } from "./api"
import { fetchDeB, MedirB } from "./medir-b"
import { App } from "./pantallas/App"
import { atras, cerrarLoAbierto } from "./pantallas/rutas"
import { createRedNativa } from "./red-nativa"
import "./estilos.css"

const medirB = new URLSearchParams(location.search).get("reproductor") === "b"
const nativeFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = medirB
  ? fetchDeB(nativeFetch)
  : createRedNativa(nativeFetch, location.origin, false)

Object.defineProperty(window, "api", { value: createAndroidApi(android) })
// Atrás de Android (MainActivity): lo resuelve la página, que sabe en qué pantalla está y qué tiene abierto encima.
if (!medirB) Object.assign(globalThis, { goodttvAtras: atras, goodttvCerrar: cerrarLoAbierto })

// Inicio de la última vez, que se lee sin esperar (page-home.ts), y para B, el FetchLoader de hls.js (sus peticiones a
// /stream/ pasan por la página).
const PLATFORM: Platform = {
  hls: { loader: FetchLoader },
  savedHome: () => readSavedHome(pageStorage()),
}

const element = document.querySelector("#root")
if (element === null) throw new TypeError("Root element is missing")
createRoot(element).render(
  <StrictMode>
    <PlatformContext value={PLATFORM}>{medirB ? <MedirB /> : <App />}</PlatformContext>
  </StrictMode>,
)
