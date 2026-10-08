import { useCallback, useEffect, useRef, useState } from "react"
import type {
  AppStatus,
  AuthSnapshot,
  ChannelCard,
  Preferences,
  PreferencesPatch,
  RecentChannel,
  StreamCard,
} from "../../shared/contracts"

// Data hooks. Every remote list has the same four states so screens can always offer a way on:
// loading (first load), ready (possibly empty), error (with retry) and refreshing in place.

export type Resource<Value> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly updatedAt: number; readonly value: Value }
  | { readonly kind: "error"; readonly message: string }

const errorMessage = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)
  // Electron prefixes errors thrown in main; keep the useful tail for the details line.
  return text.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "")
}

export const useResource = <Value>(load: (() => Promise<Value>) | undefined) => {
  const [resource, setResource] = useState<Resource<Value>>({ kind: "loading" })
  const generation = useRef(0)
  const run = useCallback(async () => {
    if (load === undefined) return
    generation.current += 1
    const current = generation.current
    try {
      const value = await load()
      if (current === generation.current)
        setResource({ kind: "ready", updatedAt: Date.now(), value })
    } catch (error) {
      // A failed background refresh keeps showing the last good data.
      if (current === generation.current) {
        setResource((previous) =>
          previous.kind === "ready" ? previous : { kind: "error", message: errorMessage(error) },
        )
      }
    }
  }, [load])
  const retry = useCallback(() => {
    setResource({ kind: "loading" })
    void run()
  }, [run])
  useEffect(() => {
    void run()
  }, [run])
  return { refresh: run, resource, retry }
}

export const useAppStatus = (): AppStatus | undefined => {
  const [status, setStatus] = useState<AppStatus>()
  useEffect(() => {
    void window.api.app.status().then(setStatus)
  }, [])
  return status
}

// Polls only while a device code is waiting for approval on the phone.
export const useAuth = () => {
  const [auth, setAuth] = useState<AuthSnapshot | undefined>()
  const [busy, setBusy] = useState(false)
  const reload = useCallback(async () => {
    try {
      setAuth(await window.api.auth.snapshot())
    } catch (error) {
      setAuth({ kind: "error", message: errorMessage(error) })
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  useEffect(() => {
    if (auth?.kind !== "authorizing") return undefined
    const timer = setInterval(() => void reload(), auth.challenge.intervalSeconds * 1000)
    return () => clearInterval(timer)
  }, [auth, reload])
  const begin = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.auth.begin()
      await reload()
    } catch (error) {
      setAuth({ kind: "error", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }, [reload])
  const logout = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.auth.logout()
    } finally {
      setBusy(false)
      await reload()
    }
  }, [reload])
  return { auth, begin, busy, logout, reload }
}

export type HomeData = {
  readonly following: readonly StreamCard[]
  readonly popular: readonly StreamCard[]
  readonly recentLive: ReadonlyMap<string, StreamCard>
  readonly recents: readonly RecentChannel[]
}

const language = (): string => navigator.language.slice(0, 2).toLowerCase() || "es"

export const loadHome = async (signedIn: boolean): Promise<HomeData> => {
  const recents = await window.api.recents.list()
  if (!signedIn) return { following: [], popular: [], recentLive: new Map(), recents }
  const [following, popular, recentStreams] = await Promise.all([
    window.api.catalog.followed({ first: 100 }),
    window.api.catalog.live({ first: 24, language: language() }),
    window.api.catalog.streamsByLogin(recents.map((recent) => recent.login)),
  ])
  return {
    following: following.items,
    popular: popular.items,
    recentLive: new Map(recentStreams.map((stream) => [stream.userLogin, stream])),
    recents,
  }
}

export const searchChannels = async (query: string): Promise<readonly ChannelCard[]> =>
  (await window.api.catalog.search({ first: 20, query })).items

export const usePreferences = () => {
  const [preferences, setPreferences] = useState<Preferences>({
    chatScale: "normal",
    chatVisible: true,
  })
  useEffect(() => {
    void window.api.preferences.get().then(setPreferences)
  }, [])
  const update = useCallback((patch: PreferencesPatch) => {
    setPreferences((current) => ({ ...current, ...patch }) as Preferences)
    void window.api.preferences.update(patch).then(setPreferences)
  }, [])
  return { preferences, update }
}

// Spanish formatting with a dot for thousands. Intl's "es-ES" leaves four-digit numbers ungrouped
// ("9877"), which reads worse in a list of viewer counts.
export const formatViewers = (count: number): string =>
  String(Math.trunc(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")

export const formatUptime = (startedAt: string, now = Date.now()): string => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000))
  const hours = Math.floor(minutes / 60)
  return hours === 0 ? `${minutes} min` : `${hours} h ${String(minutes % 60).padStart(2, "0")} min`
}
