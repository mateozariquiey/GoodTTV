import type { LatencyMode, PreferencesPatch, Storyboard, VideoDetail } from "@goodttv/contratos"
import {
  chosenLiveQuality,
  chosenVolume,
  formatAgo,
  formatClock,
  formatViewers,
  prefetchVod,
  prewarmStream,
  useReplayChat,
  useWatchTime,
  vodDetail,
} from "@goodttv/interfaz"
import {
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowsInLineHorizontalIcon,
  ArrowsOutLineHorizontalIcon,
  ChatTextIcon,
  CornersInIcon,
  CornersOutIcon,
  PauseIcon,
  PlayIcon,
  SpeakerHighIcon,
  SpeakerSimpleXIcon,
} from "@phosphor-icons/react"
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react"
import { Avatar } from "./Avatar"
import { ChatPanel } from "./ChatPanel"
import { useFullscreen } from "./fullscreen"
import { PictureInPictureButton } from "./PictureInPictureButton"
import { navigate } from "./routes"
import { SeekBar } from "./SeekBar"
import { SKIP_S, SkipButton } from "./SkipButton"
import { contextOf } from "./shortcuts"
import { useSoleSound } from "./sonido"
import { useVodPlayer } from "./useVodPlayer"
import { ChannelVideos } from "./Videos"

// Un VOD (VOD-1): como un canal en directo, con la barra para moverse por el vídeo (con sus miniaturas al pasar el
// ratón), la velocidad, la calidad y el chat del vídeo a la par de la imagen. Reanuda donde se dejó y lo dice, con la
// opción de empezar desde el principio. Atajos como en YouTube: Espacio o K, J y L o ← → (10 s), 0-9 (a ese décimo),
// M, F, T y C.

const IDLE_MS = 3000
const RESUMED_MS = 8000
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const DOUBLE_CLICK_MS = 220
const WARM_PING_MS = 20_000 // retrocediendo un directo, su empalme se mantiene caliente para volver rápido

type Props = {
  // DVR-1: retrocediendo el directo de este canal, desde este segundo del VOD de la emisión en curso.
  readonly at?: number | undefined
  readonly live?: string | undefined
  readonly latencyMode: LatencyMode
  readonly chatVisible: boolean
  readonly id: string
  readonly onPreferences: (patch: PreferencesPatch) => void
  readonly onTheater: (on: boolean) => void
  readonly scale: "large" | "normal"
  readonly theater: boolean
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly video: VideoDetail }

