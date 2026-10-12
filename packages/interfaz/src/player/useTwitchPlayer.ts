import { useCallback, useEffect, useRef, useState } from "react"
import {
  createTwitchPlayerOptions,
  loadTwitchPlayerApi,
  normalizeTwitchQualities,
  type TwitchPlayerInstance,
  type TwitchQuality,
} from "../twitch-player"

// Keeps three facts apart, because Twitch's events mix them:
// - availability: is the SDK loaded and is the channel live (READY, ONLINE, OFFLINE)?
// - playback: is video moving (PLAY, PLAYING, PAUSE, PLAYBACK_BLOCKED)?
// - intent: did the *viewer* pause? Only their pause is respected on recovery.

export type PlayerPhase = "loading" | "ready" | "offline" | "error" | "stalled"

export type PlayerState = {
  readonly blocked: boolean
  // Twitch reported muted although sound was requested: often its content gate. A hint only.
  readonly gateHint: boolean
  readonly muted: boolean
  readonly phase: PlayerPhase
  readonly playing: boolean
  readonly qualities: readonly TwitchQuality[]
  readonly quality: string
}

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

export const useTwitchPlayer = (
  container: React.RefObject<HTMLElement | null>,
  channel: string,
  // Falso mientras se usa el reproductor propio (useHlsPlayer): no crea el embed.
  enabled = true,
) => {
  const [state, setState] = useState<PlayerState>(INITIAL)
  const [attempt, setAttempt] = useState(0)
  const playerRef = useRef<TwitchPlayerInstance | undefined>(undefined)
  const userPaused = useRef(false)
  const userMuted = useRef(false)
  const channelRef = useRef(channel)
  channelRef.current = channel

  const patch = useCallback((next: Partial<PlayerState>) => {
    setState((current) => ({ ...current, ...next }))
  }, [])

  const refresh = useCallback(
    (player: TwitchPlayerInstance, next: Partial<PlayerState> = {}) => {
      const muted = player.getMuted()
      patch({
        gateHint: muted && !userMuted.current,
        muted,
        qualities: normalizeTwitchQualities(player.getQualities()),
        quality: player.getQuality(),
        ...next,
      })
    },
    [patch],
  )

  // Create the player once per mount (or retry). Channel changes reuse it through setChannel.
  useEffect(() => {
    let active = true
    const element = container.current
    if (!enabled || element === null) return undefined
    setState(INITIAL)
    void window.api.player.setWatching(true)
    void loadTwitchPlayerApi()
      .then((api) => {
        if (!active) return
        const host = document.createElement("div")
        host.id = `twitch-player-${attempt}`
        host.className = "twitch-player-host"
        element.replaceChildren(host)
        const player = new api.Player(host.id, createTwitchPlayerOptions(channelRef.current))
        playerRef.current = player
        const on = (event: string, listener: () => void) =>
          player.addEventListener(event, () => {
            if (active && playerRef.current === player) listener()
          })
        on(api.Player.READY, () => refresh(player))
        on(api.Player.ONLINE, () => refresh(player, { phase: "ready" }))
        on(api.Player.OFFLINE, () => patch({ phase: "offline", playing: false }))
        on(api.Player.PLAY, () => patch({ blocked: false, playing: true }))
        on(api.Player.PLAYING, () =>
          refresh(player, { blocked: false, phase: "ready", playing: true }),
        )
        on(api.Player.PAUSE, () => patch({ playing: false }))
        on(api.Player.PLAYBACK_BLOCKED, () => patch({ blocked: true, playing: false }))
      })
      .catch(() => {
        if (active) patch({ phase: "error" })
      })
    return () => {
      active = false
      playerRef.current?.pause()
      playerRef.current = undefined
      element.replaceChildren()
      void window.api.player.setWatching(false)
    }
  }, [attempt, container, enabled, patch, refresh])

  // Switching channel keeps the player instance (documented setChannel).
  const firstChannel = useRef(true)
  useEffect(() => {
    if (firstChannel.current) {
      firstChannel.current = false
      return
    }
    userPaused.current = false
    patch({ blocked: false, gateHint: false, phase: "loading", playing: false })
    playerRef.current?.setChannel(channel)
  }, [channel, patch])

  // A channel that never answers is reported instead of spinning forever.
  useEffect(() => {
    if (!enabled || state.phase !== "loading") return undefined
    const timer = setTimeout(() => patch({ phase: "stalled" }), STALL_MS)
    return () => clearTimeout(timer)
  }, [enabled, state.phase, patch])

  // Twitch pauses an embed whose page becomes hidden (screen blanking, suspend) and does not
  // resume. Resume when visible again, unless the viewer paused on purpose.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState !== "visible") return
      const player = playerRef.current
      if (player === undefined || userPaused.current) return
      setTimeout(() => {
        if (playerRef.current === player && !userPaused.current && player.isPaused()) player.play()
      }, 500)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  // While the hint is shown, notice when the viewer unmutes through Twitch's own controls.
  useEffect(() => {
    if (!state.gateHint) return undefined
    const timer = setInterval(() => {
      const player = playerRef.current
      if (player !== undefined && !player.getMuted()) refresh(player)
    }, 2000)
    return () => clearInterval(timer)
  }, [state.gateHint, refresh])

  const play = useCallback(() => {
    userPaused.current = false
    playerRef.current?.play()
  }, [])
  const pause = useCallback(() => {
    userPaused.current = true
    playerRef.current?.pause()
  }, [])
  const toggle = useCallback(() => {
    const player = playerRef.current
    if (player === undefined) return
    // Ads and Twitch's own controls change state silently, so ask the player itself.
    if (player.isPaused()) play()
    else pause()
  }, [pause, play])
  const toggleMuted = useCallback(() => {
    const player = playerRef.current
    if (player === undefined) return
    const muted = !player.getMuted()
    userMuted.current = muted
    player.setMuted(muted)
    patch({ gateHint: false, muted })
  }, [patch])
  const setQuality = useCallback(
    (quality: string) => {
      playerRef.current?.setQuality(quality)
      patch({ quality })
    },
    [patch],
  )
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  // After the viewer used Twitch's own controls, their pause (or not) becomes the intent.
  const syncIntent = useCallback(() => {
    const player = playerRef.current
    if (player !== undefined) userPaused.current = player.isPaused()
  }, [])

  return { pause, play, retry, setQuality, state, syncIntent, toggle, toggleMuted }
}

export type TwitchPlayerControls = ReturnType<typeof useTwitchPlayer>
