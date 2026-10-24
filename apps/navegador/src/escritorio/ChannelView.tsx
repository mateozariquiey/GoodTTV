import type { LiveArchive, Preferences, PreferencesPatch } from "@goodttv/contratos"
import {
  type Channel,
  chosenVolume,
  formatClock,
  formatUptime,
  formatViewers,
  fromSearch,
  fromStream,
  prefetchVod,
  prewarmStream,
  renewVod,
  TWITCH_VIEWER_LATENCY,
  toRecent,
  useBehind,
  useChat,
  useHlsPlayer,
  useWatchTime,
  VOD_WARM_MS,
} from "@goodttv/interfaz"
import {
  ArrowSquareOutIcon,
  ArrowsInLineHorizontalIcon,
  ArrowsOutLineHorizontalIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChatTextIcon,
  CornersInIcon,
  CornersOutIcon,
  HeartIcon,
  PauseIcon,
  PlayIcon,
  SpeakerHighIcon,
  SpeakerSimpleXIcon,
  UserIcon,
} from "@phosphor-icons/react"
import { type CSSProperties, memo, useCallback, useEffect, useRef, useState } from "react"
import { Avatar } from "./Avatar"
import { ChatPanel, type ChatWriting } from "./ChatPanel"
import { useFullscreen } from "./fullscreen"
import { PictureInPictureButton } from "./PictureInPictureButton"
import { navigate } from "./routes"
import { SeekBar } from "./SeekBar"
import { SKIP_S, SkipButton } from "./SkipButton"
import { contextOf, shortcutFor } from "./shortcuts"
import { useSoleSound } from "./sonido"
import { ChannelVideos } from "./Videos"

// Un canal: el vídeo manda. Los controles salen al mover el ratón sobre él y se ocultan solos, con el cursor, mientras
// se reproduce. Debajo, la ficha del canal; al lado, el chat de solo lectura, retrasado como la imagen.

const IDLE_MS = 3000
const DOUBLE_CLICK_MS = 220
const UNDO_CLICK_MS = 600 // más que el doble clic más lento habitual del sistema
const WARM_PING_MS = 20_000 // en espera, mantiene caliente el empalme (el directo lo para a los 30 s sin uso)
// DVR-1: retroceder menos que esto no lleva al VOD (que va unos segundos por detrás del directo); reanudar tras una
// pausa más larga sigue donde se pausó, en el VOD, en vez de saltar al directo.
const DVR_MIN_BACK_S = 15
const DVR_PAUSE_MS = 60_000

type Props = {
  readonly canChat: boolean // la cuenta tiene permiso para escribir en el chat
  readonly channel: Channel
  readonly lineup: readonly Channel[]
  readonly onOpen: (channel: Channel) => void
  readonly onPreferences: (patch: PreferencesPatch) => void
  readonly onTheater: (on: boolean) => void
  readonly preferences: Preferences
  readonly preferencesLoaded: boolean // hasta leer el modo guardado, el reproductor espera
  readonly signedIn: boolean
  readonly theater: boolean
}

