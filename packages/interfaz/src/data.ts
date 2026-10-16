import type {
  AppStatus,
  AuthSnapshot,
  ChannelCard,
  Preferences,
  PreferencesPatch,
  RecentChannel,
  SavedHome,
  StreamCard,
} from "@goodttv/contratos"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePlatform } from "./platform"

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
  // What another loader returned (signed out, then in) does not answer the new one: back to loading, in this same
  // render, so it is never shown as if it did. Functions go in state through updaters, or React would call them.
  const [loaded, setLoaded] = useState(() => load)
  if (loaded !== load) {
    setLoaded(() => load)
    setResource({ kind: "loading" })
  }
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

type Account = Extract<AuthSnapshot, { readonly kind: "authenticated" }>

// Lo guardado vale mientras no se sabe la cuenta, o si resulta ser la misma.
export const savedFor = (
  saved: SavedHome | null | undefined,
  auth: AuthSnapshot | undefined,
): SavedHome | undefined =>
  saved != null &&
  (auth === undefined || (auth.kind === "authenticated" && auth.login === saved.account.login))
    ? saved
    : undefined

export const toHomeData = (saved: SavedHome): HomeData => ({
  following: saved.following,
  popular: saved.popular,
  recentLive: new Map(saved.recentLive.map((stream) => [stream.userLogin, stream])),
  recents: saved.recents,
})

export const toSavedHome = (account: Account, home: HomeData, savedAt: number): SavedHome => ({
  account,
  following: [...home.following],
  popular: [...home.popular],
  recentLive: [...home.recentLive.values()],
  recents: [...home.recents],
  savedAt,
})

// Inicio en la tele y en la extensión. Comprobar la cuenta y pedir los directos a Twitch tarda alrededor de un segundo:
// mientras tanto, lo que se vio la última vez con esa cuenta (window.api.home), que se sustituye en cuanto llega lo de
// ahora. Deja de valer si la cuenta resulta ser otra, o ninguna, y se olvida al cerrar sesión. Sin nada guardado,
// «cargando» hasta saber si hay cuenta: sin ella, Inicio enseñaría la bienvenida y los seguidos como desconectados.
export const useHome = (auth: AuthSnapshot | undefined) => {
  // undefined mientras se lee: la tele lo pide por IPC; la extensión lo lee sin esperar (la plataforma).
  const { savedHome } = usePlatform()
  const [saved, setSaved] = useState<SavedHome | null | undefined>(savedHome)
  useEffect(() => {
    if (saved !== undefined) return undefined
    let active = true
    window.api.home.saved().then(
      (value) => {
        if (active) setSaved(value)
      },
      () => {
        if (active) setSaved(null)
      },
    )
    return () => {
      active = false
    }
  }, [saved])
  const usable = savedFor(saved, auth)
  const shown = auth ?? usable?.account
  const signedIn = shown?.kind === "authenticated"
  const known = auth !== undefined
  const load = useMemo(() => (known ? () => loadHome(signedIn) : undefined), [known, signedIn])
  const home = useResource(load)
  // Si falla la primera carga, como cuando falla un refresco: se sigue viendo lo último bueno (el refresco periódico
  // lo reintenta).
  const resource = useMemo(
    (): Resource<HomeData> =>
      home.resource.kind !== "ready" && usable !== undefined
        ? { kind: "ready", updatedAt: usable.savedAt, value: toHomeData(usable) }
        : home.resource,
    [home.resource, usable],
  )
  useEffect(() => {
    if (auth === undefined || auth.kind === "error") return // un fallo de red no es cerrar sesión
    if (auth.kind !== "authenticated") void window.api.home.forget().catch(() => undefined)
    else if (home.resource.kind === "ready") {
      void window.api.home
        .save(toSavedHome(auth, home.resource.value, Date.now()))
        .catch(() => undefined)
    }
  }, [auth, home.resource])
  return {
    auth: shown,
    // Lo que se ve es lo guardado: aún no ha llegado lo de ahora.
    fromSaved: resource !== home.resource,
    known,
    // Aún leyendo lo guardado (unos milisegundos en la tele): ni «cargando» ni la bienvenida.
    reading: saved === undefined,
    refresh: home.refresh,
    resource,
    retry: home.retry,
    signedIn,
  }
}

export type Home = ReturnType<typeof useHome>

export const searchChannels = async (query: string): Promise<readonly ChannelCard[]> =>
  (await window.api.catalog.search({ first: 20, query })).items

export const usePreferences = () => {
  const [preferences, setPreferences] = useState<Preferences>({
    chatScale: "normal",
    chatVisible: true,
    latencyMode: "adaptativo",
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
