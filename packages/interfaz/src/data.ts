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

// Lo que se sabe de la cuenta: lo que contesta window.api.auth.snapshot() o, si no contesta (sin red, Twitch caído),
// «unreachable»: no se ha podido comprobar, y la sesión puede seguir guardada. No es lo mismo que «error», que sí es una
// respuesta: la sesión ha caducado (y TwitchAuth ya la ha cerrado) o no se pudo vincular.
export type AuthState = AuthSnapshot | { readonly kind: "unreachable"; readonly message: string }

const UNREACHABLE_RETRY_MS = 30_000

// Polls only while a device code is waiting for approval on the phone.
export const useAuth = () => {
  const [auth, setAuth] = useState<AuthState | undefined>()
  const [busy, setBusy] = useState(false)
  // Vale la respuesta de la última comprobación: una anterior que se quedó esperando a la red no la pisa.
  const latest = useRef(0)
  const reload = useCallback(async () => {
    latest.current += 1
    const current = latest.current
    try {
      const snapshot = await window.api.auth.snapshot()
      if (current === latest.current) setAuth(snapshot)
    } catch (error) {
      if (current === latest.current) setAuth({ kind: "unreachable", message: errorMessage(error) })
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
  // Sin respuesta, se vuelve a comprobar sola al volver la red y, por si la red no avisa (Twitch caído), cada 30 s.
  useEffect(() => {
    if (auth?.kind !== "unreachable") return undefined
    const retry = (): void => void reload()
    const timer = setInterval(retry, UNREACHABLE_RETRY_MS)
    addEventListener("online", retry)
    return () => {
      clearInterval(timer)
      removeEventListener("online", retry)
    }
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

// Sin saber aún la cuenta, o sin poder comprobarla.
const unknownAccount = (auth: AuthState | undefined): boolean =>
  auth === undefined || auth.kind === "unreachable"

// Lo guardado vale mientras no se sabe la cuenta, o si resulta ser la misma.
export const savedFor = (
  saved: SavedHome | null | undefined,
  auth: AuthState | undefined,
): SavedHome | undefined =>
  saved != null &&
  (unknownAccount(auth) || (auth?.kind === "authenticated" && auth.login === saved.account.login))
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

// Lo guardado de hace menos de esto se enseña tal cual al abrir (otra pestaña, o volver enseguida). Más viejo, sus canales
// pueden no emitir ya: no se enseñan como si lo hicieran.
export const SAVED_HOME_FRESH_MS = 5 * 60_000

const LOADING: Resource<never> = { kind: "loading" }

// La forma de Inicio mientras llega lo de ahora, cuando lo guardado es viejo: cuántos directos había en cada lista (para
// pintar sus huecos vacíos; como mucho 24, más de lo que cabe a la vista) y los recientes, que son de este equipo, sin
// decir si emiten.
const SKETCH_LIMIT = 24
export type HomeSketch = {
  readonly following: number
  readonly popular: number
  readonly recents: readonly RecentChannel[]
}

// Inicio en la tele, la extensión y Android. Lo de ahora tarda unas décimas: los directos se piden ya al abrir, a la vez
// que se comprueba la cuenta, si lo guardado dice que la había (la sesión guarda su id con el token y Helix no espera a
// validarlo, TwitchSession). Mientras tanto:
// - lo guardado de la última vez con esa cuenta (window.api.home), si es de hace menos de 5 min;
// - si es más viejo, la forma de las listas, vacía (sketch), para que nada salte al llegar lo de ahora;
// - sin nada guardado, «cargando» hasta saber si hay cuenta: sin ella, Inicio enseñaría la bienvenida y los seguidos
//   como desconectados.
// Lo guardado deja de valer si la cuenta resulta ser otra, o ninguna, y se olvida al cerrar sesión. Si no se puede
// comprobar la cuenta (sin red), lo guardado sigue, sea de cuando sea, y las pantallas avisan de que es de la última vez,
// con «Reintentar» (unreachable).
export const useHome = (auth: AuthState | undefined) => {
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
  const known = !unknownAccount(auth)
  const shown = known ? auth : (usable?.account ?? auth)
  const signedIn = shown?.kind === "authenticated"
  // Con lo guardado de una cuenta, lo de ahora se pide sin esperar a comprobarla; sin red (unreachable), no se pide.
  // Al llegar la cuenta, la misma carga sigue si es la misma (la función no cambia); si es otra (otra página ha vinculado
  // otra mientras tanto), se pide otra vez, para no guardar lo de una como si fuera de la otra.
  const canLoad = known || (auth === undefined && usable !== undefined)
  const login = shown?.kind === "authenticated" ? shown.login : undefined
  const load = useMemo(
    () => (canLoad ? () => loadHome(login !== undefined) : undefined),
    [canLoad, login],
  )
  const home = useResource(load)
  const resource = useMemo((): Resource<HomeData> => {
    const current = home.resource
    // Lo pedido antes de saber la cuenta puede fallar porque la sesión ha caducado: eso lo dirá la cuenta.
    const failedEarly = auth === undefined && current.kind === "error"
    if (current.kind === "ready" || usable === undefined) return failedEarly ? LOADING : current
    // Lo guardado, si es reciente, o si no se puede comprobar la cuenta (con el aviso). Si falla la primera carga, como
    // cuando falla un refresco: se sigue viendo lo último bueno (el refresco periódico lo reintenta).
    if (auth?.kind === "unreachable" || Date.now() - usable.savedAt < SAVED_HOME_FRESH_MS) {
      return { kind: "ready", updatedAt: usable.savedAt, value: toHomeData(usable) }
    }
    // Viejo: su forma, vacía (sketch), hasta que llegue lo de ahora o falle.
    return failedEarly ? LOADING : current
  }, [auth, home.resource, usable])
  const sketch = useMemo(
    (): HomeSketch | undefined =>
      resource.kind === "loading" && usable !== undefined
        ? {
            following: Math.min(usable.following.length, SKETCH_LIMIT),
            popular: Math.min(usable.popular.length, SKETCH_LIMIT),
            recents: usable.recents,
          }
        : undefined,
    [resource, usable],
  )
  // Lo guardado, también en memoria: si luego no se puede comprobar la cuenta (al vincular otra, por ejemplo), vale lo
  // último de esta, nunca lo de una sesión ya cerrada.
  useEffect(() => {
    if (unknownAccount(auth)) return // sin saberla, ni se guarda ni se olvida: un fallo de red no es cerrar sesión
    // Sin cuenta, también si la sesión ha caducado (error: TwitchAuth ya la ha cerrado).
    if (auth?.kind !== "authenticated") {
      setSaved(null)
      void window.api.home.forget().catch(() => undefined)
    } else if (home.resource.kind === "ready") {
      const latest = toSavedHome(auth, home.resource.value, Date.now())
      setSaved(latest)
      void window.api.home.save(latest).catch(() => undefined)
    }
  }, [auth, home.resource])
  return {
    auth: shown,
    // Lo que se ve es lo guardado: aún no ha llegado lo de ahora.
    fromSaved: resource !== home.resource && resource.kind === "ready",
    known,
    // Aún leyendo lo guardado (unos milisegundos en la tele): ni «cargando» ni la bienvenida.
    reading: saved === undefined,
    refresh: home.refresh,
    resource,
    retry: home.retry,
    signedIn,
    sketch,
    // No se pudo comprobar la cuenta: el motivo, para el aviso con «Reintentar» (useAuth().reload).
    unreachable: auth?.kind === "unreachable" ? auth.message : undefined,
  }
}

export type Home = ReturnType<typeof useHome>

export const searchChannels = async (query: string): Promise<readonly ChannelCard[]> =>
  (await window.api.catalog.search({ first: 20, query })).items

// loaded: ya se han leído las guardadas. Hasta entonces, las de por defecto: un reproductor que se abre antes (un canal
// abierto por su dirección) debe esperar, o empezaría en Adaptativo y volvería a abrir el canal en el modo guardado.
export const usePreferences = () => {
  const [preferences, setPreferences] = useState<Preferences>({
    chatScale: "normal",
    chatVisible: true,
    latencyMode: "adaptativo",
  })
  const [loaded, setLoaded] = useState(false)
  // reload: otra página las ha cambiado (otra pestaña de la extensión).
  const reload = useCallback(() => {
    void window.api.preferences
      .get()
      .then((next) =>
        setPreferences((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        ),
      )
      .catch(() => undefined)
      .finally(() => setLoaded(true))
  }, [])
  useEffect(reload, [reload])
  const update = useCallback((patch: PreferencesPatch) => {
    setPreferences((current) => ({ ...current, ...patch }) as Preferences)
    void window.api.preferences.update(patch).then(setPreferences)
  }, [])
  return { loaded, preferences, reload, update }
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
