import {
  ArrowLeftIcon,
  ChatTextIcon,
  PauseIcon,
  PlayIcon,
  SlidersHorizontalIcon,
  SpeakerHighIcon,
  SpeakerSimpleXIcon,
  TwitchLogoIcon,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { InputAction, Preferences, PreferencesPatch } from "../../../shared/contracts"
import type { Channel } from "../channel"
import { navigation, useLayer } from "../navigation"
import { Avatar, LiveBadge, Uptime, Viewers } from "../ui"
import { ChatPanel } from "./ChatPanel"
import { useChat } from "./useChat"
import { type PlayerState, useTwitchPlayer } from "./useTwitchPlayer"

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
  const player = useTwitchPlayer(video, channel.login)
  const { state } = player
  const chat = useChat(signedIn ? channel.userId : undefined, preferences.chatVisible)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [interaction, setInteraction] = useState<number>()
  const interactionRef = useRef<number | undefined>(undefined)
  interactionRef.current = interaction

  // The interaction mode must end before anything else changes what the player shows.
  const { syncIntent } = player
  const endInteraction = useCallback(() => {
    const id = interactionRef.current
    if (id === undefined) return
    interactionRef.current = undefined
    setInteraction(undefined)
    syncIntent()
    void window.api.player.endInteraction(id)
  }, [syncIntent])

  // When main ends the mode (Back, failure, window blur), focus returns to the button that opened
  // it, once React has re-enabled it.
  const refocusAfterInteraction = useRef(false)
  useEffect(
    () =>
      window.api.player.onInteractionEnded((id) => {
        if (id !== interactionRef.current) return
        interactionRef.current = undefined
        refocusAfterInteraction.current = true
        // A pause made with Twitch's own controls counts as the viewer's choice.
        syncIntent()
        setInteraction(undefined)
      }),
    [syncIntent],
  )
  useEffect(() => {
    if (interaction !== undefined || !refocusAfterInteraction.current) return
    refocusAfterInteraction.current = false
    navigation.focus(LAYER, "player-twitch")
  }, [interaction])
  useEffect(() => endInteraction, [endInteraction])
  // Each visit to a channel starts on the playback controls, not where the last visit ended.
  useEffect(() => () => void navigation.forget(LAYER), [])

  const beginInteraction = useCallback(async () => {
    try {
      const id = await window.api.player.beginInteraction()
      interactionRef.current = id
      setInteraction(id)
      // Real focus inside Twitch's frame; main translates the remote into Tab and Enter.
      video.current?.querySelector("iframe")?.focus()
    } catch {
      navigation.focus(LAYER, "player-twitch")
    }
  }, [])

  const zap = useCallback(
    (step: 1 | -1) => {
      if (lineup.length < 2) return
      const index = lineup.findIndex((candidate) => candidate.login === channel.login)
      const next = lineup[(index + step + lineup.length) % lineup.length]
      if (next === undefined) return
      endInteraction()
      setQualityOpen(false)
      onChannel(next)
    },
    [channel.login, endInteraction, lineup, onChannel],
  )

  const back = useCallback(() => {
    endInteraction()
    onBack()
  }, [endInteraction, onBack])

  const notice = noticeFor(state, channel, interaction !== undefined, {
    play: player.play,
    retry: player.retry,
    twitch: () => void beginInteraction(),
  })
  const noticeAction = notice?.action?.id

  // A notice that needs the viewer (retry, play, Twitch's gate) takes focus once when it appears.
  useEffect(() => {
    if (noticeAction !== undefined) navigation.focus(LAYER, noticeAction)
  }, [noticeAction])

  // Play/Pause works on every layer of this screen, the quality chooser included.
  const onPlayback = (action: InputAction): boolean => {
    if (action === "play-pause") player.toggle()
    else if (action === "play") player.play()
    else if (action === "pause") player.pause()
    else return false
    return true
  }

  const onAction = (action: InputAction): boolean => {
    if (onPlayback(action)) return true
    // Up and Down change channel, except when a notice button sits above the controls.
    if (action === "up" && noticeAction === undefined) zap(-1)
    else if (action === "down" && noticeAction === undefined) zap(1)
    else return false
    return true
  }

  useLayer({
    entry: () =>
      state.phase === "error" || state.phase === "stalled"
        ? "player-retry"
        : state.blocked
          ? "player-play"
          : "player-playback",
    id: LAYER,
    onAction,
    onBack: back,
    root,
  })

  return (
    <div className={`player${preferences.chatVisible ? " player--chat" : ""}`} ref={root}>
      <div className="player__stage">
        {/* The official embed lives here. Nothing in the app may ever overlap this box. */}
        <div aria-busy={state.phase === "loading"} className="player__video" ref={video} />
        <div className="player__band">
          <div className="player__info">
            <Avatar channel={channel} />
            <div className="player__text">
              <p className="player__line">
                <strong className="player__name">{channel.displayName}</strong>
                {state.phase === "offline" ? null : <LiveBadge />}
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
                      <kbd>↓</kbd> canal anterior/siguiente
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
            aria-label="Controles"
            className="player__controls"
            hidden={qualityOpen}
            role="toolbar"
          >
            <button
              className="button"
              data-nav
              data-nav-id="player-back"
              onClick={back}
              type="button"
            >
              <ArrowLeftIcon aria-hidden="true" />
              Volver
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
              {state.playing ? "Pausa" : "Reanudar"}
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
              {state.muted ? "Activar sonido" : "Silencio"}
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
              Calidad: {qualityLabel(state.quality)}
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
              {preferences.chatVisible ? "Ocultar chat" : "Chat"}
            </button>
            <button
              className="button"
              data-nav
              data-nav-id="player-twitch"
              disabled={interaction !== undefined}
              onClick={() => void beginInteraction()}
              type="button"
            >
              <TwitchLogoIcon aria-hidden="true" />
              Controles de Twitch
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
  interacting: boolean,
  actions: { readonly play: () => void; readonly retry: () => void; readonly twitch: () => void },
): Notice | undefined => {
  if (interacting) {
    return {
      text: "Controles de Twitch: ↑ ↓ para moverte, OK para elegir y Atrás para volver.",
      tone: "info",
    }
  }
  if (state.phase === "error") {
    return {
      action: { id: "player-retry", label: "Reintentar", run: actions.retry },
      text: "No se pudo cargar el reproductor de Twitch. Comprueba la conexión.",
      tone: "warning",
    }
  }
  if (state.phase === "stalled") {
    return {
      action: { id: "player-retry", label: "Reintentar", run: actions.retry },
      text: "Twitch no responde.",
      tone: "warning",
    }
  }
  if (state.phase === "offline") {
    return { text: `${channel.displayName} no está en directo ahora.`, tone: "info" }
  }
  if (state.blocked) {
    return {
      action: { id: "player-play", label: "Reproducir", run: actions.play },
      text: "Twitch ha bloqueado el arranque.",
      tone: "warning",
    }
  }
  if (state.gateHint) {
    return {
      action: { id: "player-gate", label: "Abrir controles de Twitch", run: actions.twitch },
      text: "Twitch puede estar pidiendo que confirmes el contenido («Start Watching»).",
      tone: "info",
    }
  }
  if (state.phase === "loading") return { text: "Conectando con Twitch…", tone: "info" }
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
      <legend className="visually-hidden">Calidad</legend>
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
