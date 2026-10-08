// Wrapper around Twitch's documented interactive embed (https://dev.twitch.tv/docs/embed/video-and-clips/).
// Only documented options, methods and events are used; nothing reaches inside the iframe.

export type TwitchPlayerOptions = {
  readonly autoplay: boolean
  readonly channel: string
  readonly height: "100%"
  readonly muted: boolean
  readonly parent: readonly ["localhost"]
  readonly width: "100%"
}

export interface TwitchPlayerInstance {
  readonly addEventListener: (event: string, listener: () => void) => void
  readonly getMuted: () => boolean
  readonly getQualities: () => unknown
  readonly getQuality: () => string
  readonly getVolume: () => number
  readonly isPaused: () => boolean
  readonly pause: () => void
  readonly play: () => void
  readonly setChannel: (channel: string) => void
  readonly setMuted: (muted: boolean) => void
  readonly setQuality: (qualityId: string) => void
}

export type TwitchQuality = {
  readonly id: string
  readonly label: string
}

// The documented string list and the official-forum group/name shape share this boundary.
export const normalizeTwitchQualities = (value: unknown): readonly TwitchQuality[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry: unknown): TwitchQuality[] => {
    if (typeof entry === "string" && entry.trim() !== "") {
      return [{ id: entry, label: entry }]
    }
    if (
      typeof entry === "object" &&
      entry !== null &&
      "group" in entry &&
      typeof entry.group === "string" &&
      entry.group.trim() !== "" &&
      "name" in entry &&
      typeof entry.name === "string" &&
      entry.name.trim() !== ""
    ) {
      return [{ id: entry.group, label: entry.name }]
    }
    return []
  })
}

type TwitchPlayerConstructor = {
  new (elementId: string, options: TwitchPlayerOptions): TwitchPlayerInstance
  readonly OFFLINE: string
  readonly ONLINE: string
  readonly PAUSE: string
  readonly PLAY: string
  readonly PLAYBACK_BLOCKED: string
  readonly PLAYING: string
  readonly READY: string
}

type TwitchPlayerApi = {
  readonly Player: TwitchPlayerConstructor
}

declare global {
  interface Window {
    Twitch?: TwitchPlayerApi
  }
}

let playerApiPromise: Promise<TwitchPlayerApi> | undefined

export const createTwitchPlayerOptions = (channel: string): TwitchPlayerOptions => ({
  autoplay: true,
  channel,
  height: "100%",
  // Requesting sound is allowed in Electron; Twitch still decides and reports it back.
  muted: false,
  parent: ["localhost"],
  width: "100%",
})

// A download that never finishes must fail too, so that Retry starts a fresh one.
export const SDK_TIMEOUT_MS = 15_000

export const loadTwitchPlayerApi = (): Promise<TwitchPlayerApi> => {
  if (playerApiPromise !== undefined) return playerApiPromise
  if (window.Twitch !== undefined) return Promise.resolve(window.Twitch)

  const attempt = new Promise<TwitchPlayerApi>((resolve, reject) => {
    const script = document.createElement("script")
    script.async = true
    script.src = "https://player.twitch.tv/js/embed/v1.js"
    const timeout = setTimeout(() => fail("Twitch Player API timed out"), SDK_TIMEOUT_MS)
    const cleanup = (): void => {
      clearTimeout(timeout)
      script.removeEventListener("load", onLoad)
      script.removeEventListener("error", onError)
    }
    const fail = (message: string): void => {
      cleanup()
      script.remove()
      reject(new TypeError(message))
    }
    const onLoad = (): void => {
      if (window.Twitch === undefined) {
        fail("Twitch Player API did not initialize")
        return
      }
      cleanup()
      resolve(window.Twitch)
    }
    const onError = (): void => fail("Twitch Player API failed to load")
    script.addEventListener("load", onLoad)
    script.addEventListener("error", onError)
    document.head.append(script)
  }).catch((cause: unknown) => {
    // Only this attempt may release its single-flight slot.
    if (playerApiPromise === attempt) playerApiPromise = undefined
    throw cause
  })
  playerApiPromise = attempt
  return attempt
}
