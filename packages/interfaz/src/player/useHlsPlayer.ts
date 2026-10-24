import type { LatencyMode } from "@goodttv/contratos"
import Hls from "hls.js"
import { useCallback, useEffect, useRef, useState } from "react"
import { usePlatform } from "../platform"
import type { PlayerState } from "./useTwitchPlayer"
import { chooseVolume, chosenVolume } from "./volume"

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
// Al empezar a reproducir, durante este tiempo el margen que sobra se salta en vez de recuperarlo acelerando.
const STARTUP_MS = 10_000
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
// Sin carga progresiva (fMP4, ver LEVEL_LOADED), el último fragmento solo cuenta al llegar entero, como antes de D16:
// con 2,5 el búfer bajaba a ~0,05 s. En 5 canales fMP4 (21 oct), 2,5 dio 16 s de paradas en 4 de 10 visitas y 3,
// ninguna, con ~0,6 s más de retraso.
const FMP4_SYNC_SEGMENTS = 3
const CATCHUP_RATE = 1.05 // velocidad para recuperar el margen cuando el modo lo pide
const NO_STOP_TARGET = 24 // modo sin paradas: margen fijo (s) hasta el final de la lista, que cubre la espera del VOD
const LIVE_MAX_BEHIND = 4 // modo directo: más atrás que esto sobre el objetivo, hls.js salta al directo
const MAX_BEHIND = 60 // los otros modos: lo mismo, con margen para las pausas de la persona (la lista abarca 100 s)
// El margen conservado se queda al menos esto por debajo de liveMaxLatencyDuration. Con el objetivo por encima, cada
// lista nueva puede hacer que hls.js recoloque la posición, y con la lista larga apenas la movería: saltos repetidos.
const KEEP_BELOW_MAX = 10
// Si se empieza mientras se publican trozos del VOD (crece a saltos de ~10 s), margen (s) para no quedarse sin datos.
const VOD_START_TARGET = 16
// Al retroceder, fragmentos que se dejan hasta el principio de la lista: mientras se ve, la lista avanza a la par, y lo
// que sale de ella ya no se puede pedir.
const SEEK_FLOOR_SEGMENTS = 3

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
const streamQuery = (quality: string | null, mode: LatencyMode, visit: string): string => {
  const query = new URLSearchParams({ modo: mode, visita: visit })
  if (quality !== null) query.set("q", quality)
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
export const prewarmStream = (login: string, mode: LatencyMode): void => {
  const query = new URLSearchParams({ modo: mode })
  const quality = chosenLiveQuality()
  if (quality !== null) query.set("q", quality)
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
  signal: AbortSignal,
): Promise<StreamInfo> => {
  const response = await fetch(`/stream/${login}/info${streamQuery(quality, mode, visit)}`, {
    signal,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as StreamInfo
}

// mode: retraso del directo (Ajustes). latency (s): retraso de la imagen respecto a la hora real del fragmento que
// se ve; lo usa el chat para ir sincronizado.
export const useHlsPlayer = (
  container: React.RefObject<HTMLElement | null>,
  channel: string,
  enabled: boolean,
  mode: LatencyMode,
) => {
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

  // Una visita (o un reintento, o un cambio de calidad) = un <video> y un hls.js nuevos.
  useEffect(() => {
    const element = container.current
    if (!enabled || element === null) return undefined
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
      setState((current) =>
        current.phase === "loading" ? { ...current, phase: "stalled" } : current,
      )
    }, STALL_MS)
    userPaused.current = false
    void window.api.player.setWatching(true)
    const video = document.createElement("video")
    video.className = "player__media"
    video.dataset["attempt"] = String(attempt) // un reintento crea un <video> nuevo
    video.autoplay = true
    video.playsInline = true
    video.muted = sound.muted
    video.volume = sound.volume
    videoRef.current = video
    element.replaceChildren(video)
    let hls: Hls | undefined
    let catchup: ReturnType<typeof setInterval> | undefined

    const start = (): void => {
      if (!active) return
      video.play().catch((error: unknown) => {
        if (active && error instanceof DOMException && error.name === "NotAllowedError") {
          patch({ blocked: true, playing: false })
        }
      })
    }
    video.addEventListener(
      "playing",
      () => active && patch({ blocked: false, phase: "ready", playing: true }),
    )
    video.addEventListener("pause", () => active && patch({ playing: false }))
    video.addEventListener("volumechange", () => active && patch({ muted: video.muted }))
    video.addEventListener("enterpictureinpicture", () => active && setPictureInPicture(true))
    video.addEventListener("leavepictureinpicture", () => active && setPictureInPicture(false))

    latency.current = null
    const visit = crypto.randomUUID().replaceAll("-", "")
    readInfo(channel, quality, mode, visit, abort.signal)
      .then((info) => {
        if (!active) return
        if (info.offline) {
          patch({ phase: "offline", playing: false })
          return
        }
        patch({ qualities: info.qualities, quality: info.playing ?? info.quality ?? "auto" })
        const segmentTarget = SYNC_SEGMENTS * (info.segmentDuration ?? 2)
        const target =
          mode === "sin-paradas"
            ? Math.max(NO_STOP_TARGET, segmentTarget)
            : info.filling
              ? Math.max(VOD_START_TARGET, segmentTarget)
              : segmentTarget
        let maxLatency = target + (mode === "directo" ? LIVE_MAX_BEHIND : MAX_BEHIND)
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
          // se codifica, durante unos 2 s: sin esto el búfer solo crecía al completarse cada fragmento. Solo con
          // MPEG-TS (ver LEVEL_LOADED).
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
          // fMP4 (EXT-X-MAP; p. ej. los canales con Enhanced Broadcasting), sin carga progresiva: hls.js 1.7 sitúa cada
          // trozo que llega respecto al principio del fragmento y, a partir de 1 s, lo da por desfasado y lo pone
          // encima de lo anterior. Cada fragmento de 2 s ocupaba ~1,1 s: saltos y la imagen pegada al borde (15 oct,
          // illojuan). Se decide aquí, antes del primer fragmento: hls.js copia la configuración al crear el
          // transmuxer.
          let start = target
          if (data.details.fragments.some((frag) => frag.initSegment !== null)) {
            player.config.progressive = false
            const fmp4 = FMP4_SYNC_SEGMENTS * (info.segmentDuration ?? 2)
            if (fmp4 > start) {
              start = fmp4
              maxLatency = fmp4 + (mode === "directo" ? LIVE_MAX_BEHIND : MAX_BEHIND)
              player.config.liveSyncDuration = fmp4
              player.config.liveMaxLatencyDuration = maxLatency
              player.targetLatency = fmp4
            }
          }
          player.startLoad(Math.max(0, data.details.edge - start))
        })
        // Al arrancar no hay contenido que preservar: lo que sobre de margen se salta en vez de recuperarlo acelerando,
        // que descarta fotogramas (60 fps a 1,05× piden 63 por segundo). Puede sobrar al poco de empezar: la primera
        // lista puede llegar hasta un fragmento atrasada respecto a Twitch, y no se nota hasta la siguiente.
        let playingSince: number | null = null
        video.addEventListener("playing", () => {
          playingSince ??= performance.now()
        })
        // Una pausa (de la persona) cierra el arranque: el retraso que deja no es margen que sobre.
        let pausedOnce = false
        video.addEventListener("pause", () => {
          pausedOnce = true
        })
        player.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            // Al darlo por fatal, hls.js ya ha parado la carga, y recoverMediaError solo vuelve a conectar el <video>
            // (sin autoStartLoad no la reanuda): se reanuda aquí, donde iba.
            const time = video.currentTime
            player.recoverMediaError()
            player.startLoad(time > 0 ? time : -1)
          } else if (active) patch({ phase: "error", playing: false })
        })
        player.attachMedia(video) // primero: el MediaSource se abre mientras llega la lista
        player.loadSource(`/stream/${channel}/live.m3u8${streamQuery(info.quality, mode, visit)}`)
        // Margen según el modo (D11). Adaptativo: tras la primera pausa global del canal (llegan trozos del VOD) se
        // conserva el margen que deja el relleno en vez de recuperarlo acelerando, para que las siguientes no se
        // noten; antes, si se queda atrás, acelera un poco. Sin paradas: nunca acelera; el margen mínimo es fijo y lo
        // que se añada (una pausa de la persona) se conserva, hasta un tope, como en adaptativo tras el primer relleno. Directo:
        // acelera un poco si se queda atrás, y si se queda mucho hls.js salta (liveMaxLatencyDuration).
        let keepMargin = mode === "sin-paradas"
        player.on(Hls.Events.FRAG_LOADING, (_event, data) => {
          if (mode === "adaptativo" && data.frag.url.includes("/stream/vod")) keepMargin = true
        })
        // Retroceder y avanzar unos segundos dentro de la lista (abarca ~100 s), sin pasar del objetivo del modo. Lo
        // retrocedido se conserva, como el margen de una pausa: sin acelerar y sin que hls.js salte al directo (solo si
        // se sale de la lista y se queda sin datos), hasta volver a él.
        let back = false
        const setBack = (on: boolean): void => {
          back = on
          player.config.liveMaxLatencyDuration = on ? Number.POSITIVE_INFINITY : maxLatency
          setRewound(on)
        }
        seeker.current = (seconds, orStart) => {
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
          const moved = to - video.currentTime
          setBack(to < live - 1)
          video.playbackRate = 1
          video.currentTime = to
          return moved
        }
        catchup = setInterval(() => {
          const playing = player.playingDate
          latency.current = playing === null ? null : (Date.now() - playing.getTime()) / 1000
          const target = player.targetLatency
          if (target === null || video.paused || video.readyState < 3) return
          const extra = player.latency - target
          if (!Number.isFinite(extra)) return
          if (back) {
            // De vuelta en el objetivo: avanzando, o porque hls.js ha saltado al directo.
            if (extra > 1) return
            setBack(false)
          }
          const starting =
            !pausedOnce && playingSince !== null && performance.now() - playingSince < STARTUP_MS
          // Solo con la lista al día: si se ha quedado parada (una pausa global, Twitch se retrasa), el retraso
          // también crece, pero no es margen que sobre, y saltar solo adelantaría la parada.
          const fresh = (player.latestLevelDetails?.age ?? 0) < 1.5 * (info.segmentDuration ?? 2)
          if (starting && !keepMargin && fresh && extra > 1) {
            const end =
              video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0
            const to = Math.min(video.currentTime + extra, end - 1)
            if (to > video.currentTime + 0.5) video.currentTime = to
            return
          }
          if (keepMargin) {
            video.playbackRate = 1
            // hls.js tampoco debe intentar recuperarlo. Por encima del tope no se conserva: si el retraso pasa de
            // liveMaxLatencyDuration, hls.js salta adelante hasta el tope.
            if (extra > 1)
              player.targetLatency = Math.min(player.latency, maxLatency - KEEP_BELOW_MAX)
          } else if (extra > 1) video.playbackRate = CATCHUP_RATE
          else if (extra < 0.3) video.playbackRate = 1
        }, 1000)
      })
      .catch(() => {
        if (active) patch({ phase: "error", playing: false })
      })

    return () => {
      active = false
      abort.abort()
      clearTimeout(stall)
      if (catchup !== undefined) clearInterval(catchup)
      seeker.current = null
      hls?.destroy()
      video.pause()
      video.removeAttribute("src")
      video.load()
      element.replaceChildren()
      void window.api.player.setWatching(false)
    }
  }, [attempt, channel, container, enabled, mode, patch, platformHls, quality])

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
