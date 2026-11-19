import {
  type Channel,
  channelToShow,
  lineupOf,
  useAppStatus,
  useAuth,
  useFollowedOrder,
  useHome,
  useHomeChannels,
  useOpeningPrewarm,
  usePreferences,
  useRefreshOnReturnHome,
  useRefreshWhileVisible,
} from "@goodttv/interfaz"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CategoriesView, CategoryView } from "./CategoriesView"
import { ChannelView } from "./ChannelView"
import {
  addToGrid,
  gridEnabled,
  gridFrom,
  lastActive,
  lastGrid,
  rememberActive,
  rememberGrid,
} from "./cuadricula"
import { GridView } from "./GridView"
import { HomeView } from "./HomeView"
import { usePointerPrewarm } from "./prewarm"
import { navigate, type Route, useRoute } from "./routes"
import { SettingsView } from "./SettingsView"
import { Sidebar } from "./Sidebar"
import { contextOf, shortcutFor, watchPointerFocus } from "./shortcuts"
import { TopBar } from "./TopBar"
import { VodView } from "./VodView"

// GoodTTV en el ordenador: barra con búsqueda, columna de seguidos y la vista de la dirección (Inicio, un canal o
// Ajustes). Reutiliza de @goodttv/interfaz los datos, el reproductor y el chat; las pantallas son propias, para
// ratón y teclado (docs/arquitectura.md).

const REFRESH_MS = 120_000 // como Inicio en la TV

