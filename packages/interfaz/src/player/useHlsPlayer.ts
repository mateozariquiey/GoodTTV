import type { LatencyMode } from "@goodttv/contratos"
import Hls from "hls.js"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { usePlatform } from "../platform"
import type { PlayerState } from "./useTwitchPlayer"
import { chooseVolume, chosenVolume, type Volume } from "./volume"

// Reproductor propio: un <video> con hls.js que lee el directo sin anuncios que prepara el proceso principal en
// /stream/<canal>/ (src/main/stream). Mismo contrato que useTwitchPlayer, para que PlayerScreen no dependa de cuál
// se usa. No hay puerta de contenido de Twitch (gateHint siempre falso).

const INITIAL: PlayerState = {
  blocked: false,
  gateHint: false,
  muted: false,
  phase: "loading",
  playing: false,
  qualities: [],
  quality: "auto",
}

const STALL_MS = 20_000
const END_WATCH_MS = 5000
// Retraso típico de un espectador de Twitch respecto al emisor (embed oficial, medido: ~2,7 s). Quien escribe en el
// chat lo hace viendo el directo con ese retraso.
export const TWITCH_VIEWER_LATENCY = 3

// Cuánto va la imagen por detrás de lo que ve un espectador normal de Twitch, en segundos enteros: el precio de no ver
// anuncios. null mientras no se sabe. Se mira cada segundo; el chat se retrasa lo mismo.
export const useBehind = (latency: { readonly current: number | null }): number | null => {
  const [behind, setBehind] = useState<number | null>(null)
  useEffect(() => {
    const timer = setInterval(() => {
      const seconds = latency.current
      setBehind(seconds === null ? null : Math.max(0, Math.round(seconds - TWITCH_VIEWER_LATENCY)))
    }, 1000)
    return () => clearInterval(timer)
  }, [latency])
  return behind
}
// Margen hasta el final de la lista, en fragmentos del directo. Con la carga progresiva, el último (PREFETCH, que se
// descarga mientras se codifica) se añade a medida que llega: con 2,5 quedan 1-2 s de búfer.
const SYNC_SEGMENTS = 2.5
const NO_STOP_TARGET = 24 // modo sin paradas: margen fijo (s) hasta el final de la lista, que cubre la espera del VOD
const LIVE_MAX_BEHIND = 4 // modo directo: más atrás que esto sobre el objetivo, hls.js salta al directo
const MAX_BEHIND = 60 // los otros modos: lo mismo, con margen para las pausas de la persona (la lista abarca 100 s)
// El margen conservado se queda al menos esto por debajo de liveMaxLatencyDuration. Con el objetivo por encima, cada
// lista nueva puede hacer que hls.js recoloque la posición, y con la lista larga apenas la movería: saltos repetidos.
const KEEP_BELOW_MAX = 10
// Si se empieza mientras se publican trozos del VOD (crece a saltos de ~10 s), margen (s) para no quedarse sin datos.
const VOD_START_TARGET = 16
// Adaptativo (REN-2): una parada de hasta tanto (s) en pleno directo es un canal que entrega a trompicones, y su retraso se
// conserva, porque es justo el margen que le faltaba. Por debajo es un tropiezo; por encima, una pausa global sin VOD, que
// dejaría un retraso enorme para siempre.
const DELIVERY_STALL_MIN = 1
const DELIVERY_STALL_MAX = 12
// Al retroceder, fragmentos que se dejan hasta el principio de la lista: mientras se ve, la lista avanza a la par, y lo
// que sale de ella ya no se puede pedir.
const SEEK_FLOOR_SEGMENTS = 3
// ← → caen en el fotograma clave más cercano (el principio de un fragmento) si está a menos de esto (s) del punto exacto:
// así el navegador no decodifica hasta 2 s de vídeo para llegar a él (161 → 112 ms hasta que la imagen se mueve, 31 oct;
// investigacion/velocidad/informe.md). Como Media3 en Android (PREVIOUS_SYNC).
const SEEK_SNAP_S = 1
// El principio de un fragmento según hls.js puede quedar unas centésimas antes de su fotograma clave de vídeo (el
// audio empieza antes): justo en él, el navegador decodificaba desde el fotograma clave anterior.
const SEEK_SNAP_AFTER_S = 0.1

