import type { VideoDetail } from "@goodttv/contratos"
import {
  chooseVolume,
  chosenVolume,
  resumeAt,
  saveVodProgress,
  vodPlayback,
  vodProgress,
} from "@goodttv/interfaz"
import Hls, { FetchLoader } from "hls.js"
import { type RefObject, useCallback, useEffect, useRef, useState } from "react"

// El reproductor de un VOD (VOD-1): hls.js sobre la lista maestra de usher, que no lleva anuncios. Para que arranque y
// salte rápido:
//   - empieza en la calidad que aguantó la conexión la última vez, no en la más baja (abrEwmaDefaultEstimate);
//   - carga progresiva (como el directo, solo en MPEG-TS): cada trozo de 10 s, ~8 MB a 1080p60, se ve mientras llega;
//   - por delante, como mucho 60 s (un VOD no se queda sin datos como un directo), y por detrás, 30.
// Reanuda donde se dejó (vod-progress.ts) y guarda por dónde va cada 5 s, al pausar, al saltar y al ocultarse.

const SAVE_MS = 5000
// Para empezar en buena calidad: el ancho de banda medido la última vez (localStorage) o, la primera, uno que da
// 1080p60 (~8 Mbit/s). Si la conexión no llega, hls.js baja tras el primer trozo.
const BANDWIDTH_KEY = "vod-ancho-de-banda"
const FIRST_ESTIMATE_BPS = 20_000_000
const startEstimate = (): number => {
  const saved = Number(globalThis.localStorage?.getItem(BANDWIDTH_KEY))
  return Number.isFinite(saved) && saved > 1_000_000 ? saved : FIRST_ESTIMATE_BPS
}

// El nivel del VOD que corresponde a una calidad del directo («1280x720@60»): la misma, o la de la misma altura, o la
// mejor que no pase de ella. -1 si no hay ninguna.
export const levelFor = (
  levels: readonly {
    readonly bitrate: number
    readonly frameRate: number
    readonly height: number
  }[],
  quality: string,
): number => {
  const [resolution = "", fps = ""] = quality.split("@")
  const height = Number(resolution.split("x")[1])
  if (!Number.isFinite(height)) return -1
  const best = (fits: (level: (typeof levels)[number]) => boolean): number => {
    let found = -1
    levels.forEach((level, index) => {
      if (
        level.height > 0 &&
        fits(level) &&
        (found < 0 || level.bitrate > (levels[found]?.bitrate ?? 0))
      )
        found = index
    })
    return found
  }
  const exact = best(
    (level) => level.height === height && Math.round(level.frameRate) === Number(fps),
  )
  if (exact >= 0) return exact
  const same = best((level) => level.height === height)
  return same >= 0 ? same : best((level) => level.height <= height)
}

export type VodPhase = "loading" | "ready" | "error" | "unavailable"

export type VodState = {
  readonly phase: VodPhase
  readonly playing: boolean
  readonly muted: boolean
  readonly time: number // s
  readonly duration: number // s
  readonly buffered: number // hasta dónde hay datos, s
  readonly rate: number
  readonly qualities: readonly { readonly index: number; readonly label: string }[]
  readonly quality: number // -1: automática
  readonly playingLevel: number // la que suena
  readonly resumedFrom: number | null // s, si se reanudó donde se dejó
}

const INITIAL: VodState = {
  buffered: 0,
  duration: 0,
  muted: false,
  phase: "loading",
  playing: false,
  playingLevel: -1,
  quality: -1,
  qualities: [],
  rate: 1,
  resumedFrom: null,
  time: 0,
}

