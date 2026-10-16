import {
  type Channel,
  fromRecent,
  fromStream,
  type HomeData,
  loadHome,
  type Resource,
  useAppStatus,
  useAuth,
  usePreferences,
  useResource,
} from "@goodttv/interfaz"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChannelView } from "./ChannelView"
import { HomeView } from "./HomeView"
import { forgetHome, pageStorage, readSavedHome, saveHome } from "./home-cache"
import { usePointerPrewarm } from "./prewarm"
import { navigate, useRoute } from "./routes"
import { SettingsView } from "./SettingsView"
import { Sidebar } from "./Sidebar"
import { contextOf, shortcutFor } from "./shortcuts"
import { TopBar } from "./TopBar"

// GoodTTV en el ordenador: barra con búsqueda, columna de seguidos y la vista de la dirección (Inicio, un canal o
// Ajustes). Reutiliza de @goodttv/interfaz los datos, el reproductor y el chat; las pantallas son propias, para
// ratón y teclado (docs/arquitectura.md).

const REFRESH_MS = 120_000 // como Inicio en la tele

export const Desktop = () => {
  const route = useRoute()
  const account = useAuth()
  const status = useAppStatus()
  const { preferences, update } = usePreferences()
  // Al abrir, lo que se vio la última vez (home-cache.ts) mientras se comprueba la cuenta y llega lo de ahora; deja de
  // valer si la cuenta resulta ser otra, o ninguna.
  const [storage] = useState(pageStorage)
  const [saved] = useState(() => readSavedHome(storage))
  const savedAccount =
    saved !== undefined &&
    (account.auth === undefined ||
      (account.auth.kind === "authenticated" && account.auth.login === saved.account.login))
      ? saved
      : undefined
  const auth = account.auth ?? savedAccount?.account
  const signedIn = auth?.kind === "authenticated"
  // Inicio se pide cuando ya se sabe si hay cuenta: sin ella, salen todos los seguidos como desconectados.
  const known = account.auth !== undefined
  const load = useMemo(() => (known ? () => loadHome(signedIn) : undefined), [known, signedIn])
  const home = useResource(load)
  // Si falla la primera carga, como cuando falla un refresco: se sigue viendo lo último bueno (el refresco de cada
  // 2 min lo reintenta).
  const resource = useMemo(
    (): Resource<HomeData> =>
      home.resource.kind !== "ready" && savedAccount !== undefined
        ? { kind: "ready", updatedAt: savedAccount.savedAt, value: savedAccount.home }
        : home.resource,
    [home.resource, savedAccount],
  )
  useEffect(() => {
    const current = account.auth
    if (current === undefined || current.kind === "error") return // un fallo de red no es cerrar sesión
    if (current.kind !== "authenticated") forgetHome(storage)
    else if (home.resource.kind === "ready") saveHome(storage, current, home.resource.value)
  }, [account.auth, home.resource, storage])
  const { refresh } = home
  useEffect(() => {
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])
  // Al volver a Inicio, al día: el canal que acabas de ver ya está en «Seguir viendo». Al abrir, ya carga useResource.
  const atHome = route.view === "home"
  const wasHome = useRef(atHome)
  useEffect(() => {
    if (atHome && !wasHome.current) void refresh()
    wasHome.current = atHome
  }, [atHome, refresh])

  const data = resource.kind === "ready" ? resource.value : undefined
  const following = useMemo(() => data?.following.map(fromStream) ?? [], [data])
  const popular = useMemo(() => data?.popular.map(fromStream) ?? [], [data])
  const recents = useMemo(
    () =>
      data?.recents.map((recent) => fromRecent(recent, data.recentLive.get(recent.login))) ?? [],
    [data],
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

  const [collapsed, setCollapsed] = useState(false)
  const [theater, setTheater] = useState(false)
  useEffect(() => {
    if (route.view !== "channel") setTheater(false)
  }, [route.view])
  const search = useRef<HTMLInputElement>(null)

  // Atajos de toda la ventana; los del reproductor los atiende ChannelView.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const shortcut = shortcutFor(event, contextOf(event.target))
      if (shortcut === "search") {
        event.preventDefault()
        search.current?.focus()
      } else if (shortcut === "back" && !event.defaultPrevented) {
        if (theater) setTheater(false)
        else if (route.view !== "home" && document.fullscreenElement === null) {
          navigate({ view: "home" })
        }
      }
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [route.view, theater])

  return (
    <div
      className={`desktop${theater && channel !== undefined ? " desktop--theater" : ""}${collapsed ? " desktop--collapsed" : ""}`}
    >
      <TopBar
        account={auth?.kind === "authenticated" ? auth : undefined}
        onOpen={open}
        searchRef={search}
        signedIn={signedIn}
      />
      <Sidebar
        channels={following}
        collapsed={collapsed}
        current={channel?.login}
        failed={resource.kind === "error"}
        loading={resource.kind === "loading"}
        onCollapse={() => setCollapsed((value) => !value)}
        onOpen={open}
        signedIn={signedIn}
      />
      <main className="desktop__main">
        {channel !== undefined ? (
          <ChannelView
            channel={channel}
            lineup={lineup}
            onOpen={open}
            onPreferences={update}
            onTheater={setTheater}
            preferences={preferences}
            signedIn={signedIn}
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
            popular={popular}
            recents={recents}
            resource={resource}
            signedIn={signedIn}
          />
        )}
      </main>
    </div>
  )
}