type StreamInfo = {
  readonly filling: boolean
  readonly offline: boolean
  readonly qualities: readonly { readonly id: string; readonly label: string }[]
  readonly quality: string | null // la pedida: con ella se pide la lista, para que el directo no recree el empalme
  readonly playing?: string | null // la que suena, si el canal no tiene la pedida: la que enseña el menú
  readonly segmentDuration: number | null
}

// visit: una por reproductor creado. Si el proceso principal aún tenía el empalme del canal (se volvió a él enseguida),
// sabe que este reproductor empieza con el margen corto.
const streamQuery = (
  quality: string | null,
  mode: LatencyMode,
  visit: string,
  hueco: number,
): string => {
  const query = new URLSearchParams({ modo: mode, visita: visit })
  if (quality !== null) query.set("q", quality)
  if (hueco > 0) query.set("hueco", String(hueco))
  return `?${query}`
}

// Calidad elegida a mano (null: automática, la mejor que dé el canal). Se queda hasta que se elija otra: el canal
// siguiente se pide con ella, también tras retroceder al VOD y volver al directo (otro reproductor) o abrirlo desde
// Inicio, y se precalienta con ella. Como el volumen (volume.ts) y en twitch.tv, se guarda en el localStorage de la
// página: una pestaña nueva, o GoodTTV al volver a abrirlo, empieza con la última que se eligió. Una pestaña abierta
// sigue con la suya aunque se elija otra en otra.
const QUALITY_KEY = "calidad-directo"
const QUALITY_ID = /^\d+x\d+@\d+$/ // como la pide el directo: resolución@fps

const qualityStorage = (): Storage | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

let chosenQuality: string | null | undefined // la de esta pestaña; undefined hasta leerla

export const chosenLiveQuality = (storage = qualityStorage()): string | null => {
  if (chosenQuality === undefined) {
    const saved = storage?.getItem(QUALITY_KEY) ?? null
    chosenQuality = saved !== null && QUALITY_ID.test(saved) ? saved : null
  }
  return chosenQuality
}

const chooseQuality = (quality: string | null, storage = qualityStorage()): void => {
  chosenQuality = quality
  try {
    if (quality === null) storage?.removeItem(QUALITY_KEY)
    else storage?.setItem(QUALITY_KEY, quality)
  } catch {
    // Sin sitio: vale para esta pestaña.
  }
}

// Precalentar: pide al directo que abra ya el empalme de un canal que probablemente se va a abrir, sin parar el que
// suena. Al abrirlo, el arranque lleva ya ese adelanto (abrir las sesiones de Twitch, a veces el directo publicado).
// Con la calidad que se va a pedir: con otra, el directo abriría el canal otra vez.
export const prewarmStream = (login: string, mode: LatencyMode, hueco = 0): void => {
  const query = new URLSearchParams({ modo: mode })
  const quality = chosenLiveQuality()
  if (quality !== null) query.set("q", quality)
  if (hueco > 0) query.set("hueco", String(hueco))
  void fetch(`/stream/${login}/precalentar?${query}`).catch(() => undefined)
}

// Precalienta un canal cuando lleva «dwellMs» señalado (el ratón encima, el foco en él); null: ninguno.
export const usePrewarm = (login: string | null, mode: LatencyMode, dwellMs: number): void => {
  useEffect(() => {
    if (login === null) return undefined
    const timer = setTimeout(() => prewarmStream(login, mode), dwellMs)
    return () => clearTimeout(timer)
  }, [dwellMs, login, mode])
}

