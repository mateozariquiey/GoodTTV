import type { Preferences, PreferencesPatch } from "@goodttv/contratos"
import {
  archiveMoment,
  type Channel,
  chatDelayOf,
  formatClock,
  formatUptime,
  formatViewers,
  liveBar,
  prefetchVodMaster,
  t,
  useBehind,
  useChannelDetails,
  useChat,
  useFollowing,
  useHlsPlayer,
  useIdioma,
  useLiveArchive,
  useRecentChannel,
  useWatchTime,
} from "@goodttv/interfaz"
import {
  ArrowSquareOutIcon,
  CaretLeftIcon,
  CaretRightIcon,
  HeartIcon,
  PauseIcon,
  PlayIcon,
  SquaresFourIcon,
  UserIcon,
} from "@phosphor-icons/react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Avatar } from "./Avatar"
import { ChatPanel, type ChatWriting } from "./ChatPanel"
import { huecoOf } from "./cuadricula"
import { useFullscreen } from "./fullscreen"
import { PictureInPictureButton } from "./PictureInPictureButton"
import {
  ChatButton,
  ControlsMenu,
  FullscreenButton,
  TheaterButton,
  useControlsAwake,
  useSurfaceClicks,
  useVolume,
  VolumeControl,
} from "./PlayerControls"
import { navigate, routeHash } from "./routes"
import { SeekBar } from "./SeekBar"
import { SKIP_S, SkipButton } from "./SkipButton"
import { contextOf, shortcutFor } from "./shortcuts"
import { ChannelVideos } from "./Videos"
import { usePageSeen, usePageVisible } from "./visibilidad"

// Un canal: el vídeo manda. Los controles salen al mover el ratón sobre él y se ocultan solos, con el cursor, mientras
// se reproduce. Debajo, la ficha del canal; al lado, el chat de solo lectura, retrasado como la imagen.

// DVR-1: retroceder menos que esto no lleva al VOD (que va unos segundos por detrás del directo); reanudar tras una
// pausa más larga sigue donde se pausó, en el VOD, en vez de saltar al directo.
const DVR_MIN_BACK_S = 15
const DVR_PAUSE_MS = 60_000

