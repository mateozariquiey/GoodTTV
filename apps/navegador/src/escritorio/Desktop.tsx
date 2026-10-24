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
import { ChannelView } from "./ChannelView"
import { HomeView } from "./HomeView"
import { usePointerPrewarm } from "./prewarm"
import { navigate, useRoute } from "./routes"
import { SettingsView } from "./SettingsView"
import { Sidebar } from "./Sidebar"
import { contextOf, shortcutFor, watchPointerFocus } from "./shortcuts"
import { TopBar } from "./TopBar"
import { VodView } from "./VodView"

// GoodTTV en el ordenador: barra con búsqueda, columna de seguidos y la vista de la dirección (Inicio, un canal o
// Ajustes). Reutiliza de @goodttv/interfaz los datos, el reproductor y el chat; las pantallas son propias, para
// ratón y teclado (docs/arquitectura.md).

const REFRESH_MS = 120_000 // como Inicio en la tele

export const Desktop = () => {
  const route = useRoute()
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
  useEffect(() => {
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])
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
  // Al volver a Inicio, al día: el canal que acabas de ver ya está en «Seguir viendo». Al abrir, ya carga useHome.
  const atHome = route.view === "home"
  const wasHome = useRef(atHome)
  useEffect(() => {
    if (atHome && !wasHome.current) void refresh()
    wasHome.current = atHome
  }, [atHome, refresh])

  const data = resource.kind === "ready" ? resource.value : undefined
  // Tus seguidos, por espectadores o primero los que más ves (watch-time.ts), en la columna, en Inicio y para ↑ ↓.
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
  // ↑ ↓ en el reproductor recorren la lista de la que salió el canal.
  const lineup = useMemo(() => {
    const login = channel?.login
    for (const list of [following, popular, recents.filter((each) => each.live === true)]) {
      if (list.some((each) => each.login === login)) return list
    }
    return []
  }, [channel, following, popular, recents])

  const offline = useMemo(
    () => new Set(recents.filter((each) => each.live === false).map((each) => each.login)),
    [recents],
  )
  usePointerPrewarm(channel?.login, offline, preferences.latencyMode)
  useOpeningPrewarm(atHome, recents[0], preferences.latencyMode, preferencesLoaded)

  const [collapsed, setCollapsed] = useState(false)
  const [theater, setTheater] = useState(false)
  useEffect(() => {
    if (route.view !== "channel" && route.view !== "vod") setTheater(false)
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
      className={`desktop${theater && (channel !== undefined || route.view === "vod") ? " desktop--theater" : ""}${collapsed ? " desktop--collapsed" : ""}`}
    >
      <TopBar
        account={auth?.kind === "authenticated" ? auth : undefined}
        onOpen={open}
        searchRef={search}
      />
      <Sidebar
        channels={following}
        collapsed={collapsed}
        current={channel?.login}
        failed={resource.kind === "error" || unreachable !== undefined}
        loading={resource.kind === "loading" && unreachable === undefined}
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
            onOpen={open}
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
