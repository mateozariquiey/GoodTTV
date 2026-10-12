import type { Preferences, PreferencesPatch } from "@goodttv/contratos"
import {
  type Channel,
  formatUptime,
  formatViewers,
  fromStream,
  TWITCH_VIEWER_LATENCY,
  toRecent,
  useBehind,
  useChat,
  useHlsPlayer,
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
  PauseIcon,
  PlayIcon,
  SpeakerHighIcon,
  SpeakerSimpleXIcon,
  UserIcon,
} from "@phosphor-icons/react"
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react"
import { Avatar } from "./Avatar"
import { ChatPanel } from "./ChatPanel"
import { contextOf, shortcutFor } from "./shortcuts"

// Un canal: el vídeo manda. Los controles salen al mover el ratón sobre él y se ocultan solos, con el cursor, mientras
// se reproduce. Debajo, la ficha del canal; al lado, el chat de solo lectura, retrasado como la imagen.

const IDLE_MS = 3000
const DOUBLE_CLICK_MS = 220
const UNDO_CLICK_MS = 600 // más que el doble clic más lento habitual del sistema
const WHEEL_STEP = 0.05

type Props = {
  readonly channel: Channel
  readonly lineup: readonly Channel[]
  readonly onOpen: (channel: Channel) => void
  readonly onPreferences: (patch: PreferencesPatch) => void
  readonly onTheater: (on: boolean) => void
  readonly preferences: Preferences
  readonly signedIn: boolean
  readonly theater: boolean
}

export const ChannelView = ({
  channel,
  lineup,
  onOpen,
  onPreferences,
  onTheater,
  preferences,
  signedIn,
  theater,
}: Props) => {
  const stage = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const player = useHlsPlayer(surface, channel.login, true, preferences.latencyMode)
  const { latency, state } = player

  // Abierto por su nombre (la búsqueda o la dirección): con cuenta, se completan título, categoría e id del chat.
  const [details, setDetails] = useState(channel)
  useEffect(() => {
    setDetails(channel)
    if (!signedIn || channel.userId !== undefined) return undefined
    let active = true
    window.api.catalog
      .streamsByLogin([channel.login])
      .then(([stream]) => {
        if (active && stream !== undefined) setDetails(fromStream(stream))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [channel, signedIn])
  const latest = useRef(details)
  latest.current = details
  // A recientes al abrirlo, y otra vez cuando se completan sus datos (con su foto e id).
  const recentKey = `${details.login}|${details.userId ?? ""}`
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
  const chat = useChat(signedIn ? details.userId : undefined, preferences.chatVisible, chatDelay)

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

  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === stage.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement !== null) void document.exitFullscreen()
    else void stage.current?.requestFullscreen()
  }, [])

  const [volume, setVolume] = useState(1)
  const { setVolume: applyVolume } = player
  const changeVolume = useCallback(
    (next: number) => {
      const value = Math.min(1, Math.max(0, next))
      setVolume(value)
      applyVolume(value)
    },
    [applyVolume],
  )
  // La rueda sobre el vídeo cambia el volumen (y no desplaza la página): con un detector propio, porque React los
  // registra pasivos.
  useEffect(() => {
    const element = surface.current
    if (element === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      changeVolume(volume + (event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP))
      wake()
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [changeVolume, volume, wake])

  // Un clic pausa; dos, pantalla completa. El primero espera por si llega el segundo; si el doble clic del sistema es
  // más lento y el primero ya pausó, se deshace. Un clic pendiente no pasa a otro canal.
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const toggledAt = useRef(0)
  const { toggle } = player
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
  const chatVisible = preferences.chatVisible
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
      if (shortcut === "play-pause") toggle()
      else if (shortcut === "mute") toggleMuted()
      else if (shortcut === "fullscreen") toggleFullscreen()
      else if (shortcut === "theater") onTheater(!theater)
      else if (shortcut === "chat") onPreferences({ chatVisible: !chatVisible })
      else if (shortcut === "previous") step(-1)
      else if (shortcut === "next") step(1)
      else return
      event.preventDefault()
      wake()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [
    chatVisible,
    onPreferences,
    onTheater,
    step,
    theater,
    toggle,
    toggleFullscreen,
    toggleMuted,
    wake,
  ])

  const quality = state.qualities.find((each) => each.id === state.quality)?.label ?? "Auto"
  const muted = state.muted || volume === 0
  const live = phase === "ready"
  const twitchUrl = `https://www.twitch.tv/${channel.login}`

  return (
    <div className={`watch${chatVisible ? " watch--chat" : ""}`}>
      <div className="watch__main">
        <div
          className={`stage${showControls ? "" : " stage--idle"}`}
          onPointerLeave={() => setAwake(false)}
          onPointerMove={wake}
          ref={stage}
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
          <div className="controls" role="toolbar" aria-label="Controles del reproductor">
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
              <button
                aria-label={muted ? "Quitar el silencio" : "Silenciar"}
                className="icon-button icon-button--light"
                onClick={muted && volume === 0 ? () => changeVolume(0.5) : toggleMuted}
                title={muted ? "Quitar el silencio (M)" : "Silenciar (M)"}
                type="button"
              >
                {muted ? <SpeakerSimpleXIcon /> : <SpeakerHighIcon />}
              </button>
              <input
                aria-label="Volumen"
                className="volume"
                max={1}
                min={0}
                onChange={(event) => changeVolume(Number(event.currentTarget.value))}
                step={0.01}
                style={{ "--level": `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
                type="range"
                value={muted ? 0 : volume}
              />
              {live ? (
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
                      {state.qualities.map((each) => (
                        <button
                          aria-checked={each.id === state.quality}
                          key={each.id}
                          onClick={() => {
                            player.setQuality(each.id)
                            setQualityOpen(false)
                          }}
                          role="menuitemradio"
                          type="button"
                        >
                          {each.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button
                aria-label={chatVisible ? "Ocultar el chat" : "Mostrar el chat"}
                aria-pressed={chatVisible}
                className="icon-button icon-button--light"
                onClick={() => onPreferences({ chatVisible: !chatVisible })}
                title={chatVisible ? "Ocultar el chat (C)" : "Mostrar el chat (C)"}
                type="button"
              >
                <ChatTextIcon />
              </button>
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
              <button
                aria-label={fullscreen ? "Salir de la pantalla completa" : "Pantalla completa"}
                className="icon-button icon-button--light"
                onClick={toggleFullscreen}
                title="Pantalla completa (F): solo el vídeo"
                type="button"
              >
                {fullscreen ? <CornersInIcon /> : <CornersOutIcon />}
              </button>
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
      </div>
      {chatVisible ? <ChatPanel chat={chat} scale={preferences.chatScale} /> : null}
    </div>
  )
}

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
        <p>{channel.displayName} no está en directo ahora.</p>
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
