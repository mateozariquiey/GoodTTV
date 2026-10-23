// Página de prueba del hito 1: reproductor.html#canal[?modo=…&pausa=cada,duración[,arranque]] reproduce el directo
// sin anuncios con el empalme en la propia página y muestra su estado, que también leen las pruebas de humo
// (window.estadoPrueba). La interfaz de GoodTTV la sustituirá como página principal.
import { type EmpalmeEvent, installDirecto, parseSimulatedPause } from "@goodttv/sin-anuncios"
import Hls, { FetchLoader } from "hls.js"
import { safeEvent } from "./lab"

type Estado = {
  canal: string
  modo: string
  fase: "cargando" | "reproduciendo" | "sin-directo" | "error"
  tiempo: number
  alto: number
  pausado: boolean
  retrasoS: number | null // retraso de la imagen respecto a la hora real del fragmento
  fragmentos: { directo: number; vod: number }
  hosts: string[] // solo el host de los fragmentos en directo (para los permisos del manifest)
  esperas: number // eventos waiting del <video>
  errores: string[] // los últimos 20
  fatales: number // errores fatales de hls.js, aunque se recupere
  eventos: Record<string, number> // eventos del empalme, contados por tipo
  oculta: { veces: number; ms: number } // tiempo que la pestaña ha estado oculta
  registro: string[] // últimos eventos del empalme, con los segundos desde que se abrió la página
}

const params = new URLSearchParams(location.search)
const canal = location.hash.slice(1).toLowerCase()
const modo = params.get("modo") ?? "adaptativo"
const estado: Estado = {
  alto: 0,
  canal,
  errores: [],
  esperas: 0,
  eventos: {},
  fatales: 0,
  fase: "cargando",
  fragmentos: { directo: 0, vod: 0 },
  hosts: [],
  modo,
  oculta: { ms: 0, veces: 0 },
  pausado: true,
  registro: [],
  retrasoS: null,
  tiempo: 0,
}
Object.assign(globalThis, { estadoPrueba: estado })

const log = (event: EmpalmeEvent): void => {
  estado.eventos[event.ev] = (estado.eventos[event.ev] ?? 0) + 1
  estado.registro.push(JSON.stringify(safeEvent(event)))
  if (estado.registro.length > 40) estado.registro.shift()
}

installDirecto({ log, simulatedPause: parseSimulatedPause(params.get("pausa") ?? "") })

const form = document.querySelector<HTMLFormElement>("#canal")
form?.addEventListener("submit", (event) => {
  event.preventDefault()
  const value = new FormData(form).get("canal")
  if (typeof value === "string" && value !== "") location.hash = value
})
// Otro canal en la dirección: se empieza de cero.
addEventListener("hashchange", () => location.reload())

// El <video> se crea aquí, como en la tele: sin pistas de subtítulos (la interfaz no los usa).
const video = document.createElement("video")
video.autoplay = true
video.playsInline = true
document.querySelector("#video")?.replaceChildren(video)
const panel = document.querySelector("#estado")

const SYNC_SEGMENTS = 2.5
const NO_STOP_TARGET = 24
const LIVE_MAX_BEHIND = 4
const VOD_START_TARGET = 16