export const useVodPlayer = (
  container: RefObject<HTMLElement | null>,
  video: VideoDetail | null,
  // Para saltar a un segundo al abrir (desde otra parte de la interfaz); si no, donde se dejó.
  startOverride: number | null = null,
  // false: no guarda por dónde va (al retroceder un directo, DVR-1: no es un vídeo a medias).
  track = true,
  // La calidad elegida en el directo del que se viene al retroceder («1280x720@60»; null: automática): el VOD empieza
  // en ella y se queda, como si se eligiera en su menú. Quien bajó la calidad del directo no la vuelve a ver en 1080p.
  liveQuality: string | null = null,
) => {
  const [state, setState] = useState<VodState>(INITIAL)
  const element = useRef<HTMLVideoElement | null>(null)
  const hls = useRef<Hls | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [pictureInPicture, setPictureInPicture] = useState(false)
  const patch = useCallback((next: Partial<VodState>) => {
    setState((current) => ({ ...current, ...next }))
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: «attempt» (Reintentar) vuelve a crear el reproductor.
  useEffect(() => {
    const host = container.current
    if (host === null || video === null) return undefined
    let active = true
    const saved = vodProgress(video.id)
    const start = startOverride ?? resumeAt(saved)
    // Como el anterior (otro vídeo, un reintento) o, el primero, con lo que eligió la persona en otra pantalla: el
    // directo del que se viene al retroceder, por ejemplo.
    const sound = element.current ?? chosenVolume()
    setState({
      ...INITIAL,
      duration: video.seconds,
      muted: sound.muted,
      resumedFrom: startOverride === null && start > 0 ? start : null,
      time: start,
    })
    const media = document.createElement("video")
    media.className = "player__media"
    media.autoplay = true
    media.playsInline = true
    media.muted = sound.muted
    media.volume = sound.volume
    media.playbackRate = element.current?.playbackRate ?? 1
    element.current = media
    host.replaceChildren(media)

    // Solo si ha cambiado desde lo último que guardó esta pestaña: una pestaña pausada que se cierra no debe pisar lo
    // que otra ha avanzado con el mismo vídeo.
    let lastSaved = Number.NaN
    const save = (): void => {
      if (!track || media.readyState === 0 || Math.abs(media.currentTime - lastSaved) < 1) return
      lastSaved = media.currentTime
      saveVodProgress(video, media.currentTime)
    }
    const saver = setInterval(() => {
      if (!media.paused) save()
    }, SAVE_MS)
    const onHidden = (): void => {
      if (document.visibilityState === "hidden") save()
    }
    document.addEventListener("visibilitychange", onHidden)
    addEventListener("pagehide", save)
    media.addEventListener("pause", () => {
      save()
      if (active) patch({ playing: false })
    })
    media.addEventListener("seeked", save)
    media.addEventListener("playing", () => active && patch({ phase: "ready", playing: true }))
    media.addEventListener("ended", () => {
      save()
      if (active) patch({ playing: false })
    })
    media.addEventListener("volumechange", () => active && patch({ muted: media.muted }))
    setPictureInPicture(false) // un <video> nuevo
    media.addEventListener("enterpictureinpicture", () => active && setPictureInPicture(true))
    media.addEventListener("leavepictureinpicture", () => active && setPictureInPicture(false))
    media.addEventListener("ratechange", () => active && patch({ rate: media.playbackRate }))
    media.addEventListener("timeupdate", () => {
      if (!active) return
      const ranges = media.buffered
      let buffered = media.currentTime
      for (let index = 0; index < ranges.length; index++) {
        if (ranges.start(index) <= media.currentTime + 0.5)
          buffered = Math.max(buffered, ranges.end(index))
      }
      patch({ buffered, time: media.currentTime })
    })
    media.addEventListener("durationchange", () => {
      if (active && Number.isFinite(media.duration)) patch({ duration: media.duration })
    })

    let player: Hls | undefined
    vodPlayback(video.id)
      .then((url) => {
        if (!active) return
        player = new Hls({
          abrEwmaDefaultEstimate: startEstimate(),
          backBufferLength: 30,
          // Sin subtítulos ni metadatos: hls.js crearía pistas data: que la CSP bloquea.
          enableCEA708Captions: false,
          enableDateRangeMetadataCues: false,
          enableEmsgMetadataCues: false,
          enableID3MetadataCues: false,
          enableWebVTT: false,
          // Twitch no sirve los trozos «-unmuted» del VOD: la versión silenciada, como en el relleno (twitch-source.ts).
          fetchSetup: (context, init) =>
            new Request(context.url.replace(/-unmuted\.ts(?=$|\?)/, "-muted.ts"), init),
          loader: FetchLoader,
          maxBufferLength: 60,
          maxMaxBufferLength: 60,
          progressive: true,
          renderTextTracksNatively: false,
          startFragPrefetch: true,
          startPosition: start,
        })
        hls.current = player
        player.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          if (!active) return
          // hls.js, por su cuenta, solo empieza en una calidad cuyo primer trozo (10 s en los VOD) baje en 4 s, y con
          // la carga progresiva se ve antes: se empieza en la mejor que cabe en lo medido (con margen), y luego el ABR.
          const budget = startEstimate() * 0.8
          let best = -1
          data.levels.forEach((level, index) => {
            const chosen = data.levels[best]
            if (
              level.height > 0 &&
              level.bitrate <= budget &&
              (chosen === undefined || level.bitrate > chosen.bitrate)
            )
              best = index
          })
          if (best >= 0 && player !== undefined) player.startLevel = best
          const chosen = liveQuality === null ? -1 : levelFor(data.levels, liveQuality)
          if (chosen >= 0 && player !== undefined) {
            // También como la de arranque: si no, hls.js pide antes la lista de la que empezaría por su cuenta.
            player.startLevel = chosen
            player.currentLevel = chosen
            patch({ quality: chosen })
          }
          patch({
            qualities: data.levels
              .map((level, index) => ({
                index,
                label: level.name || (level.height > 0 ? `${level.height}p` : "Audio"),
                height: level.height,
              }))
              .filter((level) => level.height > 0)
              .sort((a, b) => b.height - a.height)
              .map(({ index, label }) => ({ index, label })),
          })
          media.play().catch(() => undefined)
        })
        // fMP4 (los canales con Enhanced Broadcasting): sin carga progresiva, como en el directo (useHlsPlayer). Se decide
        // antes del primer trozo: LEVEL_UPDATED lo da hls.js al recibir la lista y antes de pedirlo; en LEVEL_LOADED ya
        // lo había pedido con la carga progresiva. El primero no llegaba a verse, el segundo fallaba y hls.js volvía a
        // empezar, a veces en peor calidad (en 720p o 360p, en ~2 s en vez de ~0,6).
        player.once(Hls.Events.LEVEL_UPDATED, (_event, data) => {
          if (
            player !== undefined &&
            data.details.fragments.some((fragment) => fragment.initSegment !== null)
          ) {
            player.config.progressive = false
          }
        })
        player.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          if (active) patch({ playingLevel: data.level })
        })
        player.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || !active) return
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            player?.recoverMediaError()
            return
          }
          // usher contesta 403 a los VOD solo para suscriptores.
          const forbidden = data.response?.code === 403
          patch({ phase: forbidden ? "unavailable" : "error", playing: false })
        })
        player.attachMedia(media)
        player.loadSource(url)
      })
      .catch(() => {
        if (active) patch({ phase: "error" })
      })

    return () => {
      active = false
      save()
      clearInterval(saver)
      document.removeEventListener("visibilitychange", onHidden)
      removeEventListener("pagehide", save)
      const measured = player?.bandwidthEstimate
      if (measured !== undefined && Number.isFinite(measured) && measured > 0) {
        globalThis.localStorage?.setItem(BANDWIDTH_KEY, String(Math.round(measured)))
      }
      player?.destroy()
      hls.current = null
      media.pause()
      media.removeAttribute("src")
      media.load()
      host.replaceChildren()
    }
  }, [attempt, container, liveQuality, patch, startOverride, track, video])

  const play = useCallback(() => {
    element.current?.play().catch(() => undefined)
  }, [])
  const pause = useCallback(() => element.current?.pause(), [])
  const toggle = useCallback(() => {
    if (element.current?.paused === true) play()
    else pause()
  }, [pause, play])
  const seek = useCallback(
    (to: number) => {
      const media = element.current
      if (media === null) return
      const end = Number.isFinite(media.duration) ? media.duration : state.duration
      media.currentTime = Math.min(Math.max(0, to), Math.max(0, end - 0.5))
      patch({ time: media.currentTime })
    },
    [patch, state.duration],
  )
  const skip = useCallback(
    (seconds: number) => seek((element.current?.currentTime ?? 0) + seconds),
    [seek],
  )
  const setRate = useCallback((rate: number) => {
    const media = element.current
    if (media !== null) media.playbackRate = rate
  }, [])
  const setQuality = useCallback(
    (index: number) => {
      const player = hls.current
      if (player === null) return
      // currentLevel cambia ya, vaciando lo que hay por delante; nextLevel esperaría al siguiente trozo (10 s).
      player.currentLevel = index
      patch({ quality: index })
    },
    [patch],
  )
  const toggleMuted = useCallback(() => {
    const media = element.current
    if (media === null) return
    media.muted = !media.muted
    chooseVolume(media)
  }, [])
  const setMuted = useCallback((muted: boolean) => {
    const media = element.current
    if (media !== null) media.muted = muted
  }, [])
  const setVolume = useCallback((volume: number) => {
    const media = element.current
    if (media === null) return
    media.volume = Math.min(1, Math.max(0, volume))
    if (volume > 0) media.muted = false
    chooseVolume(media)
  }, [])
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  // Imagen en imagen, como en el directo (useHlsPlayer).
  const togglePictureInPicture = useCallback(() => {
    const media = element.current
    if (media === null) return
    if (document.pictureInPictureElement === media)
      void document.exitPictureInPicture().catch(() => undefined)
    else void media.requestPictureInPicture?.().catch(() => undefined)
  }, [])

  return {
    pause,
    play,
    retry,
    seek,
    setQuality,
    setMuted,
    setRate,
    setVolume,
    skip,
    state,
    toggle,
    toggleMuted,
    togglePictureInPicture,
    pictureInPicture,
  }
}