const readInfo = async (
  login: string,
  quality: string | null,
  mode: LatencyMode,
  visit: string,
  hueco: number,
  signal: AbortSignal,
): Promise<StreamInfo> => {
  const response = await fetch(`/stream/${login}/info${streamQuery(quality, mode, visit, hueco)}`, {
    signal,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as StreamInfo
}

// Con la cuadrícula activada (EXT-6). hueco: el directo que atiende este canal (directo-huecos.ts). inCell: es una celda:
// empieza callada si no es la que suena (silent), y la pantalla encendida la lleva la cuadrícula, porque quitar una
// celda no debe soltarla. Además, un reproductor que se va de la pantalla se puede quedar en la siguiente (abajo).
export type PlayerGrid = {
  readonly hueco: number
  readonly inCell: boolean
  readonly silent: boolean
}

// Lo que un reproductor en marcha necesita de la pantalla que lo muestra.
type PlayerOwner = {
  readonly element: HTMLElement
  readonly latency: React.RefObject<number | null>
  readonly patch: (next: Partial<PlayerState>) => void
  readonly seeker: React.RefObject<((seconds: number, orStart: boolean) => number | null) | null>
  readonly setPictureInPicture: (on: boolean) => void
  readonly setRewound: (on: boolean) => void
  readonly setState: React.Dispatch<React.SetStateAction<PlayerState>>
}
// Una visita = un <video> y un hls.js. Sus closures llegan a la pantalla por owner, que cambia si pasa a otra.
type PlayerVisit = {
  readonly channel: string
  readonly destroy: () => void
  readonly hueco: number
  readonly mode: LatencyMode
  owner: PlayerOwner
  readonly quality: string | null
  readonly video: HTMLVideoElement
}
// Entrar y salir de la cuadrícula sin cortar el vídeo. Al pasar del canal a la cuadrícula o al revés, React quita una
// pantalla y monta la otra en el mismo commit: el reproductor de la que se va espera aquí y la nueva lo recoge, en la
// misma tarea, antes de que el navegador note que el <video> ha salido del documento (solo lo pausa si sigue fuera
// al terminar la tarea). Lo que nadie recoge se destruye en la tarea siguiente.
type WaitingVisit = {
  readonly latency: number | null
  readonly pictureInPicture: boolean
  readonly rewound: boolean
  readonly seeker: ((seconds: number, orStart: boolean) => number | null) | null
  readonly state: PlayerState
  readonly userPaused: boolean
  readonly visit: PlayerVisit
}
const waiting = new Map<string, WaitingVisit>()

export const useHlsPlayer = (
  container: React.RefObject<HTMLElement | null>,
  channel: string,
  enabled: boolean,
  mode: LatencyMode,
  canGoLive = false,
  grid?: PlayerGrid,
) => {
  const hueco = grid?.hueco ?? 0
  const inCell = grid?.inCell ?? false
  const keepable = grid !== undefined
  const startSilent = useRef(false)
  startSilent.current = grid?.silent ?? false
  const [state, setState] = useState<PlayerState>(INITIAL)
  const [attempt, setAttempt] = useState(0)
  const [quality, setQualityState] = useState<string | null>(() => chosenLiveQuality())
  const videoRef = useRef<HTMLVideoElement | undefined>(undefined)
  const userPaused = useRef(false)
  const latency = useRef<number | null>(null)
  const seeker = useRef<((seconds: number, orStart: boolean) => number | null) | null>(null)
  const [rewound, setRewound] = useState(false)
  const [pictureInPicture, setPictureInPicture] = useState(false)
  const { hls: platformHls } = usePlatform()

  const patch = useCallback((next: Partial<PlayerState>) => {
    setState((current) => ({ ...current, ...next }))
  }, [])

  const visitNow = useRef<PlayerVisit | null>(null)
  const justKept = useRef<PlayerVisit | null>(null) // recogido al montar: el efecto de abajo no crea otro
  const leaving = useRef({ pictureInPicture, rewound, state })
  leaving.current = { pictureInPicture, rewound, state }
  // En el layout, porque es lo que corre antes de que React saque del documento la pantalla que se va y antes de pintar
  // la nueva. Sin cuadrícula (keepable), no hace nada: al desmontar se destruye como siempre.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al montar y al desmontar la pantalla.
  useLayoutEffect(() => {
    if (!keepable) return undefined
    const element = container.current
    const kept = waiting.get(channel)
    if (
      kept !== undefined &&
      element !== null &&
      enabled &&
      kept.visit.hueco === hueco &&
      kept.visit.mode === mode &&
      kept.visit.quality === quality
    ) {
      waiting.delete(channel)
      const { video } = kept.visit
      element.replaceChildren(video)
      kept.visit.owner = {
        element,
        latency,
        patch,
        seeker,
        setPictureInPicture,
        setRewound,
        setState,
      }
      videoRef.current = video
      visitNow.current = kept.visit
      justKept.current = kept.visit
      latency.current = kept.latency
      seeker.current = kept.seeker
      userPaused.current = kept.userPaused
      setRewound(kept.rewound)
      setPictureInPicture(kept.pictureInPicture)
      // Una celda muda que pasa a verse sola suena como eligió la persona. En una celda, se encarga la cuadrícula.
      const sound = inCell ? { muted: video.muted } : chosenVolume()
      if (!inCell) {
        video.volume = chosenVolume().volume
        video.muted = sound.muted
      }
      setState({ ...kept.state, muted: sound.muted })
    }
    return () => {
      const visit = visitNow.current
      if (visit === null) return
      visitNow.current = null
      const stay: WaitingVisit = {
        latency: latency.current,
        pictureInPicture: leaving.current.pictureInPicture,
        rewound: leaving.current.rewound,
        seeker: seeker.current,
        state: leaving.current.state,
        userPaused: userPaused.current,
        visit,
      }
      waiting.set(visit.channel, stay)
      setTimeout(() => {
        if (waiting.get(visit.channel) !== stay) return
        waiting.delete(visit.channel)
        visit.destroy()
      }, 0)
    }
  }, [])

  // Una visita (o un reintento, o un cambio de calidad) = un <video> y un hls.js nuevos.
  useEffect(() => {
    const element = container.current
    if (!enabled || element === null) return undefined
    const leave = (visit: PlayerVisit) => (): void => {
      if (!inCell) void window.api.player.setWatching(false)
      // Se ha quedado esperando (arriba) o ya es de otra pantalla: no es de este efecto destruirlo.
      if (visitNow.current !== visit) return
      visitNow.current = null
      visit.destroy()
    }
    if (justKept.current !== null) {
      const kept = justKept.current
      justKept.current = null
      if (!inCell) void window.api.player.setWatching(true)
      return leave(kept)
    }
    let active = true
    const abort = new AbortController()
    // Como el anterior (un reintento, otro canal) o, el primero, con lo que eligió la persona en otra pantalla.
    const sound = videoRef.current ?? chosenVolume()
    setState({ ...INITIAL, muted: sound.muted })
    setRewound(false)
    setPictureInPicture(false) // un <video> nuevo: el de antes, si estaba en imagen en imagen, ya no está
    // Un canal que nunca arranca se informa en vez de girar para siempre. El plazo es de cada visita: con otro canal
    // que también carga, la fase no cambia y un efecto aparte seguiría con el plazo del anterior.
    const stall = setTimeout(() => {
      visit.owner.setState((current) =>
        current.phase === "loading" ? { ...current, phase: "stalled" } : current,
      )
    }, STALL_MS)
    userPaused.current = false
    if (!inCell) void window.api.player.setWatching(true)
    const video = document.createElement("video")
    video.className = "player__media"
    video.dataset["attempt"] = String(attempt) // un reintento crea un <video> nuevo
    video.autoplay = true
    video.playsInline = true
    video.muted = sound.muted || startSilent.current
    video.volume = sound.volume
    videoRef.current = video
    element.replaceChildren(video)
    const visit: PlayerVisit = {
      channel,
      destroy: () => {
        active = false
        abort.abort()
        clearTimeout(stall)
        if (catchup !== undefined) clearInterval(catchup)
        if (endWatch !== undefined) clearInterval(endWatch)
        visit.owner.seeker.current = null
        hls?.destroy()
        video.pause()
        video.removeAttribute("src")
        video.load()
        visit.owner.element.replaceChildren()
      },
      hueco,
      mode,
      owner: { element, latency, patch, seeker, setPictureInPicture, setRewound, setState },
      quality,
      video,
    }
    visitNow.current = visit
    let hls: Hls | undefined
    let catchup: ReturnType<typeof setInterval> | undefined
    let endWatch: ReturnType<typeof setInterval> | undefined

    const start = (): void => {
      if (!active) return
      video.play().catch((error: unknown) => {
        if (active && error instanceof DOMException && error.name === "NotAllowedError") {
          visit.owner.patch({ blocked: true, playing: false })
        }
      })
    }
    video.addEventListener(
      "playing",
      () => active && visit.owner.patch({ blocked: false, phase: "ready", playing: true }),
    )
    video.addEventListener("pause", () => active && visit.owner.patch({ playing: false }))
    video.addEventListener(
      "volumechange",
      () => active && visit.owner.patch({ muted: video.muted }),
    )
    video.addEventListener(
      "enterpictureinpicture",
      () => active && visit.owner.setPictureInPicture(true),
    )
    video.addEventListener(
      "leavepictureinpicture",
      () => active && visit.owner.setPictureInPicture(false),
    )

    latency.current = null
    const visitId = crypto.randomUUID().replaceAll("-", "")
    readInfo(channel, quality, mode, visitId, hueco, abort.signal)
      .then((info) => {
        if (!active) return
        if (info.offline) {
          visit.owner.patch({ phase: "offline", playing: false })
          return
        }
        visit.owner.patch({
          qualities: info.qualities,
          quality: info.playing ?? info.quality ?? "auto",
        })
        const segmentTarget = SYNC_SEGMENTS * (info.segmentDuration ?? 2)
        const target =
          mode === "sin-paradas"
            ? Math.max(NO_STOP_TARGET, segmentTarget)
            : info.filling
              ? Math.max(VOD_START_TARGET, segmentTarget)
              : segmentTarget
        const maxLatency = target + (mode === "directo" ? LIVE_MAX_BEHIND : MAX_BEHIND)
        const player = new Hls({
          autoStartLoad: false, // empieza a cargar en el objetivo (LEVEL_LOADED, abajo)
          // Sin subtítulos ni pistas de metadatos (la interfaz no los usa): hls.js crearía pistas data: que la
          // CSP bloquea.
          enableCEA708Captions: false,
          enableDateRangeMetadataCues: false,
          enableEmsgMetadataCues: false,
          enableID3MetadataCues: false,
          enableWebVTT: false,
          renderTextTracksNatively: false,
          // El directo retiene cada petición de la lista hasta 20 s, hasta que haya un fragmento nuevo (BLOCK_MS en
          // @goodttv/sin-anuncios): se espera algo más antes de darla por perdida.
          playlistLoadPolicy: {
            default: {
              errorRetry: { maxNumRetry: 60, maxRetryDelayMs: 8000, retryDelayMs: 1000 },
              maxLoadTimeMs: 30_000,
              maxTimeToFirstByteMs: 25_000,
              timeoutRetry: { maxNumRetry: 60, maxRetryDelayMs: 0, retryDelayMs: 0 },
            },
          },
          liveMaxLatencyDuration: maxLatency,
          liveSyncDuration: target,
          liveSyncOnStallIncrease: 0,
          manifestLoadingMaxRetry: 60,
          manifestLoadingRetryDelay: 1000,
          // Cada fragmento se añade al vídeo a medida que llega. El último de Twitch (PREFETCH) se descarga mientras
          // se codifica, durante unos 2 s: sin esto el búfer solo crecía al completarse cada fragmento. También con
          // fMP4 (EXT-X-MAP, los canales con Enhanced Broadcasting) desde hls.js 1.7.4: hasta la 1.7.3, cada trozo
          // que llegaba se ponía encima de lo anterior (hls.js#8058), y en fMP4 se cargaba fragmento a fragmento con
          // 3 fragmentos de margen (REN-4).
          progressive: true,
          // El primer fragmento se pide sin esperar a que el <video> tenga listo su MediaSource.
          startFragPrefetch: true,
          ...platformHls,
        })
        hls = player
        player.on(Hls.Events.MANIFEST_PARSED, start)
        // Arranque justo en el objetivo, a «target» s del final de la lista. Por su cuenta, hls.js no empieza más cerca
        // del final que TARGETDURATION, y con relleno la lista declara 13 s (los trozos del VOD): empezaría al
        // principio de la lista, más atrás de lo pedido, y luego aceleraría (1,05× descarta fotogramas).
        player.once(Hls.Events.LEVEL_LOADED, (_event, data) => {
          player.startLoad(Math.max(0, data.details.edge - target))
        })
        // Pausar es retroceder (DVR-1): al reanudar, lo que se ha quedado atrás no es margen que sobre. Se conserva como
        // lo retrocedido, con «Ir al directo» para volver, en vez de saltárselo. En el modo directo, no: va lo más cerca
        // posible del directo, y pasados LIVE_MAX_BEHIND s hls.js ya salta solo. Tampoco sin «Ir al directo» (la tele):
        // se quedaría atrás para siempre. Ni una pausa de un instante (pulsar dos veces): no es retroceder.
        let pausedAt: number | null = null
        let pausedFor = 0 // s que duró la pausa más larga desde que lo miró el intervalo
        video.addEventListener("pause", () => {
          pausedAt = performance.now()
        })
        video.addEventListener("playing", () => {
          if (pausedAt !== null)
            pausedFor = Math.max(pausedFor, (performance.now() - pausedAt) / 1000)
          pausedAt = null
        })
        player.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            // Al darlo por fatal, hls.js ya ha parado la carga, y recoverMediaError solo vuelve a conectar el <video>
            // (sin autoStartLoad no la reanuda): se reanuda aquí, donde iba.
            const time = video.currentTime
            player.recoverMediaError()
            player.startLoad(time > 0 ? time : -1)
          } else if (active) visit.owner.patch({ phase: "error", playing: false })
        })
        // Si la emisión termina con el canal abierto, la lista se queda como estaba, sin error, y hls.js seguiría
        // esperando: parado STALL_MS y sin pausa, se pregunta si sigue (el empalme lo sabe, y contesta enseguida).
        let lastTime = -1
        let stuckSince = performance.now()
        endWatch = setInterval(() => {
          if (video.paused || video.currentTime !== lastTime) {
            lastTime = video.currentTime
            stuckSince = performance.now()
          } else if (performance.now() - stuckSince >= STALL_MS) {
            stuckSince = performance.now()
            readInfo(channel, info.quality, mode, visitId, hueco, abort.signal)
              .then((now) => {
                if (active && now.offline) {
                  hls?.destroy()
                  visit.owner.patch({ phase: "offline", playing: false })
                }
              })
              .catch(() => undefined) // no se sabe: sigue esperando
          }
        }, END_WATCH_MS)
        player.attachMedia(video) // primero: el MediaSource se abre mientras llega la lista
        player.loadSource(
          `/stream/${channel}/live.m3u8${streamQuery(info.quality, mode, visitId, hueco)}`,
        )
        // Margen según el modo (D11). Adaptativo: tras la primera pausa global del canal (llegan trozos del VOD) se
        // conserva el margen que deja el relleno, para que las siguientes no se noten; antes, lo que sobre se salta.
        // Sin paradas: el margen mínimo es fijo y lo que se añada (una parada) se conserva, hasta un tope, como en
        // adaptativo tras el primer relleno. Directo: lo que sobre se salta, y si se queda mucho atrás, hls.js salta
        // (liveMaxLatencyDuration).
        let keepMargin = mode === "sin-paradas"
        player.on(Hls.Events.FRAG_LOADING, (_event, data) => {
          if (mode === "adaptativo" && data.frag.url.includes("/stream/vod")) keepMargin = true
        })
        // Lo mismo tras una parada por falta de datos en un canal que entrega a trompicones (REN-2): sin saltar lo que
        // ha añadido, la siguiente ya no para. Los canales que no se paran siguen con el margen corto.
        let stalledAt: number | null = null
        let started = false
        video.addEventListener("waiting", () => {
          if (started && !video.seeking && !video.paused) stalledAt = performance.now()
        })
        const notStalled = (): void => {
          stalledAt = null
        }
        video.addEventListener("seeking", notStalled)
        video.addEventListener("pause", notStalled)
        video.addEventListener("playing", () => {
          started = true
          if (stalledAt === null) return
          const stalled = (performance.now() - stalledAt) / 1000
          stalledAt = null
          if (
            mode === "adaptativo" &&
            stalled >= DELIVERY_STALL_MIN &&
            stalled <= DELIVERY_STALL_MAX
          )
            keepMargin = true
        })
        // Retroceder y avanzar unos segundos dentro de la lista (abarca ~100 s), sin pasar del objetivo del modo. Lo
        // retrocedido se conserva, como el margen de una pausa: sin acelerar y sin que hls.js salte al directo (solo si
        // se sale de la lista y se queda sin datos), hasta volver a él.
        let back = false
        const setBack = (on: boolean): void => {
          back = on
          player.config.liveMaxLatencyDuration = on ? Number.POSITIVE_INFINITY : maxLatency
          visit.owner.setRewound(on)
        }
        visit.owner.seeker.current = (seconds, orStart) => {
          const details = player.latestLevelDetails
          const targetLatency = player.targetLatency
          if (details === null || targetLatency === null || video.readyState === 0) return null
          // El objetivo, a mano: liveSyncPosition no se acerca al final más que TARGETDURATION (13 s con relleno), como
          // al arrancar (LEVEL_LOADED).
          const live = details.edge + details.age - targetLatency
          const floor = details.fragmentStart + SEEK_FLOOR_SEGMENTS * (info.segmentDuration ?? 2)
          let to = Math.min(video.currentTime + seconds, live)
          // Más atrás que el principio de la lista, solo hasta él, y sin adelantar: con la lista aún corta (al abrir el
          // canal), ese principio puede quedar por delante de lo que se ve.
          if (to < floor && to < video.currentTime) {
            if (!orStart) return null
            to = Math.min(floor, video.currentTime)
          }
          // Al fotograma clave más cercano en ← →, sin pasar del objetivo ni bajar del suelo. Fin («Ir al directo») y lo que
          // llega al objetivo, exactos: un fotograma clave antes sería retraso de más.
          if (Number.isFinite(seconds) && to < live - SEEK_SNAP_S) {
            const exact = to
            let nearest: number | null = null
            for (const fragment of details.fragments) {
              const key = (fragment.startPTS ?? fragment.start) + SEEK_SNAP_AFTER_S
              const fits =
                Math.abs(key - exact) <= SEEK_SNAP_S && key <= live && key >= Math.min(floor, exact)
              if (fits && (nearest === null || Math.abs(key - exact) < Math.abs(nearest - exact)))
                nearest = key
            }
            if (nearest !== null) to = nearest
          }
          const moved = to - video.currentTime
          setBack(to < live - 1)
          video.currentTime = to
          return moved
        }
        catchup = setInterval(() => {
          const playing = player.playingDate
          visit.owner.latency.current =
            playing === null ? null : (Date.now() - playing.getTime()) / 1000
          const target = player.targetLatency
          if (target === null || video.paused || video.readyState < 3) return
          const extra = player.latency - target
          if (!Number.isFinite(extra)) return
          if (pausedFor > 0) {
            if (pausedFor > 1 && extra > 1 && canGoLive && mode !== "directo") setBack(true)
            pausedFor = 0
          }
          if (back) {
            // De vuelta en el objetivo: avanzando, o porque hls.js ha saltado al directo.
            if (extra > 1) return
            setBack(false)
          }
          if (extra <= 1) return
          if (keepMargin) {
            // hls.js tampoco debe intentar recuperarlo. Por encima del tope no se conserva: si el retraso pasa de
            // liveMaxLatencyDuration, hls.js salta adelante hasta el tope.
            player.targetLatency = Math.min(player.latency, maxLatency - KEEP_BELOW_MAX)
            return
          }
          // Lo que sobra de margen (una parada; al empezar, la primera lista puede llegar hasta un fragmento atrasada
          // respecto a Twitch, y no se nota hasta la siguiente) se salta en vez de recuperarlo acelerando. A 1,05× se
          // descartan fotogramas (60 fps a 1,05× piden 63 por segundo) y, en Firefox y Zen, el sonido se queda atrás con
          // cada cambio de velocidad y ya no vuelve: 2,9 s tras 5 min alternando 1,05× y 1× (29 oct; en Chrome, no).
          // Solo con la lista al día: si se ha quedado parada (una pausa global, Twitch se retrasa), el retraso
          // también crece, pero no es margen que sobre, y saltar solo adelantaría la parada.
          const fresh = (player.latestLevelDetails?.age ?? 0) < 1.5 * (info.segmentDuration ?? 2)
          if (!fresh) return
          const end = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0
          const to = Math.min(video.currentTime + extra, end - 1)
          if (to > video.currentTime + 0.5) video.currentTime = to
        }, 1000)
      })
      .catch(() => {
        if (active) visit.owner.patch({ phase: "error", playing: false })
      })

    return leave(visit)
  }, [
    attempt,
    canGoLive,
    channel,
    container,
    enabled,
    hueco,
    inCell,
    mode,
    patch,
    platformHls,
    quality,
  ])

  // Al volver a ser visible (tras apagarse la pantalla), sigue salvo que la persona hubiera pausado.
  useEffect(() => {
    if (!enabled) return undefined
    const onVisibility = (): void => {
      const video = videoRef.current
      if (document.visibilityState !== "visible" || video === undefined || userPaused.current)
        return
      if (video.paused) void video.play().catch(() => undefined)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [enabled])

  const play = useCallback(() => {
    userPaused.current = false
    const video = videoRef.current
    if (video === undefined) return
    video
      .play()
      .then(() => patch({ blocked: false }))
      .catch(() => undefined)
  }, [patch])
  const pause = useCallback(() => {
    userPaused.current = true
    videoRef.current?.pause()
  }, [])
  const toggle = useCallback(() => {
    if (videoRef.current?.paused === true) play()
    else pause()
  }, [pause, play])
  const toggleMuted = useCallback(() => {
    const video = videoRef.current
    if (video === undefined) return
    video.muted = !video.muted
    chooseVolume(video)
    patch({ muted: video.muted })
  }, [patch])
  const setMuted = useCallback(
    (muted: boolean) => {
      const video = videoRef.current
      if (video === undefined || video.muted === muted) return
      video.muted = muted
      patch({ muted })
    },
    [patch],
  )
  // El sonido que le toca a una celda de la cuadrícula, sin guardarlo como elección de la persona.
  const applySound = useCallback(
    (sound: Volume) => {
      const video = videoRef.current
      if (video === undefined) return
      video.volume = sound.volume
      video.muted = sound.muted
      patch({ muted: sound.muted })
    },
    [patch],
  )
  // Volumen de 0 a 1 (la tele no lo usa: el del sistema). Subirlo quita el silencio.
  const setVolume = useCallback(
    (volume: number) => {
      const video = videoRef.current
      if (video === undefined) return
      video.volume = Math.min(1, Math.max(0, volume))
      if (volume > 0 && video.muted) video.muted = false
      chooseVolume(video)
      patch({ muted: video.muted })
    },
    [patch],
  )
  // Otra calidad = otro empalme en el proceso principal; el reproductor se recrea con ella. null: automática.
  const setQuality = useCallback((next: string | null) => {
    chooseQuality(next)
    setQualityState(next)
  }, [])
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  // Imagen en imagen (el navegador saca el vídeo a una ventana pequeña), donde el navegador lo admite. El vídeo es el
  // mismo: no cuesta nada mientras no se usa. Al cambiar de canal o retroceder al VOD hay otro <video>, y se cierra.
  const togglePictureInPicture = useCallback(() => {
    const video = videoRef.current
    if (video === undefined) return
    if (document.pictureInPictureElement === video)
      void document.exitPictureInPicture().catch(() => undefined)
    else void video.requestPictureInPicture?.().catch(() => undefined)
  }, [])
  const syncIntent = useCallback(() => undefined, [])
  // Mueve la imagen «seconds» dentro de la lista del directo; hacia delante, como mucho hasta el objetivo del modo.
  // Devuelve lo que se ha movido (s), o null si no llega tan atrás: no se mueve, salvo con orStart, que la deja al
  // principio de la lista.
  const seekBy = useCallback(
    (seconds: number, orStart = false): number | null => seeker.current?.(seconds, orStart) ?? null,
    [],
  )

  return {
    applySound,
    // La calidad elegida (null: automática); la que suena está en state.quality.
    chosenQuality: quality,
    latency,
    pause,
    play,
    retry,
    pictureInPicture,
    rewound,
    seekBy,
    setMuted,
    setQuality,
    setVolume,
    state,
    syncIntent,
    toggle,
    toggleMuted,
    togglePictureInPicture,
  }
}