// Como useHlsPlayer.ts de la tele (hasta que la extensión use la misma interfaz): info, margen inicial y configuración
// de hls.js, más el FetchLoader para que sus peticiones a /stream/ pasen por la página. Sin el ajuste de velocidad que
// recupera o conserva el margen.
const start = async (element: HTMLVideoElement): Promise<void> => {
  const visit = crypto.randomUUID().replaceAll("-", "")
  const query = new URLSearchParams({ modo, visita: visit })
  const response = await fetch(`/stream/${canal}/info?${query}`)
  if (!response.ok) throw new Error(`info: HTTP ${response.status}`)
  const info = (await response.json()) as {
    filling: boolean
    offline: boolean
    quality: string | null
    segmentDuration: number | null
  }
  if (info.offline) {
    estado.fase = "sin-directo"
    return
  }
  if (info.quality !== null) query.set("q", info.quality)
  const segmentTarget = SYNC_SEGMENTS * (info.segmentDuration ?? 2)
  const target =
    modo === "sin-paradas"
      ? Math.max(NO_STOP_TARGET, segmentTarget)
      : info.filling
        ? Math.max(VOD_START_TARGET, segmentTarget)
        : segmentTarget
  const hls = new Hls({
    autoStartLoad: false,
    enableCEA708Captions: false,
    enableDateRangeMetadataCues: false,
    enableEmsgMetadataCues: false,
    enableID3MetadataCues: false,
    enableWebVTT: false,
    playlistLoadPolicy: {
      default: {
        errorRetry: { maxNumRetry: 60, maxRetryDelayMs: 8000, retryDelayMs: 1000 },
        maxLoadTimeMs: 30_000,
        maxTimeToFirstByteMs: 25_000,
        timeoutRetry: { maxNumRetry: 60, maxRetryDelayMs: 0, retryDelayMs: 0 },
      },
    },
    liveMaxLatencyDuration: target + (modo === "directo" ? LIVE_MAX_BEHIND : 60),
    liveSyncDuration: target,
    liveSyncOnStallIncrease: 0,
    loader: FetchLoader,
    manifestLoadingMaxRetry: 60,
    manifestLoadingRetryDelay: 1000,
    progressive: true,
    renderTextTracksNatively: false,
    startFragPrefetch: true,
  })
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    element.play().catch((error: unknown) => estado.errores.push(`play: ${String(error)}`))
  })
  hls.once(Hls.Events.LEVEL_LOADED, (_event, data) => {
    // fMP4, sin carga progresiva (ver useHlsPlayer.ts).
    if (data.details.fragments.some((frag) => frag.initSegment !== null))
      hls.config.progressive = false
    hls.startLoad(Math.max(0, data.details.edge - target))
  })
  hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
    const url = new URL(data.frag.url)
    if (url.pathname.startsWith("/stream/vod")) estado.fragmentos.vod++
    else {
      estado.fragmentos.directo++
      if (!estado.hosts.includes(url.host.replace(/^[^.]+/, "*"))) {
        estado.hosts.push(url.host.replace(/^[^.]+/, "*"))
      }
    }
  })
  hls.on(Hls.Events.ERROR, (_event, data) => {
    estado.errores.push(`${data.type}/${data.details}${data.fatal ? " (fatal)" : ""}`)
    if (estado.errores.length > 20) estado.errores.shift()
    if (!data.fatal) return
    estado.fatales++
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      // Al darlo por fatal, hls.js ya ha parado la carga, y recoverMediaError no la reanuda (sin autoStartLoad).
      const time = element.currentTime
      hls.recoverMediaError()
      hls.startLoad(time > 0 ? time : -1)
    } else estado.fase = "error"
  })
  hls.attachMedia(element)
  hls.loadSource(`/stream/${canal}/live.m3u8?${query}`)
  setInterval(() => {
    const playing = hls.playingDate
    estado.retrasoS = playing === null ? null : (Date.now() - playing.getTime()) / 1000
  }, 1000)
}

let hiddenAt: number | null = null
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = performance.now()
    estado.oculta.veces++
  } else if (hiddenAt !== null) {
    estado.oculta.ms += performance.now() - hiddenAt
    hiddenAt = null
  }
})

if (canal !== "") {
  video.addEventListener("playing", () => {
    estado.fase = "reproduciendo"
  })
  video.addEventListener("waiting", () => {
    estado.esperas++
  })
  start(video).catch((error: unknown) => {
    estado.fase = "error"
    estado.errores.push(String(error))
  })
  setInterval(() => {
    estado.tiempo = video.currentTime
    estado.alto = video.videoHeight
    estado.pausado = video.paused
    if (panel !== null) panel.textContent = JSON.stringify(estado, null, 2)
  }, 500)
}
