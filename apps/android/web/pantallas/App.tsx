import type { LatencyMode } from "@goodttv/contratos"
import {
  type Channel,
  channelToShow,
  lineupOf,
  useAppStatus,
  useAuth,
  useFollowedOrder,
  useHome,
  useHomeChannels,
  useIdioma,
  useOpeningPrewarm,
  usePreferences,
  useRefreshOnReturnHome,
  useRefreshWhileVisible,
} from "@goodttv/interfaz"
import { useCallback, useEffect, useMemo, useState } from "react"
import { android } from "../api"
import { Busqueda } from "./Busqueda"
import { Canal } from "./Canal"
import { Categoria, Categorias } from "./Categorias"
import { Cuenta } from "./Cuenta"
import { Inicio } from "./Inicio"
import { rutaDelVod } from "./media3"
import { aInicio, navigate, routeHash, useRoute } from "./rutas"
import { Vod } from "./Vod"

// GoodTTV en el teléfono: Inicio, la búsqueda, las categorías, el canal, los VOD y la cuenta, según la dirección (rutas.ts), sin barra
// de pestañas. Reutiliza de @goodttv/interfaz los datos y el chat; las pantallas son propias, para el dedo (las de la
// TV van con mando y las de la extensión, con ratón). Inicio no se desmonta: las demás pantallas van encima, y al
// volver está donde se dejó. El canal o el VOD que se deja sigue en una esquina (lo pinta la app, MainActivity.kt), y
// desde allí se vuelve a él.

type Mini =
  | { readonly accion: "ampliar"; readonly canal: string }
  | { readonly accion: "ampliar"; readonly vod: string }
  | { readonly accion: "cerrar" }

const REFRESH_MS = 120_000 // como Inicio en la TV y la extensión

const prewarmInApp = (login: string, mode: LatencyMode): void =>
  android.canalPrecalentar(login, mode)

export const App = () => {
  // Lo poco que pinta la app (la esquina, el aviso de la imagen en imagen) va en el idioma de la página.
  const idioma = useIdioma()
  useEffect(() => android.fijarIdioma(idioma), [idioma])
  const route = useRoute()
  const account = useAuth()
  const status = useAppStatus()
  const { loaded: preferencesLoaded, preferences, update } = usePreferences()
  // Al abrir, lo que se vio la última vez mientras se comprueba la cuenta y llega lo de ahora (useHome).
  const home = useHome(account.auth)
  const { auth, refresh, resource, signedIn, sketch, unreachable } = home
  useRefreshWhileVisible(refresh, REFRESH_MS)
  const atHome = route.view === "home"
  useRefreshOnReturnHome(atHome, refresh)

  const data = resource.kind === "ready" ? resource.value : undefined
  // Tus seguidos, por espectadores o primero los que más ves (watch-time.ts), en Inicio y para las flechas del canal.
  const [order, setOrder] = useFollowedOrder()
  const lists = useHomeChannels(data, sketch, order)
  const { following, popular, recents } = lists

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
  const channel = useMemo(
    (): Channel | undefined =>
      route.view === "channel" ? channelToShow(route.login, opened, lists) : undefined,
    [lists, opened, route],
  )
  // Las flechas del canal recorren la lista de la que salió, como ↑ ↓ en la TV y la extensión.
  const lineup = useMemo(() => lineupOf(channel?.login, lists), [channel, lists])
  const step = useCallback((next: Channel) => {
    setOpened(next)
    navigate({ login: next.login, view: "channel" }, true)
  }, [])

  // Lo escrito en la búsqueda sigue al volver de un canal.
  const [query, setQuery] = useState("")

  // El directorio (D49) sigue montado debajo de lo que se abre desde él, como Inicio: al volver de un canal, la lista de
  // su categoría está donde se dejó, y al volver de una categoría, el directorio también. Se desmonta al salir de él
  // (a Inicio, a la búsqueda o a la cuenta).
  const hash = routeHash(route)
  const [directorio, setDirectorio] = useState<{
    readonly hash: string
    readonly lista: boolean
    readonly slug?: string
  }>({ hash: "", lista: false })
  if (directorio.hash !== hash) {
    setDirectorio(
      route.view === "categories"
        ? { hash, lista: true }
        : route.view === "category"
          ? { hash, lista: directorio.lista, slug: route.slug }
          : route.view === "channel" || route.view === "vod"
            ? { ...directorio, hash }
            : { hash, lista: false },
    )
  }

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
      {directorio.lista ? <Categorias hidden={route.view !== "categories"} /> : null}
      {directorio.slug === undefined ? null : (
        <Categoria hidden={route.view !== "category"} onOpen={open} slug={directorio.slug} />
      )}
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