export const VodView = ({
  at,
  chatVisible,
  id,
  latencyMode,
  live,
  onPreferences,
  onTheater,
  scale,
  theater,
}: Props) => {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" })
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: «attempt» vuelve a pedirlo.
  useEffect(() => {
    if (window.api.vods === undefined) {
      setLoaded({ kind: "error" })
      return undefined
    }
    let active = true
    setLoaded({ kind: "loading" })
    // La lista maestra, a la vez que los datos del vídeo. Los dos suelen estar ya pedidos (vod-cache.ts): al pasar el
    // ratón por su tarjeta o, retrocediendo un directo, al ver el canal.
    prefetchVod(id)
    vodDetail(id)
      .then((video) => {
        if (active) setLoaded(video === null ? { kind: "missing" } : { kind: "ready", video })
      })
      .catch(() => {
        if (active) setLoaded({ kind: "error" })
      })
    return () => {
      active = false
    }
  }, [attempt, id])

  const video = loaded.kind === "ready" ? loaded.video : null
  const [start, setStart] = useState<number | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: otro vídeo, donde se dejó.
  useEffect(() => setStart(null), [id])
  const surface = useRef<HTMLDivElement>(null)
  // A pantalla completa va la vista: solo el vídeo o, en modo teatro, también el chat (desktop.css).
  const view = useRef<HTMLDivElement>(null)
  // Retrocediendo un directo: desde el segundo pedido, y sin guardarlo como vídeo a medias.
  // Al retroceder un directo, en la calidad elegida en él (si no es la automática).
  const liveQuality = live === undefined ? null : chosenLiveQuality()
  const player = useVodPlayer(surface, video, start ?? at ?? null, live === undefined, liveQuality)
  const goLive = useCallback(() => {
    if (live !== undefined) navigate({ login: live, view: "channel" })
  }, [live])
  useEffect(() => {
    if (live === undefined) return undefined
    const ping = (): void => prewarmStream(live, latencyMode)
    ping()
    const timer = setInterval(ping, WARM_PING_MS)
    return () => clearInterval(timer)
  }, [latencyMode, live])
  const { state } = player
  // Con varias pestañas suena una sola (EXT-5), también con un VOD: en silencio, sin sonido; parada, en pausa (un VOD
  // no se escapa como un directo), y al volver sigue.
  const sole = useSoleSound(`vod:${id}`, true)
  const { claim, standby } = sole
  // Ver sus VOD también cuenta para ordenar tus seguidos por los que más ves.
  useWatchTime(video?.owner.login, state.playing && standby === "no")
  const { pause: pausePlayback, play: resumePlayback, setMuted } = player
  const mutedNow = useRef(state.muted)
  mutedNow.current = state.muted
  const playingNow = useRef(state.playing)
  playingNow.current = state.playing
  const mutedBefore = useRef<boolean | null>(null)
  const pausedBySound = useRef(false)
  useEffect(() => {
    if (standby === "no") {
      if (mutedBefore.current !== null) setMuted(mutedBefore.current)
      mutedBefore.current = null
      if (pausedBySound.current) resumePlayback()
      pausedBySound.current = false
      return
    }
    mutedBefore.current ??= mutedNow.current
    setMuted(true)
    if (standby === "parado" && playingNow.current) {
      pausedBySound.current = true
      pausePlayback()
    }
  }, [pausePlayback, resumePlayback, setMuted, standby])
  // Como en un directo (ChannelView): con el silencio o el volumen, lo que elija la persona.
  const takeSound = useCallback(
    (choosing = false) => {
      if (standby === "no") return
      if (choosing) mutedBefore.current = null
      claim()
    },
    [claim, standby],
  )

  const [storyboard, setStoryboard] = useState<Storyboard | null>(null)
  useEffect(() => {
    setStoryboard(null)
    const url = video?.storyboard
    if (url == null || window.api.vods === undefined) return undefined
    let active = true
    window.api.vods
      .storyboard(url)
      .then((board) => {
        if (active) setStoryboard(board)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [video])

  const onWindowChat = useCallback(
    (on: boolean) => onPreferences({ chatVisible: on }),
    [onPreferences],
  )
  const { chatShown, fullscreen, toggleChat, toggleFullscreen } = useFullscreen(
    view,
    chatVisible,
    onWindowChat,
  )
  const chat = useReplayChat(video?.id, video?.owner.id, state.time, chatShown)

  // Controles a la vista al mover el ratón, y siempre en pausa o con un menú abierto.
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
  const [menu, setMenu] = useState<"rate" | "quality" | null>(null)
  const showControls = awake || !state.playing || menu !== null

  // Reanudado: lo dice unos segundos, con la opción de empezar desde el principio.
  const [resumedShown, setResumedShown] = useState(false)
  useEffect(() => {
    if (state.resumedFrom === null) return undefined
    setResumedShown(true)
    const timer = setTimeout(() => setResumedShown(false), RESUMED_MS)
    return () => clearTimeout(timer)
  }, [state.resumedFrom])

  const [volume, setVolumeState] = useState(() => chosenVolume().volume)
  const { setVolume, toggleMuted, toggle, skip, seek } = player
  const changeVolume = (next: number): void => {
    takeSound(true)
    const value = Math.min(1, Math.max(0, next))
    setVolumeState(value)
    setVolume(value)
  }

  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onSurfaceClick = (): void => {
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(toggle, DOUBLE_CLICK_MS)
  }
  const onSurfaceDoubleClick = (): void => {
    clearTimeout(clickTimer.current)
    toggleFullscreen()
  }
  useEffect(() => () => clearTimeout(clickTimer.current), [])

  const duration = state.duration > 0 ? state.duration : (video?.seconds ?? 0)
  // Retrocediendo un directo, avanzar más allá de lo grabado lleva al directo.
  const skipBy = useCallback(
    (seconds: number) => {
      if (seconds > 0 && live !== undefined && state.time + seconds >= duration - 1) goLive()
      else skip(seconds)
    },
    [duration, goLive, live, skip, state.time],
  )
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      const context = contextOf(event.target)
      if (context.typing) return
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if ((key === " " && !context.onControl) || key === "k" || key === "m") takeSound(key === "m")
      if ((key === " " && !context.onControl) || key === "k") toggle()
      else if (key === "j" || (key === "ArrowLeft" && !context.onArrows)) skipBy(-SKIP_S)
      else if (key === "l" || (key === "ArrowRight" && !context.onArrows)) skipBy(SKIP_S)
      else if (key === "m") toggleMuted()
      else if (key === "f") toggleFullscreen()
      // El modo teatro es de la ventana: a pantalla completa, T no hace nada (ChannelView).
      else if (key === "t" && !fullscreen) onTheater(!theater)
      else if (key === "c") toggleChat()
      else if (/^[0-9]$/.test(key)) seek((duration * Number(key)) / 10)
      else if (key === "Home") seek(0)
      else if (key === "End" && live !== undefined) goLive()
      else return
      event.preventDefault()
      wake()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [
    duration,
    fullscreen,
    goLive,
    live,
    onTheater,
    seek,
    skipBy,
    takeSound,
    theater,
    toggle,
    toggleChat,
    toggleFullscreen,
    toggleMuted,
    wake,
  ])

  if (loaded.kind !== "ready" || video === null) {
    return (
      <div className="vod-missing">
        {loaded.kind === "loading" ? (
          <div aria-label="Cargando" className="spinner" role="status" />
        ) : (
          <>
            <p>
              {loaded.kind === "missing"
                ? "Este vídeo ya no existe o no se puede ver."
                : "No se pudo cargar el vídeo."}
            </p>
            {loaded.kind === "error" ? (
              <button
                className="button button--primary"
                onClick={() => setAttempt((value) => value + 1)}
                type="button"
              >
                Reintentar
              </button>
            ) : null}
          </>
        )}
      </div>
    )
  }

  const muted = state.muted || volume === 0
  const quality =
    state.quality === -1
      ? `Auto${state.playingLevel >= 0 ? ` (${state.qualities.find((each) => each.index === state.playingLevel)?.label ?? ""})` : ""}`
      : (state.qualities.find((each) => each.index === state.quality)?.label ?? "Auto")
  const twitchUrl = `https://www.twitch.tv/videos/${video.id}`
  return (
    <div className={`watch${chatShown ? " watch--chat" : ""}`} ref={view}>
      <div className="watch__main">
        <div
          className={`stage${showControls ? "" : " stage--idle"}`}
          onPointerDownCapture={(event) =>
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
          {state.phase === "loading" ? (
            <div aria-label="Cargando" className="spinner" role="status" />
          ) : state.phase === "error" || state.phase === "unavailable" ? (
            <div className="stage__notice" role="alert">
              <p>
                {state.phase === "unavailable"
                  ? "Este vídeo es solo para suscriptores."
                  : "No se pudo reproducir el vídeo."}
              </p>
              <span className="stage__actions">
                {state.phase === "error" ? (
                  <button className="button button--primary" onClick={player.retry} type="button">
                    Reintentar
                  </button>
                ) : null}
                <a className="button" href={twitchUrl} rel="noreferrer" target="_blank">
                  Abrir en twitch.tv
                </a>
              </span>
            </div>
          ) : null}
          {resumedShown && state.resumedFrom !== null ? (
            <div className="resumed" role="status">
              Sigues donde lo dejaste ({formatClock(state.resumedFrom)}).
              <button
                className="resumed__restart"
                onClick={() => {
                  setResumedShown(false)
                  seek(0)
                }}
                type="button"
              >
                <ArrowCounterClockwiseIcon aria-hidden="true" />
                Desde el principio
              </button>
            </div>
          ) : null}
          <div
            className="controls controls--seek controls--vod"
            role="toolbar"
            aria-label="Controles del vídeo"
          >
            <SeekBar
              buffered={state.buffered}
              duration={duration}
              onSeek={(to) => {
                // Retrocediendo un directo, llegar al final de lo grabado (→ en la barra, o arrastrarla hasta él) lleva
                // al directo, como los 10 s.
                if (live !== undefined && to >= duration - 1) goLive()
                else seek(to)
                wake()
              }}
              storyboard={storyboard}
              time={state.time}
            />
            <div className="controls__row">
              <div className="controls__group">
                <button
                  aria-label={state.playing ? "Pausa" : "Reproducir"}
                  className="icon-button icon-button--light"
                  onClick={toggle}
                  title={state.playing ? "Pausa (Espacio o K)" : "Reproducir (Espacio o K)"}
                  type="button"
                >
                  {state.playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />}
                </button>
                <SkipButton forward={false} onSkip={() => skipBy(-SKIP_S)} />
                <SkipButton forward onSkip={() => skipBy(SKIP_S)} />
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
                <span className="clock">
                  {formatClock(state.time)} / {formatClock(duration)}
                </span>
                {live === undefined ? null : (
                  <button
                    className="go-live"
                    onClick={goLive}
                    title="Volver al directo, con el retraso de tu modo (Fin)"
                    type="button"
                  >
                    <i aria-hidden="true" />
                    Ir al directo
                  </button>
                )}
              </div>
              <div className="controls__group">
                <Menu
                  label={state.rate === 1 ? "1×" : `${state.rate}×`}
                  onToggle={(open) => setMenu(open ? "rate" : null)}
                  open={menu === "rate"}
                  title="Velocidad"
                >
                  {RATES.map((rate) => (
                    <button
                      aria-checked={rate === state.rate}
                      key={rate}
                      onClick={() => {
                        player.setRate(rate)
                        setMenu(null)
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      {rate === 1 ? "Normal" : `${rate}×`}
                    </button>
                  ))}
                </Menu>
                {state.qualities.length > 0 ? (
                  <Menu
                    label={quality}
                    onToggle={(open) => setMenu(open ? "quality" : null)}
                    open={menu === "quality"}
                    title="Calidad"
                  >
                    {[{ index: -1, label: "Auto" }, ...state.qualities].map((each) => (
                      <button
                        aria-checked={each.index === state.quality}
                        key={each.index}
                        onClick={() => {
                          player.setQuality(each.index)
                          setMenu(null)
                        }}
                        role="menuitemradio"
                        type="button"
                      >
                        {each.label}
                      </button>
                    ))}
                  </Menu>
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
          <a
            aria-label={`Ir al canal de ${video.owner.displayName}`}
            className="channel-info__avatar"
            href={`#/canal/${video.owner.login}`}
            title="Ir al canal"
          >
            <Avatar
              className="avatar avatar--large"
              name={video.owner.displayName}
              url={video.owner.avatar ?? undefined}
            />
          </a>
          <div className="channel-info__text">
            <h1>
              <a className="channel-info__link" href={`#/canal/${video.owner.login}`}>
                {video.owner.displayName}
              </a>
            </h1>
            <p className="channel-info__title">{video.title || "Sin título"}</p>
            <p className="channel-info__meta">
              {[
                video.category,
                formatAgo(video.createdAt),
                `${formatViewers(video.views)} visualizaciones`,
              ]
                .filter((each) => each !== null && each !== "")
                .join(" · ")}
            </p>
          </div>
          <div className="channel-info__stats">
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
        {/* Los demás vídeos del canal, para no tener que volver a él a buscarlos. */}
        <ChannelVideos
          current={video.id}
          login={video.owner.login}
          offline={false}
          title={`Más vídeos de ${video.owner.displayName}`}
        />
      </div>
      {chatShown ? <ChatPanel chat={chat} replay scale={scale} writing="no" /> : null}
    </div>
  )
}

// Un menú de los controles (velocidad, calidad), como el de calidad del directo.
const Menu = ({
  children,
  label,
  onToggle,
  open,
  title,
}: {
  readonly children: React.ReactNode
  readonly label: string
  readonly onToggle: (open: boolean) => void
  readonly open: boolean
  readonly title: string
}) => (
  <div className="quality">
    <button
      aria-expanded={open}
      aria-haspopup="menu"
      className="quality__button"
      onClick={() => onToggle(!open)}
      title={title}
      type="button"
    >
      {label}
    </button>
    {open ? (
      <div className="quality__menu" role="menu">
        {children}
      </div>
    ) : null}
  </div>
)
