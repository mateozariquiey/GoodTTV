import type { LatencyMode } from "@goodttv/contratos"
import {
  type Channel,
  fromRecent,
  fromStream,
  sortFollowed,
  useAppStatus,
  useAuth,
  useFollowedOrder,
  useHome,
  useOpeningPrewarm,
  usePreferences,
} from "@goodttv/interfaz"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { android } from "../api"
import { Busqueda } from "./Busqueda"
import { Canal } from "./Canal"
import { Cuenta } from "./Cuenta"
import { Inicio } from "./Inicio"
import { rutaDelVod } from "./media3"
import { aInicio, navigate, useRoute } from "./rutas"
import { Vod } from "./Vod"

// GoodTTV en el teléfono: Inicio, la búsqueda, el canal, los VOD y la cuenta, según la dirección (rutas.ts), sin barra
// de pestañas. Reutiliza de @goodttv/interfaz los datos y el chat; las pantallas son propias, para el dedo (las de la
// tele van con mando y las de la extensión, con ratón). Inicio no se desmonta: las demás pantallas van encima, y al
// volver está donde se dejó. El canal o el VOD que se deja sigue en una esquina (lo pinta la app, MainActivity.kt), y
// desde allí se vuelve a él.

type Mini =
  | { readonly accion: "ampliar"; readonly canal: string }
  | { readonly accion: "ampliar"; readonly vod: string }
  | { readonly accion: "cerrar" }

const REFRESH_MS = 120_000 // como Inicio en la tele y la extensión

const prewarmInApp = (login: string, mode: LatencyMode): void =>
  android.canalPrecalentar(login, mode)

export const App = () => {
  const route = useRoute()
  const account = useAuth()
  const status = useAppStatus()
  const { loaded: preferencesLoaded, preferences, update } = usePreferences()
  // Al abrir, lo que se vio la última vez mientras se comprueba la cuenta y llega lo de ahora (useHome).
  const home = useHome(account.auth)
  const { auth, refresh, resource, signedIn, sketch, unreachable } = home
  useEffect(() => {
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])
  // Al volver a Inicio, al día: el canal que acabas de ver ya está en «Seguir viendo». Al abrir, ya carga useHome.
  const atHome = route.view === "home"
  const wasHome = useRef(atHome)
  useEffect(() => {
    if (atHome && !wasHome.current) void refresh()
    wasHome.current = atHome
  }, [atHome, refresh])

  const data = resource.kind === "ready" ? resource.value : undefined
  // Tus seguidos, por espectadores o primero los que más ves (watch-time.ts), en Inicio y para las flechas del canal.
  const [order, setOrder] = useFollowedOrder()
  const following = useMemo(
    () =>
      sortFollowed(
        data?.following.map(fromStream) ?? [],
        order,
        data?.recents.map((recent) => recent.login),
      ),
    [data, order],
  )
  const popular = useMemo(() => data?.popular.map(fromStream) ?? [], [data])
  // Con lo guardado de hace rato, los recientes sin decir si emiten, hasta lo de ahora (sketch).
  const recents = useMemo(
    () =>
      data?.recents.map((recent) => fromRecent(recent, data.recentLive.get(recent.login))) ??
      sketch?.recents.map((recent) => fromRecent(recent, undefined)) ??
      [],
    [data, sketch],
  )

  // Al abrir en Inicio, se precalienta el último canal visto si emite (REN-1, como en la extensión), en el motor de la
  // app: al tocarlo, Media3 arranca con el empalme ya abierto.
  useOpeningPrewarm(atHome, recents[0], preferences.latencyMode, preferencesLoaded, prewarmInApp)

  // El último canal abierto desde una lista o la búsqueda, con lo que se sabía de él; si se llega por la dirección,
  // lo que digan las listas.
  const [opened, setOpened] = useState<Channel>()
  const open = useCallback((channel: Channel) => {
    setOpened(channel)
    navigate({ login: channel.login, view: "channel" })
  }, [])
  const channel = useMemo((): Channel | undefined => {
    if (route.view !== "channel") return undefined
    if (opened?.login === route.login) return opened
    const known = [...following, ...popular, ...recents].find((each) => each.login === route.login)
    return known ?? { displayName: route.login, login: route.login }
  }, [following, opened, popular, recents, route])
  // Las flechas del canal recorren la lista de la que salió, como ↑ ↓ en la tele y la extensión.
  const lineup = useMemo(() => {
    const login = channel?.login
    for (const list of [following, popular, recents.filter((each) => each.live === true)]) {
      if (list.some((each) => each.login === login)) return list
    }
    return []
  }, [channel, following, popular, recents])
  const step = useCallback((next: Channel) => {
    setOpened(next)
    navigate({ login: next.login, view: "channel" }, true)
  }, [])

  // Lo escrito en la búsqueda sigue al volver de un canal.
  const [query, setQuery] = useState("")

  // El minirreproductor (o el PiP): ampliar es volver al canal o al VOD; si se cierra estando en él (el PiP), a Inicio,
  // sin pasar por el historial (atrás podría montar otro canal y abrirlo, con la app ya en segundo plano).
  const enCanal = route.view === "channel" || route.view === "vod"
  useEffect(() => {
    const onMini = (event: Event): void => {
      const mini = (event as CustomEvent<Mini>).detail
      if (mini.accion === "cerrar") {
        if (enCanal) aInicio()
      } else if ("canal" in mini) navigate({ login: mini.canal, view: "channel" })
      else if (location.hash !== rutaDelVod(mini.vod)) location.hash = rutaDelVod(mini.vod)
    }
    addEventListener("goodttv-mini", onMini)
    return () => removeEventListener("goodttv-mini", onMini)
  }, [enCanal])

  return (
    <div className="app">
      <Inicio
        account={auth?.kind === "authenticated" ? auth : undefined}
        following={following}
        hidden={!atHome}
        onOpen={open}
        onOrder={setOrder}
        onRetry={home.retry}
        onRetryAccount={account.reload}
        order={order}
        popular={popular}
        recents={recents}
        resource={resource}
        signedIn={signedIn}
        sketch={sketch}
        unreachable={unreachable}
      />
      {route.view === "search" ? <Busqueda onOpen={open} onQuery={setQuery} query={query} /> : null}
      {route.view === "account" ? (
        <Cuenta
          account={account}
          onPreferences={update}
          preferences={preferences}
          status={status}
        />
      ) : null}
      {route.view === "vod" ? (
        <Vod at={route.at} id={route.id} live={route.live} preferences={preferences} />
      ) : null}
      {channel === undefined ? null : (
        // Sin key por canal: al cambiar con las flechas se queda montado (el chat en horizontal sigue como estaba).
        <Canal
          canChat={auth?.kind === "authenticated" && auth.canChat === true}
          channel={channel}
          lineup={lineup}
          onStep={step}
          preferences={preferences}
          preferencesLoaded={preferencesLoaded}
          signedIn={signedIn}
        />
      )}
    </div>
  )
}
