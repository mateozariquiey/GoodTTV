import type { InputAction, Preferences, PreferencesPatch } from "@goodttv/contratos"
import {
  type Channel,
  ChatPanel,
  chatDelayOf,
  type PlayerState,
  t,
  useBehind,
  useChat,
  useHlsPlayer,
} from "@goodttv/interfaz"
import {
  ArrowLeftIcon,
  ChatTextIcon,
  PauseIcon,
  PlayIcon,
  SlidersHorizontalIcon,
  SpeakerHighIcon,
  SpeakerSimpleXIcon,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { navigation, useLayer } from "../navigation"
import { Avatar, LiveBadge, Uptime, Viewers } from "../ui"

type PlayerScreenProps = {
  readonly channel: Channel
  readonly lineup: readonly Channel[]
  readonly onBack: () => void
  readonly onChannel: (channel: Channel) => void
  readonly onPreferences: (patch: PreferencesPatch) => void
  readonly preferences: Preferences
  readonly signedIn: boolean
}

const LAYER = "player"
// Modo cine: mientras se reproduce, título y controles se ocultan tras este tiempo sin tocar el mando.
const CONTROLS_IDLE_MS = 4000

type Notice = {
  readonly action?: { readonly id: string; readonly label: string; readonly run: () => void }
  readonly text: string
  readonly tone: "info" | "warning"
}

const qualityLabel = (quality: string): string =>
  quality === "auto" ? "Auto" : quality === "chunked" ? "Original" : quality

export const PlayerScreen = ({
  channel,
  lineup,
  onBack,
  onChannel,
  onPreferences,
  preferences,
  signedIn,
}: PlayerScreenProps) => {
  const root = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLDivElement>(null)
  // Reproductor propio sin anuncios (D11). Si falla, un aviso con «Reintentar»: no hay otro reproductor de respaldo.
  const player = useHlsPlayer(video, channel.login, true, preferences.latencyMode)
  const { state } = player
  // Chat al paso de la imagen (aproximado): se retrasa lo que la imagen va por detrás de un espectador normal de
  // Twitch. Mientras la imagen arranca (también tras cambiar de calidad o de modo) no se sabe cuánto: espera; si no
  // va a haber imagen, no se retrasa.
  const { latency } = player
  // Cuánto va por detrás de un espectador normal de Twitch, junto a «En directo», como en el escritorio.
  const behind = useBehind(latency)
  const { phase } = state
  const chatDelay = useCallback(
    () => chatDelayOf(latency.current, phase === "loading" || phase === "ready"),
    [latency, phase],
  )
  const chat = useChat(signedIn ? channel.userId : undefined, preferences.chatVisible, chatDelay)
  const [qualityOpen, setQualityOpen] = useState(false)
  // Modo cine: el vídeo ocupa todo el alto y título y controles van encima, ocultándose solos.
  const [idle, setIdle] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const wake = useCallback(() => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), CONTROLS_IDLE_MS)
  }, [])
  useEffect(() => () => clearTimeout(idleTimer.current), [])
  // Each visit to a channel starts on the playback controls, not where the last visit ended.
  useEffect(() => () => void navigation.forget(LAYER), [])

  const zap = useCallback(
    (step: 1 | -1) => {
      if (lineup.length < 2) return
      const index = lineup.findIndex((candidate) => candidate.login === channel.login)
      const next = lineup[(index + step + lineup.length) % lineup.length]
      if (next === undefined) return
      setQualityOpen(false)
      onChannel(next)
    },
    [channel.login, lineup, onChannel],
  )

  const notice = noticeFor(state, channel, { play: player.play, retry: player.retry })
  const noticeAction = notice?.action?.id
  const noticeText = notice?.text
  // Los avisos, la pausa y el selector de calidad dejan la franja a la vista.
  const controlsHidden = idle && state.playing && notice === undefined && !qualityOpen
  // Al cambiar de canal, al arrancar o reanudar, al irse un aviso o al cerrar el selector se ve unos segundos.
  // biome-ignore lint/correctness/useExhaustiveDependencies: those changes are what re-show the band.
  useEffect(() => wake(), [wake, channel.login, state.playing, noticeText, qualityOpen])

  // A notice that needs the viewer (retry, play) takes focus once when it appears. If the quality chooser is open it
  // closes first: it is another layer, and OK would keep acting inside it instead of on «Reintentar».
  useEffect(() => {
    if (noticeAction !== undefined) setQualityOpen(false)
  }, [noticeAction])
  useEffect(() => {
    if (noticeAction !== undefined && !qualityOpen) navigation.focus(LAYER, noticeAction)
  }, [noticeAction, qualityOpen])

  // Play/Pause works on every layer of this screen, the quality chooser included.
  const onPlayback = (action: InputAction): boolean => {
    if (action === "play-pause") player.toggle()
    else if (action === "play") player.play()
    else if (action === "pause") player.pause()
    else return false
    return true
  }

  const onAction = (action: InputAction): boolean => {
    const hidden = controlsHidden
    wake()
    if (onPlayback(action)) return true
    // Up and Down change channel, except when a notice button sits above the controls.
    if (action === "up" && noticeAction === undefined) zap(-1)
    else if (action === "down" && noticeAction === undefined) zap(1)
    // With the band hidden, any other key (OK, Left, Right, Back) only brings it back.
    else return hidden
    return true
  }

  useLayer({
    entry: () =>
      state.phase === "error" ||
      state.phase === "stalled" ||
      (state.phase === "ready" && state.stuck)
        ? "player-retry"
        : state.blocked
          ? "player-play"
          : "player-playback",
    id: LAYER,
    onAction,
    onBack,
    root,
  })

  return (
    <div className={`player${preferences.chatVisible ? " player--chat" : ""}`} ref={root}>
      <div className="player__stage">
        {/* The own <video> lives here; the band floats over it (cinema mode). */}
        <div aria-busy={state.phase === "loading"} className="player__video" ref={video} />
        <div className={`player__band${controlsHidden ? " player__band--hidden" : ""}`}>
          <div className="player__info">
            <Avatar channel={channel} />
            <div className="player__text">
              <p className="player__line">
                <strong className="player__name">{channel.displayName}</strong>
                {state.phase === "offline" ? null : <LiveBadge />}
                {state.phase === "ready" && behind !== null ? (
                  <span className="player__behind">
                    {behind} {t("s por detrás")}
                  </span>
                ) : null}
                {channel.category === undefined ? null : (
                  <span className="player__category">{channel.category}</span>
                )}
                <span className="player__stats">
                  <Viewers channel={channel} />
                  {channel.startedAt === undefined ? null : (
                    <>
                      {" · "}
                      <Uptime channel={channel} />
                    </>
                  )}
                </span>
              </p>
              {notice === undefined ? (
                <p className="player__line player__line--sub">
                  <span className="player__title">
                    {channel.title ?? `twitch.tv/${channel.login}`}
                  </span>
                  {lineup.length > 1 ? (
                    <span className="player__zap">
                      <kbd>↑</kbd>
                      <kbd>↓</kbd> {t("canal anterior/siguiente")}
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className={`player__notice player__notice--${notice.tone}`} role="status">
                  <span>{notice.text}</span>
                  {notice.action === undefined ? null : (
                    <button
                      className="button button--primary"
                      data-nav
                      data-nav-id={notice.action.id}
                      onClick={notice.action.run}
                      type="button"
                    >
                      {notice.action.label}
                    </button>
                  )}
                </p>
              )}
            </div>
          </div>
          <div
            aria-label={t("Controles")}
            className="player__controls"
            hidden={qualityOpen}
            role="toolbar"
          >
            <button
              className="button"
              data-nav
              data-nav-id="player-back"
              onClick={onBack}
              type="button"
            >
              <ArrowLeftIcon aria-hidden="true" />
              {t("Volver")}
            </button>
            <button
              className="button"
              data-nav
              data-nav-id="player-playback"
              disabled={state.phase !== "ready" && state.phase !== "loading"}
              onClick={player.toggle}
              type="button"
            >
              {state.playing ? (
                <PauseIcon aria-hidden="true" weight="fill" />
              ) : (
                <PlayIcon aria-hidden="true" weight="fill" />
              )}
              {state.playing ? t("Pausa") : t("Reanudar")}
            </button>
            <button
              className="button"
              data-nav
              data-nav-id="player-mute"
              disabled={state.phase !== "ready" && state.phase !== "loading"}
              onClick={player.toggleMuted}
              type="button"
            >
              {state.muted ? (
                <SpeakerSimpleXIcon aria-hidden="true" />
              ) : (
                <SpeakerHighIcon aria-hidden="true" />
              )}
              {state.muted ? t("Activar sonido") : t("Silencio")}
            </button>
            <button
              aria-expanded={qualityOpen}
              className="button"
              data-nav
              data-nav-id="player-quality"
              data-player-quality={state.quality}
              disabled={state.qualities.length === 0}
              onClick={() => setQualityOpen(true)}
              type="button"
            >
              <SlidersHorizontalIcon aria-hidden="true" />
              {t("Calidad")}: {qualityLabel(state.quality)}
            </button>
            <button
              aria-pressed={preferences.chatVisible}
              className="button"
              data-nav
              data-nav-id="player-chat"
              onClick={() => onPreferences({ chatVisible: !preferences.chatVisible })}
              type="button"
            >
              <ChatTextIcon aria-hidden="true" />
              {preferences.chatVisible ? t("Ocultar chat") : "Chat"}
            </button>
          </div>
          {qualityOpen ? (
            <QualityChooser
              current={state.quality}
              onChoose={(quality) => {
                player.setQuality(quality)
                setQualityOpen(false)
              }}
              onClose={() => setQualityOpen(false)}
              onPlayback={onPlayback}
              qualities={state.qualities}
            />
          ) : null}
        </div>
      </div>
      {preferences.chatVisible ? <ChatPanel chat={chat} scale={preferences.chatScale} /> : null}
    </div>
  )
}

const noticeFor = (
  state: PlayerState,
  channel: Channel,
  actions: { readonly play: () => void; readonly retry: () => void },
): Notice | undefined => {
  if (state.phase === "error") {
    return {
      action: { id: "player-retry", label: t("Reintentar"), run: actions.retry },
      text: t("No se pudo preparar el directo sin anuncios."),
      tone: "warning",
    }
  }
  // «stalled»: no arranca. «stuck»: ya se veía y lleva parado más de lo normal (puede volver solo).
  if (state.phase === "stalled" || (state.phase === "ready" && state.stuck)) {
    return {
      action: { id: "player-retry", label: t("Reintentar"), run: actions.retry },
      text: t("Twitch no responde."),
      tone: "warning",
    }
  }
  if (state.phase === "offline") {
    return {
      text: t("{displayName} no está en directo ahora.", { displayName: channel.displayName }),
      tone: "info",
    }
  }
  if (state.blocked) {
    return {
      action: { id: "player-play", label: t("Reproducir"), run: actions.play },
      text: t("Twitch ha bloqueado el arranque."),
      tone: "warning",
    }
  }
  if (state.phase === "loading") return { text: t("Conectando con Twitch…"), tone: "info" }
  return undefined
}

type QualityChooserProps = {
  readonly current: string
  readonly onChoose: (quality: string) => void
  readonly onClose: () => void
  readonly onPlayback: (action: InputAction) => boolean
  readonly qualities: PlayerState["qualities"]
}

const QualityChooser = ({
  current,
  onChoose,
  onClose,
  onPlayback,
  qualities,
}: QualityChooserProps) => {
  const root = useRef<HTMLFieldSetElement>(null)
  useLayer({
    entry: () => `quality-${current}`,
    id: "player-quality",
    // Up and Down do not change channel while choosing a quality.
    onAction: (action) => onPlayback(action) || action === "up" || action === "down",
    onBack: onClose,
    root,
  })
  return (
    <fieldset className="player__qualities" ref={root}>
      <legend className="visually-hidden">{t("Calidad")}</legend>
      {qualities.map((quality) => (
        <button
          aria-pressed={quality.id === current}
          className="button"
          data-nav
          data-nav-id={`quality-${quality.id}`}
          key={quality.id}
          onClick={() => onChoose(quality.id)}
          type="button"
        >
          {qualityLabel(quality.label)}
        </button>
      ))}
    </fieldset>
  )
}