type Props = {
  readonly canChat: boolean // la cuenta tiene permiso para escribir en el chat
  readonly channel: Channel
  readonly lineup: readonly Channel[]
  readonly onGrid?: (() => void) | undefined // con la cuadrícula activada (EXT-6), el botón para pasar a ella
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
  onGrid,
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
  // Cada pestaña suena por su cuenta (D48). Abierta sin verse, espera a que se mire (visibilidad.ts).
  const visible = usePageVisible()
  const seen = usePageSeen()
  const hueco = onGrid === undefined ? 0 : huecoOf(channel.login)
  const player = useHlsPlayer(
    surface,
    channel.login,
    preferencesLoaded && seen,
    preferences.latencyMode,
    true,
    // Con la cuadrícula activada (EXT-6), el vídeo puede seguir al pasar a ella.
    onGrid === undefined ? undefined : { hueco, inCell: false, silent: false },
  )
  const { latency, state } = player
  // Los minutos que suena, para ordenar tus seguidos por los que más ves.
  useWatchTime(channel.login, state.playing)

  // DVR-1: la emisión en curso y el VOD que la graba (live-archive.ts). Con él, la barra va desde que empezó la emisión:
  // retroceder lleva a ese VOD en el momento elegido, con «Ir al directo» para volver. Sin VOD público, no se puede
  // retroceder.
  const onAir = state.phase === "ready"
  const rewind = useLiveArchive(channel.login, onAir)
  const { archive } = rewind
  const archiveId = archive?.archiveId
  // Además de su lista y sus datos, la lista ya descargada: solo en la extensión, que se la da a hls.js (vod-cache.ts).
  useEffect(() => {
    if (archiveId != null) prefetchVodMaster(archiveId)
  }, [archiveId])
  // Un momento de la emisión (ms, en hora real), en el VOD.
  const openRewind = useCallback(
    (wallMs: number) => {
      const moment = archiveMoment(archive, wallMs)
      if (moment !== null) navigate({ ...moment, live: channel.login, view: "vod" })
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
  const canRewind = archiveId != null
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

  // Abierto por su nombre (la dirección, o el atajo de la búsqueda), se completan sus datos (channel-details.ts), y va a
  // recientes. SEG-1: si lo sigues; seguir y dejar de seguir, en twitch.tv (D24).
  const details = useChannelDetails(channel, signedIn)
  const following = useFollowing(details.userId, signedIn)
  useRecentChannel(details)

  // Cuánto va por detrás de un espectador normal de Twitch; el chat se retrasa lo mismo.
  const behind = useBehind(latency)
  const phase = state.phase
  const chatDelay = useCallback(
    () => chatDelayOf(latency.current, phase === "loading" || phase === "ready"),
    [latency, phase],
  )

  // Controles a la vista: al mover el ratón, y siempre en pausa o con el menú de calidad abierto (PlayerControls.tsx).
  const { awake, sleep, wake } = useControlsAwake()
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

  const [volume, changeVolume] = useVolume(player.setVolume)

  // Un clic pausa (o, tras una pausa larga, retrocede: DVR-1); dos, pantalla completa. Un clic pendiente no pasa a otro
  // canal.
  const { toggle: togglePlayback } = player
  const toggle = useCallback(() => {
    const paused = pausedAt.current
    if (paused !== null && Date.now() - paused.at > DVR_PAUSE_MS && canRewind)
      openRewind(paused.shown)
    else togglePlayback()
  }, [canRewind, openRewind, togglePlayback])
  const surfaceClicks = useSurfaceClicks(toggle, toggleFullscreen)
  const { cancel: cancelClick } = surfaceClicks
  // biome-ignore lint/correctness/useExhaustiveDependencies: al cambiar de canal se cancela el clic pendiente.
  useEffect(() => cancelClick, [cancelClick, channel.login])

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
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const shortcut = shortcutFor(event, contextOf(event.target))
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
  const dvr = liveBar(rewind, latency.current, phase === "ready")
  const live = phase === "ready"
  const twitchUrl = `https://www.twitch.tv/${channel.login}`

  return (
    <div className={`watch${chatShown ? " watch--chat" : ""}`} ref={view}>
      <div className="watch__main">
        <div
          className={`stage${showControls ? "" : " stage--idle"}${phase === "offline" ? " stage--offline" : ""}`}
          onPointerLeave={sleep}
          onPointerMove={wake}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: clic y doble clic en el vídeo son atajos del ratón; con el teclado, Espacio y F. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: ídem. */}
          <div
            className="stage__surface"
            onClick={surfaceClicks.onClick}
            onDoubleClick={surfaceClicks.onDoubleClick}
            ref={surface}
          />
          <Notice
            channel={details}
            onPlay={player.play}
            onRetry={player.retry}
            // Un directo que se ha quedado parado (state.stuck) se avisa como uno que no arranca, con «Reintentar».
            phase={phase === "ready" && state.stuck ? "stalled" : phase}
            blocked={state.blocked}
            twitchUrl={twitchUrl}
          />
          {canStep ? (
            <>
              <button
                aria-label={t("Canal anterior")}
                className="icon-button icon-button--light channel-step channel-step--prev"
                onClick={() => step(-1)}
                title={t("Canal anterior (↑)")}
                type="button"
              >
                <CaretLeftIcon />
              </button>
              <button
                aria-label={t("Canal siguiente")}
                className="icon-button icon-button--light channel-step channel-step--next"
                onClick={() => step(1)}
                title={t("Canal siguiente (↓)")}
                type="button"
              >
                <CaretRightIcon />
              </button>
            </>
          ) : null}
          <div
            className={`controls${dvr === null ? "" : " controls--seek"}`}
            role="toolbar"
            aria-label={t("Controles del reproductor")}
          >
            {dvr === null ? null : (
              <SeekBar
                buffered={dvr.duration}
                duration={dvr.duration}
                label={(at) =>
                  dvr.duration - at < DVR_MIN_BACK_S
                    ? t("En directo")
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
                  aria-label={state.playing ? t("Pausa") : t("Reproducir")}
                  className="icon-button icon-button--light"
                  onClick={toggle}
                  title={state.playing ? t("Pausa (Espacio)") : t("Reproducir (Espacio)")}
                  type="button"
                >
                  {state.playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />}
                </button>
                <SkipButton forward={false} onSkip={() => skip(-SKIP_S)} />
                <SkipButton disabled={!player.rewound} forward onSkip={() => skip(SKIP_S)} />
                <VolumeControl
                  muted={state.muted}
                  onToggleMuted={toggleMuted}
                  onVolume={changeVolume}
                  volume={volume}
                />
                {live && player.rewound ? (
                  <button
                    className="go-live"
                    onClick={goLive}
                    title={t("Volver al directo, con el retraso de tu modo (Fin)")}
                    type="button"
                  >
                    <i aria-hidden="true" /> {t("Ir al directo")}
                  </button>
                ) : live ? (
                  <span className="live">
                    <i aria-hidden="true" /> {t("En directo")}
                  </span>
                ) : null}
                {live && behind !== null ? (
                  <span
                    className="behind"
                    title={t(
                      "Lo que va por detrás de lo que ve un espectador normal de Twitch: el precio de no ver anuncios. El modo se elige en Ajustes.",
                    )}
                  >
                    {behind} {t("s por detrás")}
                  </span>
                ) : null}
              </div>
              <div className="controls__group">
                {state.qualities.length > 0 ? (
                  <ControlsMenu
                    label={quality}
                    onToggle={setQualityOpen}
                    open={qualityOpen}
                    title={t("Calidad")}
                  >
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
                  </ControlsMenu>
                ) : null}
                <ChatButton onToggle={toggleChat} shown={chatShown} />
                {onGrid === undefined ? null : (
                  <button
                    aria-label={t("Añadir otro canal")}
                    className="icon-button icon-button--light"
                    onClick={onGrid}
                    title={t("Añadir otro canal")}
                    type="button"
                  >
                    <SquaresFourIcon />
                  </button>
                )}
                <PictureInPictureButton
                  active={player.pictureInPicture}
                  onToggle={player.togglePictureInPicture}
                />
                <TheaterButton fullscreen={fullscreen} onTheater={onTheater} theater={theater} />
                <FullscreenButton fullscreen={fullscreen} onToggle={toggleFullscreen} />
              </div>
            </div>
          </div>
        </div>
        <section className="channel-info">
          <Avatar
            className={`avatar avatar--large${live ? " avatar--live" : ""}`}
            size={56}
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
              <span className="stat stat--live" title={t("Espectadores")}>
                <UserIcon aria-hidden="true" />
                {formatViewers(details.viewerCount)}
              </span>
            )}
            {details.startedAt === undefined ? null : (
              <span className="stat" title={t("Tiempo en directo")}>
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
                    ? t("Lo sigues. Para dejar de seguirlo, en twitch.tv")
                    : t("Seguirlo en twitch.tv")
                }
              >
                <HeartIcon aria-hidden="true" weight={following ? "fill" : "regular"} />
                {following ? (
                  <>
                    <span className="follow__label">{t("Siguiendo")}</span>
                    <span className="follow__hover">{t("Dejar de seguir")}</span>
                  </>
                ) : (
                  t("Seguir")
                )}
              </a>
            )}
            <a
              aria-label={t("Abrir en twitch.tv")}
              className="icon-button"
              href={twitchUrl}
              rel="noreferrer"
              target="_blank"
              title={t("Abrir en twitch.tv")}
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
        connected={visible}
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
export const ChannelChat = memo(
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
    useIdioma() // con memo no se vuelve a pintar solo al cambiar el idioma
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
  if (phase === "loading")
    return <div aria-label={t("Cargando")} className="spinner" role="status" />
  const body =
    phase === "offline" ? (
      <>
        <p>
          {channel.displayName} {t("no está en directo ahora.")}{" "}
          {window.api.vods === undefined ? null : t("Sus emisiones anteriores, debajo.")}
        </p>
        <a className="button" href={routeHash({ view: "home" })}>
          {t("Volver a Inicio")}
        </a>
      </>
    ) : phase === "error" || phase === "stalled" ? (
      <>
        <p>
          {phase === "error"
            ? t("No se pudo preparar el directo sin anuncios.")
            : t("Twitch no responde.")}
        </p>
        <span className="stage__actions">
          <button className="button button--primary" onClick={onRetry} type="button">
            {t("Reintentar")}
          </button>
          <a className="button" href={twitchUrl} rel="noreferrer" target="_blank">
            {t("Abrir en twitch.tv")}
          </a>
        </span>
      </>
    ) : blocked ? (
      <>
        <p>{t("El navegador no ha dejado empezar la reproducción.")}</p>
        <button className="button button--primary" onClick={onPlay} type="button">
          {t("Reproducir")}
        </button>
      </>
    ) : null
  return body === null ? null : (
    <div className="stage__notice" role="alert">
      {body}
    </div>
  )
}