export const Desktop = () => {
  const address = useRoute()
  // Sin la cuadrícula activada (EXT-6) o sin canales, su dirección es Inicio, como cualquier otra que no se conoce.
  const gridOn = gridEnabled()
  const route: Route =
    address.view === "grid" && (!gridOn || address.logins.length === 0) ? { view: "home" } : address
  const account = useAuth()
  const status = useAppStatus()
  const {
    loaded: preferencesLoaded,
    preferences,
    reload: reloadPreferences,
    update,
  } = usePreferences()
  // Al abrir, lo que se vio la última vez mientras se comprueba la cuenta y llega lo de ahora (useHome).
  const home = useHome(account.auth)
  const { auth, refresh, resource, signedIn, sketch, unreachable } = home
  useRefreshWhileVisible(refresh, REFRESH_MS)
  // Lo que cambia otra pestaña (goodttv.tsx): entrar o salir de la cuenta, o las preferencias.
  const { reload: reloadAccount } = account
  useEffect(() => {
    const onChange = (event: Event): void => {
      const what = (event as CustomEvent<string>).detail
      if (what === "cuenta") void reloadAccount()
      else if (what === "preferencias") reloadPreferences()
    }
    addEventListener("goodttv-cambio", onChange)
    return () => removeEventListener("goodttv-cambio", onChange)
  }, [reloadAccount, reloadPreferences])
  const atHome = route.view === "home"
  useRefreshOnReturnHome(atHome, refresh)

  const data = resource.kind === "ready" ? resource.value : undefined
  // Tus seguidos, por espectadores o primero los que más ves (watch-time.ts), en la columna, en Inicio y para ↑ ↓.
  const [order, setOrder] = useFollowedOrder()
  const lists = useHomeChannels(data, sketch, order)
  const { following, popular, recents } = lists

  // El último canal abierto desde una lista o la búsqueda, con lo que se sabía de él; si se llega por la dirección,
  // lo que digan las listas.
  const [opened, setOpened] = useState<Channel>()
  // En la cuadrícula, lo que se elige en la columna o en la búsqueda entra en ella.
  const [gridActive, setGridActiveState] = useState<string | undefined>(() => lastActive())
  const setGridActive = useCallback((login: string) => {
    setGridActiveState(login)
    rememberActive(login)
  }, [])
  const gridLogins = route.view === "grid" ? route.logins : null
  useEffect(() => {
    if (gridLogins !== null) rememberGrid(gridLogins)
  }, [gridLogins])
  const open = useCallback(
    (channel: Channel) => {
      setOpened(channel)
      if (gridLogins === null) navigate({ login: channel.login, view: "channel" })
      else navigate({ logins: addToGrid(gridLogins, channel.login, gridActive), view: "grid" })
    },
    [gridActive, gridLogins],
  )
  const channel = useMemo(
    (): Channel | undefined =>
      route.view === "channel" ? channelToShow(route.login, opened, lists) : undefined,
    [lists, opened, route],
  )
  // ↑ ↓ en el reproductor recorren la lista de la que salió el canal.
  const lineup = useMemo(() => lineupOf(channel?.login, lists), [channel, lists])

  const knownChannels = useMemo(
    () => [...following, ...popular, ...recents, ...(opened === undefined ? [] : [opened])],
    [following, opened, popular, recents],
  )
  const offline = useMemo(
    () => new Set(recents.filter((each) => each.live === false).map((each) => each.login)),
    [recents],
  )
  usePointerPrewarm(channel?.login, offline, preferences.latencyMode)
  useOpeningPrewarm(atHome, recents[0], preferences.latencyMode, preferencesLoaded)

  const [collapsed, setCollapsed] = useState(false)
  const [theater, setTheater] = useState(false)
  useEffect(() => {
    if (route.view !== "channel" && route.view !== "vod" && route.view !== "grid") setTheater(false)
  }, [route.view])
  const search = useRef<HTMLInputElement>(null)

  // Espacio es del control enfocado solo si se llegó a él con el teclado (shortcuts.ts).
  useEffect(() => watchPointerFocus(), [])

  // Atajos de toda la ventana; los del reproductor los atiende ChannelView.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const shortcut = shortcutFor(event, contextOf(event.target))
      if (shortcut === "search") {
        event.preventDefault()
        search.current?.focus()
      } else if (shortcut === "back" && !event.defaultPrevented) {
        // A pantalla completa, Esc es para salir de ella (lo hace el navegador): ni sale del modo teatro, que se queda
        // con el chat al lado a pantalla completa, ni vuelve a Inicio.
        if (document.fullscreenElement !== null) return
        if (theater) setTheater(false)
        else if (route.view !== "home") navigate({ view: "home" })
      }
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [route.view, theater])

  return (
    <div
      className={`desktop${theater && (channel !== undefined || route.view === "vod" || route.view === "grid") ? " desktop--theater" : ""}${collapsed ? " desktop--collapsed" : ""}`}
    >
      <TopBar
        account={auth?.kind === "authenticated" ? auth : undefined}
        inCategories={route.view === "categories" || route.view === "category"}
        onOpen={open}
        searchRef={search}
      />
      <Sidebar
        channels={following}
        collapsed={collapsed}
        current={channel?.login}
        failed={resource.kind === "error" || unreachable !== undefined}
        loading={resource.kind === "loading" && unreachable === undefined}
        onAdd={
          gridOn && route.view !== "grid"
            ? (added) => {
                setOpened(added)
                const base = gridFrom(channel?.login, lastGrid())
                const sounding = channel?.login ?? gridActive ?? base[0] ?? added.login
                setGridActive(sounding)
                navigate({ logins: addToGrid(base, added.login, sounding), view: "grid" })
              }
            : undefined
        }
        onCollapse={() => setCollapsed((value) => !value)}
        onOpen={open}
        onOrder={setOrder}
        order={order}
        placeholders={sketch?.following ?? 0}
        signedIn={signedIn}
      />
      <main className="desktop__main">
        {channel !== undefined ? (
          <ChannelView
            canChat={auth?.kind === "authenticated" && auth.canChat === true}
            channel={channel}
            lineup={lineup}
            onGrid={
              gridOn
                ? () => {
                    setGridActive(channel.login)
                    navigate({ logins: gridFrom(channel.login, lastGrid()), view: "grid" })
                  }
                : undefined
            }
            onOpen={open}
            onPreferences={update}
            onTheater={setTheater}
            preferences={preferences}
            preferencesLoaded={preferencesLoaded}
            signedIn={signedIn}
            theater={theater}
          />
        ) : route.view === "grid" ? (
          <GridView
            active={gridActive}
            canChat={auth?.kind === "authenticated" && auth.canChat === true}
            known={knownChannels}
            logins={route.logins}
            onActive={setGridActive}
            onAdd={() => search.current?.focus()}
            onPreferences={update}
            onTheater={setTheater}
            preferences={preferences}
            preferencesLoaded={preferencesLoaded}
            signedIn={signedIn}
            theater={theater}
          />
        ) : route.view === "vod" ? (
          <VodView
            at={route.at}
            chatVisible={preferences.chatVisible}
            id={route.id}
            latencyMode={preferences.latencyMode}
            live={route.live}
            onPreferences={update}
            onTheater={setTheater}
            scale={preferences.chatScale}
            theater={theater}
          />
        ) : route.view === "categories" ? (
          <CategoriesView />
        ) : route.view === "category" ? (
          <CategoryView onOpen={open} slug={route.slug} />
        ) : route.view === "settings" ? (
          <SettingsView
            account={account}
            onPreferences={update}
            preferences={preferences}
            status={status}
          />
        ) : (
          <HomeView
            following={following}
            onOpen={open}
            onRetry={home.retry}
            onRetryAccount={account.reload}
            popular={popular}
            recents={recents}
            resource={resource}
            signedIn={signedIn}
            sketch={sketch}
            unreachable={unreachable}
          />
        )}
      </main>
    </div>
  )
}