export const ChannelView = ({
  canChat,
  channel,
  lineup,
  onOpen,
  onPreferences,
  onTheater,
  preferences,
  preferencesLoaded,
  signedIn,
  theater,
}: Props) => {
  // A pantalla completa va la vista: solo el vídeo o, en modo teatro, también el chat (desktop.css).
  const view = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  // Con varias pestañas, suena una sola (sonido.ts): las demás se silencian y, ocultas un rato, se paran.
  const [stoppable, setStoppable] = useState(true)
  const sole = useSoleSound(channel.login, stoppable)
  const player = useHlsPlayer(
    surface,
    channel.login,
    preferencesLoaded && sole.standby !== "parado",
    preferences.latencyMode,
  )
  const { latency, state } = player
  // Los minutos que suena (en la pestaña que suena), para ordenar tus seguidos por los que más ves.
  useWatchTime(channel.login, state.playing && sole.standby === "no")
  // Pausado por la persona: al esperar no se para, y al volver no arranca solo.
  useEffect(
    () => setStoppable(!(state.phase === "ready" && !state.playing)),
    [state.phase, state.playing],
  )
  // En silencio sin tocar lo que eligió la persona: al volver a sonar, como estaba.
  const { setMuted } = player
  const mutedNow = useRef(state.muted)
  mutedNow.current = state.muted
  const mutedBefore = useRef<boolean | null>(null)
  useEffect(() => {
    if (sole.standby === "silencio") {
      mutedBefore.current ??= mutedNow.current
      setMuted(true)
    } else if (mutedBefore.current !== null) {
      setMuted(mutedBefore.current)
      mutedBefore.current = null
    }
  }, [setMuted, sole.standby])
  // Parada, el empalme sigue caliente un rato: volver tarda lo de un canal precalentado.
  const { latencyMode } = preferences
  useEffect(() => {
    if (sole.standby !== "parado" || !sole.warm || !preferencesLoaded) return undefined
    const ping = (): void => prewarmStream(channel.login, latencyMode)
    ping()
    const timer = setInterval(ping, WARM_PING_MS)
    return () => clearInterval(timer)
  }, [channel.login, latencyMode, preferencesLoaded, sole.standby, sole.warm])
  // Tocar el reproductor de una pestaña en silencio (otra ventana a la vista) la hace sonar. Con el silencio o el
  // volumen (choosing), lo que haga la persona manda: no se vuelve a como estaba antes de silenciarla.
  const { claim, standby } = sole
  const takeSound = useCallback(
    (choosing = false) => {
      if (standby === "no") return
      if (choosing) mutedBefore.current = null
      claim()
    },
    [claim, standby],
  )

  // DVR-1: la emisión en curso y el VOD que la graba. Con él, la barra va desde que empezó la emisión: retroceder lleva
  // a ese VOD en el momento elegido, con «Ir al directo» para volver. Sin VOD público, no se puede retroceder.
  const [archive, setArchive] = useState<LiveArchive | null>(null)
  const onAir = state.phase === "ready"
  useEffect(() => {
    setArchive(null)
    const vods = window.api.vods
    if (!onAir || vods === undefined) return undefined
    let active = true
    vods
      .archive(channel.login)
      .then((value) => {
        if (active) setArchive(value)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [channel.login, onAir])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = archive?.archiveId
    if (id == null) return undefined
    // Retroceder no espera a pedir su lista ni sus datos. Valen 5 min (vod-cache.ts): mientras se ve, se renuevan.
    prefetchVod(id)
    const warm = setInterval(() => renewVod(id), VOD_WARM_MS)
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(warm)
      clearInterval(timer)
    }
  }, [archive])
  // Un momento de la emisión (ms, en hora real) en el VOD: su segundo, contando desde que empezó a grabarse.
  const openRewind = useCallback(
    (wallMs: number) => {
      const archiveId = archive?.archiveId
      if (archiveId == null) return
      const origin = Date.parse(archive?.recordedAt ?? archive?.startedAt ?? "")
      if (!Number.isFinite(origin)) return
      navigate({
        at: Math.max(0, (wallMs - origin) / 1000),
        id: archiveId,
        live: channel.login,
        view: "vod",
      })
    },
    [archive, channel.login],
  )
  // Lo que se ve, en hora real (ms): ahora, menos la latencia.
  const shownAt = useCallback((): number => Date.now() - (latency.current ?? 0) * 1000, [latency])
  // Pausar es retroceder: al reanudar tras más de un minuto, sigue donde se pausó, en el VOD. Lo que se veía se guarda
  // al pausar: en una pausa larga, hls.js puede saltar adelante sin reproducir (liveMaxLatencyDuration), y la latencia
  // de después ya no lo dice.
  const pausedAt = useRef<{ readonly at: number; readonly shown: number } | null>(null)
  useEffect(() => {
    if (state.playing) pausedAt.current = null
    else if (onAir) pausedAt.current ??= { at: Date.now(), shown: shownAt() }
  }, [onAir, shownAt, state.playing])
  // ← → y los botones: dentro de la lista del directo (~100 s), al momento; más atrás, en el VOD de la emisión. Sin
  // él, hasta el principio de la lista.
  const { play, seekBy } = player
  const canRewind = archive?.archiveId != null
  // Moverse en pausa mueve también lo que se veía al pausar: al reanudar tras más de un minuto, el VOD abre donde se
  // dejó la imagen, no donde se pausó.
  const seekPaused = useCallback(
    (seconds: number, orStart = false): boolean => {
      const moved = seekBy(seconds, orStart)
      if (moved === null) return false
      const paused = pausedAt.current
      if (paused !== null) pausedAt.current = { ...paused, shown: paused.shown + moved * 1000 }
      return true
    },
    [seekBy],
  )
  const skip = useCallback(
    (seconds: number) => {
      if (seekPaused(seconds, !canRewind) || seconds > 0 || state.phase !== "ready") return
      openRewind(shownAt() + seconds * 1000)
    },
    [canRewind, openRewind, seekPaused, shownAt, state.phase],
  )
  // «Ir al directo» sigue en el directo, también en pausa (como en Android): si no, la pausa de antes seguía contando y,
  // pasado un minuto, reproducir abría el VOD donde se pausó.
  const goLive = useCallback(() => {
    seekBy(Number.POSITIVE_INFINITY)
    pausedAt.current = null
    play()
  }, [play, seekBy])

  // Abierto por su nombre (la dirección, o el atajo de la búsqueda): se completan su nombre, su foto y su id (que el
  // chat necesita también sin directo) sin cuenta, y con cuenta, los datos del directo (cuánto lleva).
  const [details, setDetails] = useState(channel)
  useEffect(() => {
    setDetails(channel)
    // Con su id, ya se sabe todo, salvo que su nombre sea solo el login: un reciente guardado mientras llegaban sus datos
    // (antes podía quedarse así), que se corrige.
    if (channel.userId !== undefined && channel.displayName !== channel.login) return undefined
    let active = true
    window.api.catalog
      .channel?.(channel.login)
      .then((card) => {
        // Lo del directo, si ha llegado antes, se queda.
        if (active && card !== null)
          setDetails((current) =>
            current.userId === undefined
              ? fromSearch(card)
              : {
                  ...current,
                  displayName:
                    current.displayName === current.login ? card.displayName : current.displayName,
                  profileImageUrl: current.profileImageUrl ?? card.thumbnailUrl,
                },
          )
      })
      .catch(() => undefined)
    if (signedIn)
      window.api.catalog
        .streamsByLogin([channel.login])
        .then(([stream]) => {
          if (active && stream !== undefined)
            setDetails((current) => {
              const live = fromStream(stream)
              const picture = live.profileImageUrl ?? current.profileImageUrl
              return picture === undefined ? live : { ...live, profileImageUrl: picture }
            })
        })
        .catch(() => undefined)
    return () => {
      active = false
    }
  }, [channel, signedIn])
  const latest = useRef(details)
  latest.current = details

  // SEG-1: si sigues el canal. Seguir y dejar de seguir, en twitch.tv (D24); al volver a esta pestaña se mira otra vez.
  const [following, setFollowing] = useState<boolean | null>(null)
  const broadcasterId = details.userId
  useEffect(() => {
    setFollowing(null)
    const follows = window.api.catalog.follows
    if (!signedIn || broadcasterId === undefined || follows === undefined) return undefined
    let active = true
    const check = (): void => {
      follows(broadcasterId)
        .then((value) => {
          if (active) setFollowing(value)
        })
        .catch(() => undefined)
    }
    check()
    const onVisible = (): void => {
      if (document.visibilityState === "visible") check()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      active = false
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [broadcasterId, signedIn])
  // A recientes al abrirlo, y otra vez cuando se completan sus datos (con su nombre, su foto e id).
  const recentKey = `${details.login}|${details.userId ?? ""}|${details.displayName}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: se guarda al cambiar recentKey, con los datos de ese momento.
  useEffect(() => {
    void window.api.recents.add(toRecent(latest.current))
  }, [recentKey])

  // Cuánto va por detrás de un espectador normal de Twitch; el chat se retrasa lo mismo.
  const behind = useBehind(latency)
  const phase = state.phase
  const chatDelay = useCallback((): number | null => {
    const seconds = latency.current
    if (seconds !== null) return Math.max(0, seconds - TWITCH_VIEWER_LATENCY)
    return phase === "loading" || phase === "ready" ? null : 0
  }, [latency, phase])

  // Controles a la vista: al mover el ratón, y siempre en pausa o con el menú de calidad abierto.
  const [awake, setAwake] = useState(true)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const wake = useCallback(() => {
    setAwake(true)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setAwake(false), IDLE_MS)
  }, [])
  useEffect(() => {
    wake()
    return () => clearTimeout(idleTimer.current)
  }, [wake])
  const [qualityOpen, setQualityOpen] = useState(false)
  const showControls = awake || !state.playing || qualityOpen

  const onWindowChat = useCallback(
    (on: boolean) => onPreferences({ chatVisible: on }),
    [onPreferences],
  )
  const { chatShown, fullscreen, toggleChat, toggleFullscreen } = useFullscreen(
    view,
    preferences.chatVisible,
    onWindowChat,
  )

  const [volume, setVolume] = useState(() => chosenVolume().volume)
  const { setVolume: applyVolume } = player
  const changeVolume = useCallback(
    (next: number) => {
      takeSound(true) // subir el volumen quita el silencio: esta pasa a sonar
      const value = Math.min(1, Math.max(0, next))
      setVolume(value)
      applyVolume(value)
    },
    [applyVolume, takeSound],
  )

  // Un clic pausa; dos, pantalla completa. El primero espera por si llega el segundo; si el doble clic del sistema es
  // más lento y el primero ya pausó, se deshace. Un clic pendiente no pasa a otro canal.
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const toggledAt = useRef(0)
  const { toggle: togglePlayback } = player
  const toggle = useCallback(() => {
    const paused = pausedAt.current
    if (paused !== null && Date.now() - paused.at > DVR_PAUSE_MS && canRewind)
      openRewind(paused.shown)
    else togglePlayback()
  }, [canRewind, openRewind, togglePlayback])
  const onSurfaceClick = (): void => {
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      toggledAt.current = performance.now()
      toggle()
    }, DOUBLE_CLICK_MS)
  }
  const onSurfaceDoubleClick = (): void => {
    clearTimeout(clickTimer.current)
    if (performance.now() - toggledAt.current < UNDO_CLICK_MS) toggle()
    toggleFullscreen()
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: al cambiar de canal (y al salir) se cancela el clic pendiente.
  useEffect(() => () => clearTimeout(clickTimer.current), [channel.login])

  const position = lineup.findIndex((each) => each.login === channel.login)
  const canStep = position >= 0 && lineup.length > 1
  const step = useCallback(
    (delta: number) => {
      if (!canStep) return
      const next = lineup[(position + delta + lineup.length) % lineup.length]
      if (next !== undefined) onOpen(next)
    },
    [canStep, lineup, onOpen, position],
  )

  const { toggleMuted } = player
  // Esc con el menú de calidad abierto solo lo cierra: en captura, antes que el Esc general de la ventana (Desktop).
  useEffect(() => {
    if (!qualityOpen) return undefined
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setQualityOpen(false)
    }
    addEventListener("keydown", onEscape, { capture: true })
    return () => removeEventListener("keydown", onEscape, { capture: true })
  }, [qualityOpen])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const shortcut = shortcutFor(event, contextOf(event.target))
      if (shortcut === "play-pause") takeSound()
      else if (shortcut === "mute") takeSound(true)
      if (shortcut === "play-pause") toggle()
      else if (shortcut === "mute") toggleMuted()
      else if (shortcut === "fullscreen") toggleFullscreen()
      // El modo teatro es de la ventana: a pantalla completa, T no hace nada.
      else if (shortcut === "theater" && !fullscreen) onTheater(!theater)
      else if (shortcut === "chat") toggleChat()
      else if (shortcut === "previous") step(-1)
      else if (shortcut === "next") step(1)
      else if (shortcut === "rewind") skip(-SKIP_S)
      else if (shortcut === "forward") skip(SKIP_S)
      else if (shortcut === "live") goLive()
      else return
      event.preventDefault()
      wake()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [
    fullscreen,
    goLive,
    onTheater,
    skip,
    step,
    takeSound,
    theater,
    toggle,
    toggleChat,
    toggleFullscreen,
    toggleMuted,
    wake,
  ])

  // La que suena; con la automática, «Auto (1080p60)», como en un VOD.
  const playingQuality = state.qualities.find((each) => each.id === state.quality)?.label
  const quality =
    player.chosenQuality === null
      ? `Auto${playingQuality === undefined ? "" : ` (${qualityLabel(playingQuality)})`}`
      : qualityLabel(playingQuality ?? "Auto")
  // La barra del directo (DVR-1): desde que empezó la emisión hasta ahora; lo que se ve, la latencia antes de ahora.
  const startedAtMs = Date.parse(archive?.startedAt ?? "")
  const dvr =
    archive?.archiveId == null || !Number.isFinite(startedAtMs) || phase !== "ready"
      ? null
      : {
          duration: Math.max(0, (now - startedAtMs) / 1000),
          position: Math.max(0, (now - startedAtMs) / 1000 - (latency.current ?? 0)),
          start: startedAtMs,
        }
  const muted = state.muted || volume === 0
  const live = phase === "ready"
  const twitchUrl = `https://www.twitch.tv/${channel.login}`

  return (
    <div className={`watch${chatShown ? " watch--chat" : ""}`} ref={view}>
      <div className="watch__main">
        <div
          className={`stage${showControls ? "" : " stage--idle"}${phase === "offline" ? " stage--offline" : ""}`}
          onPointerDownCapture={(event) =>
            // En el silencio o el volumen, lo que elija la persona; en lo demás, como estaba.
            takeSound(
              event.target instanceof Element && event.target.closest("[data-sonido]") !== null,
            )
          }
          onPointerLeave={() => setAwake(false)}
          onPointerMove={wake}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: clic y doble clic en el vídeo son atajos del ratón; con el teclado, Espacio y F. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: ídem. */}
          <div
            className="stage__surface"
            onClick={onSurfaceClick}
            onDoubleClick={onSurfaceDoubleClick}
            ref={surface}
          />
          <Notice
            channel={details}
            onPlay={player.play}
            onRetry={player.retry}
            phase={phase}
            blocked={state.blocked}
            twitchUrl={twitchUrl}
          />
          <div
            className={`controls${dvr === null ? "" : " controls--seek"}`}
            role="toolbar"
            aria-label="Controles del reproductor"
          >
            {dvr === null ? null : (
              <SeekBar
                buffered={dvr.duration}
                duration={dvr.duration}
                label={(at) =>
                  dvr.duration - at < DVR_MIN_BACK_S
                    ? "En directo"
                    : `−${formatClock(dvr.duration - at)}`
                }
                onSeek={(to) => {
                  // Dentro de la lista, sin salir del directo; hacia delante, como mucho hasta el directo.
                  if (seekPaused(to - dvr.position)) return
                  if (dvr.duration - to >= DVR_MIN_BACK_S) openRewind(dvr.start + to * 1000)
                }}
                storyboard={null}
                time={dvr.position}
              />
            )}
            <div className="controls__row">
              <div className="controls__group">
                <button
                  aria-label={state.playing ? "Pausa" : "Reproducir"}
                  className="icon-button icon-button--light"
                  onClick={toggle}
                  title={state.playing ? "Pausa (Espacio)" : "Reproducir (Espacio)"}
                  type="button"
                >
                  {state.playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />}
                </button>
                <SkipButton forward={false} onSkip={() => skip(-SKIP_S)} />
                <SkipButton disabled={!player.rewound} forward onSkip={() => skip(SKIP_S)} />
                <button
                  aria-label={muted ? "Quitar el silencio" : "Silenciar"}
                  className="icon-button icon-button--light"
                  data-sonido
                  onClick={muted && volume === 0 ? () => changeVolume(0.5) : toggleMuted}
                  title={muted ? "Quitar el silencio (M)" : "Silenciar (M)"}
                  type="button"
                >
                  {muted ? <SpeakerSimpleXIcon /> : <SpeakerHighIcon />}
                </button>
                <input
                  aria-label="Volumen"
                  className="volume"
                  data-sonido
                  max={1}
                  min={0}
                  onChange={(event) => changeVolume(Number(event.currentTarget.value))}
                  step={0.01}
                  style={{ "--level": `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
                  type="range"
                  value={muted ? 0 : volume}
                />
                {live && player.rewound ? (
                  <button
                    className="go-live"
                    onClick={goLive}
                    title="Volver al directo, con el retraso de tu modo (Fin)"
                    type="button"
                  >
                    <i aria-hidden="true" />
                    Ir al directo
                  </button>
                ) : live ? (
                  <span className="live">
                    <i aria-hidden="true" />
                    En directo
                  </span>
                ) : null}
                {live && behind !== null ? (
                  <span
                    className="behind"
                    title="Lo que va por detrás de lo que ve un espectador normal de Twitch: el precio de no ver anuncios. El modo se elige en Ajustes."
                  >
                    {behind} s por detrás
                  </span>
                ) : null}
              </div>
              <div className="controls__group">
                {canStep ? (
                  <>
                    <button
                      aria-label="Canal anterior"
                      className="icon-button icon-button--light"
                      onClick={() => step(-1)}
                      title="Canal anterior (↑)"
                      type="button"
                    >
                      <CaretLeftIcon />
                    </button>
                    <button
                      aria-label="Canal siguiente"
                      className="icon-button icon-button--light"
                      onClick={() => step(1)}
                      title="Canal siguiente (↓)"
                      type="button"
                    >
                      <CaretRightIcon />
                    </button>
                  </>
                ) : null}
                {state.qualities.length > 0 ? (
                  <div className="quality">
                    <button
                      aria-expanded={qualityOpen}
                      aria-haspopup="menu"
                      className="quality__button"
                      onClick={() => setQualityOpen((open) => !open)}
                      title="Calidad"
                      type="button"
                    >
                      {quality}
                    </button>
                    {qualityOpen ? (
                      <div className="quality__menu" role="menu">
                        {[{ id: null, label: "Auto" }, ...state.qualities].map((each) => (
                          <button
                            aria-checked={
                              each.id === null
                                ? player.chosenQuality === null
                                : player.chosenQuality !== null && each.id === state.quality
                            }
                            key={each.id ?? "auto"}
                            onClick={() => {
                              player.setQuality(each.id)
                              setQualityOpen(false)
                            }}
                            role="menuitemradio"
                            type="button"
                          >
                            {qualityLabel(each.label)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <button
                  aria-label={chatShown ? "Ocultar el chat" : "Mostrar el chat"}
                  aria-pressed={chatShown}
                  className="icon-button icon-button--light"
                  onClick={toggleChat}
                  title={chatShown ? "Ocultar el chat (C)" : "Mostrar el chat (C)"}
                  type="button"
                >
                  <ChatTextIcon />
                </button>
                <PictureInPictureButton
                  active={player.pictureInPicture}
                  onToggle={player.togglePictureInPicture}
                />
                {fullscreen ? null : (
                  <button
                    aria-label="Modo teatro"
                    aria-pressed={theater}
                    className="icon-button icon-button--light icon-button--toggle"
                    onClick={() => onTheater(!theater)}
                    title="Modo teatro (T): el vídeo y el chat ocupan la ventana"
                    type="button"
                  >
                    {theater ? <ArrowsInLineHorizontalIcon /> : <ArrowsOutLineHorizontalIcon />}
                  </button>
                )}
                <button
                  aria-label={fullscreen ? "Salir de la pantalla completa" : "Pantalla completa"}
                  className="icon-button icon-button--light"
                  onClick={toggleFullscreen}
                  title={fullscreen ? "Salir de la pantalla completa (F)" : "Pantalla completa (F)"}
                  type="button"
                >
                  {fullscreen ? <CornersInIcon /> : <CornersOutIcon />}
                </button>
              </div>
            </div>
          </div>
        </div>
        <section className="channel-info">
          <Avatar
            className={`avatar avatar--large${live ? " avatar--live" : ""}`}
            name={details.displayName}
            url={details.profileImageUrl}
          />
          <div className="channel-info__text">
            <h1>{details.displayName}</h1>
            {details.title === undefined ? null : (
              <p className="channel-info__title">{details.title}</p>
            )}
            {details.category === undefined || details.category === "" ? null : (
              <p className="channel-info__meta">{details.category}</p>
            )}
          </div>
          <div className="channel-info__stats">
            {details.viewerCount === undefined ? null : (
              <span className="stat stat--live" title="Espectadores">
                <UserIcon aria-hidden="true" />
                {formatViewers(details.viewerCount)}
              </span>
            )}
            {details.startedAt === undefined ? null : (
              <span className="stat" title="Tiempo en directo">
                {formatUptime(details.startedAt)}
              </span>
            )}
            {following === null ? null : (
              <a
                className={`follow${following ? " follow--on" : ""}`}
                href={twitchUrl}
                rel="noreferrer"
                target="_blank"
                title={
                  following
                    ? "Lo sigues. Para dejar de seguirlo, en twitch.tv"
                    : "Seguirlo en twitch.tv"
                }
              >
                <HeartIcon aria-hidden="true" weight={following ? "fill" : "regular"} />
                {following ? (
                  <>
                    <span className="follow__label">Siguiendo</span>
                    <span className="follow__hover">Dejar de seguir</span>
                  </>
                ) : (
                  "Seguir"
                )}
              </a>
            )}
            <a
              aria-label="Abrir en twitch.tv"
              className="icon-button"
              href={twitchUrl}
              rel="noreferrer"
              target="_blank"
              title="Abrir en twitch.tv"
            >
              <ArrowSquareOutIcon aria-hidden="true" />
            </a>
          </div>
        </section>
        {/* COL-2: debajo de la ficha, sus emisiones anteriores; si no está en directo, en su lugar. */}
        <ChannelVideos login={channel.login} offline={phase === "offline"} />
      </div>
      <ChannelChat
        broadcasterId={signedIn ? details.userId : undefined}
        canChat={canChat}
        connected={sole.visible}
        delay={chatDelay}
        scale={preferences.chatScale}
        signedIn={signedIn}
        visible={chatShown}
      />
    </div>
  )
}

// El chat, aparte del resto del canal: cada lote de mensajes (unas 10 veces por segundo en un chat con mucho movimiento)
// solo vuelve a pintar el chat, no los controles, la ficha ni los vídeos de debajo. Solo con la pestaña a la vista
// (connected): EventSub admite tres conexiones por cuenta, y hay más pestañas.
const ChannelChat = memo(
  ({
    broadcasterId,
    canChat,
    connected,
    delay,
    scale,
    signedIn,
    visible,
  }: {
    readonly broadcasterId: string | undefined
    readonly canChat: boolean
    readonly connected: boolean
    readonly delay: () => number | null
    readonly scale: Preferences["chatScale"]
    readonly signedIn: boolean
    readonly visible: boolean
  }) => {
    const chat = useChat(broadcasterId, visible, delay, connected)
    const writing: ChatWriting =
      !signedIn || chat.send === undefined ? "no" : canChat ? "si" : "vincular"
    return visible ? <ChatPanel chat={chat} scale={scale} writing={writing} /> : null
  },
)

// Twitch llama «1080p60 (source)» a la original: basta con «1080p60» (como en Android).
const qualityLabel = (label: string): string => label.replace(/\s*\(source\)$/i, "")

// Lo que tapa el vídeo cuando no hay nada que ver: cargando, sin directo, fallos y el arranque bloqueado.
const Notice = ({
  blocked,
  channel,
  onPlay,
  onRetry,
  phase,
  twitchUrl,
}: {
  readonly blocked: boolean
  readonly channel: Channel
  readonly onPlay: () => void
  readonly onRetry: () => void
  readonly phase: string
  readonly twitchUrl: string
}) => {
  if (phase === "loading") return <div aria-label="Cargando" className="spinner" role="status" />
  const body =
    phase === "offline" ? (
      <>
        <p>
          {channel.displayName} no está en directo ahora.
          {window.api.vods === undefined ? null : " Sus emisiones anteriores, debajo."}
        </p>
        <a className="button" href="#/">
          Volver a Inicio
        </a>
      </>
    ) : phase === "error" || phase === "stalled" ? (
      <>
        <p>
          {phase === "error"
            ? "No se pudo preparar el directo sin anuncios."
            : "Twitch no responde."}
        </p>
        <span className="stage__actions">
          <button className="button button--primary" onClick={onRetry} type="button">
            Reintentar
          </button>
          <a className="button" href={twitchUrl} rel="noreferrer" target="_blank">
            Abrir en twitch.tv
          </a>
        </span>
      </>
    ) : blocked ? (
      <>
        <p>El navegador no ha dejado empezar la reproducción.</p>
        <button className="button button--primary" onClick={onPlay} type="button">
          Reproducir
        </button>
      </>
    ) : null
  return body === null ? null : (
    <div className="stage__notice" role="alert">
      {body}
    </div>
  )
}
