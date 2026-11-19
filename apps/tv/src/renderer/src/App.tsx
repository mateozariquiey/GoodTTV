import {
  type Channel,
  type Clave,
  fromSearch,
  fromStream,
  t,
  toRecent,
  useAppStatus,
  useAuth,
  useHome,
  useIdioma,
  usePreferences,
} from "@goodttv/interfaz"
import { useCallback, useEffect, useRef, useState } from "react"
import { navigation, useLayer, useRemoteInput } from "./navigation"
import { PlayerScreen } from "./player/PlayerScreen"
import { AccountScreen } from "./screens/AccountScreen"
import { CategoriesScreen } from "./screens/CategoriesScreen"
import { HomeScreen } from "./screens/HomeScreen"
import { SearchScreen } from "./screens/SearchScreen"
import { Avatar } from "./ui"

type Tab = "home" | "search" | "categories" | "account"

const TABS: readonly { readonly id: Tab; readonly label: Clave }[] = [
  { id: "home", label: "Siguiendo" },
  { id: "search", label: "Buscar" },
  { id: "categories", label: "Categorías" },
  { id: "account", label: "Ajustes" },
]

const lookUpChannel = async (login: string, signedIn: boolean): Promise<Channel | undefined> => {
  const { catalog } = window.api
  // Con cuenta, Helix, que también da desde cuándo emite.
  if (signedIn) {
    const [stream] = await catalog.streamsByLogin([login])
    if (stream !== undefined) return fromStream(stream)
  }
  const card = await catalog.channel(login)
  return card === null ? undefined : fromSearch(card)
}

type Watching = { readonly channel: Channel; readonly lineup: readonly Channel[] }

export const App = () => {
  useIdioma() // al cambiar de idioma, se vuelve a pintar todo
  useRemoteInput()
  const status = useAppStatus()
  const account = useAuth()
  const { preferences, update: updatePreferences } = usePreferences()
  const [tab, setTab] = useState<Tab>("home")
  const [watching, setWatching] = useState<Watching>()
  // En «Categorías», la categoría abierta (D49): sus directos son otra capa de foco, y Atrás vuelve a la lista.
  const [category, setCategory] = useState<string>()
  const inCategory = tab === "categories" && category !== undefined
  const shell = useRef<HTMLDivElement>(null)
  // Al abrir, lo que se vio la última vez mientras se comprueba la cuenta y llega lo de ahora (useHome).
  const home = useHome(account.auth)
  const { auth, signedIn } = home
  // El foco del mando entra cuando Inicio ya tiene algo: la lista (guardada o de ahora), un error, sin cuenta la
  // bienvenida o, si no se pudo comprobar la cuenta, el aviso con «Reintentar». Antes caería en las pestañas, y ahí se
  // quedaría al llegar la lista. Una vez dentro, no se vuelve a esperar.
  const [started, setStarted] = useState(false)
  if (
    !started &&
    !home.reading &&
    (home.resource.kind !== "loading" ||
      (home.known && !signedIn) ||
      home.unreachable !== undefined)
  ) {
    setStarted(true)
  }

  // Text entry (letters, Space and Backspace go to the field) only makes sense on Search; never
  // let it outlive the screen, even if the field is hidden without a blur event.
  useEffect(() => {
    if (tab !== "search" || watching !== undefined) void window.api.input.setTextEntry(false)
  }, [tab, watching])

  useEffect(() => {
    document.title =
      watching === undefined ? "GoodTTV" : `${watching.channel.displayName} · GoodTTV`
  }, [watching])

  // Each tab is its own layer over the same shell, so each keeps its own focus memory.
  useLayer(
    {
      // Mientras llega una lista del directorio, el foco se queda en su pestaña, no en la primera (CategoriesScreen lo
      // lleva a la lista en cuanto llega).
      entry: () => (tab === "categories" ? "tab-categories" : undefined),
      id: inCategory ? "tab-category" : `tab-${tab}`,
      onBack: () => {
        if (inCategory) {
          // La siguiente categoría que se abra empieza por su primer directo, no por donde se dejó esta.
          navigation.forget("tab-category")
          setCategory(undefined)
        } else if (tab !== "home") setTab("home")
      },
      root: shell,
    },
    watching === undefined && started,
  )

  const play = useCallback(
    (channel: Channel, lineup: readonly Channel[]) => {
      setWatching({ channel, lineup })
      void window.api.recents.add(toRecent(channel)).catch(() => undefined)
      // Opened by name: fill in its name, picture and the id chat needs and, if it is live, title and viewers. As a guest
      // (catalog.channel), so also without an account.
      if (channel.userId === undefined) {
        void lookUpChannel(channel.login, signedIn)
          .then((enriched) => {
            if (enriched === undefined) return
            setWatching((current) =>
              current?.channel.login === channel.login
                ? { ...current, channel: enriched }
                : current,
            )
            void window.api.recents.add(toRecent(enriched)).catch(() => undefined)
          })
          .catch(() => undefined)
      }
    },
    [signedIn],
  )

  const switchChannel = useCallback((channel: Channel) => {
    setWatching((current) => (current === undefined ? current : { ...current, channel }))
    void window.api.recents.add(toRecent(channel)).catch(() => undefined)
  }, [])

  return (
    <>
      <div className="shell" hidden={watching !== undefined} ref={shell}>
        <header className="topbar">
          <span aria-hidden="true" className="topbar__logo" />
          <nav aria-label={t("Secciones")} className="tabs">
            {TABS.map((item) => (
              <button
                aria-current={tab === item.id ? "page" : undefined}
                className="tab"
                data-nav
                data-nav-group="tabs"
                data-nav-id={`tab-${item.id}`}
                data-nav-transient=""
                key={item.id}
                onClick={() => setTab(item.id)}
                type="button"
              >
                {t(item.label)}
              </button>
            ))}
          </nav>
          {auth?.kind === "authenticated" ? (
            <span className="topbar__account">
              {auth.displayName}
              <Avatar
                channel={{
                  displayName: auth.displayName,
                  login: auth.login,
                  ...(auth.profileImageUrl === undefined
                    ? {}
                    : { profileImageUrl: auth.profileImageUrl }),
                }}
                size="sm"
              />
            </span>
          ) : null}
        </header>
        <main className="content">
          <section aria-label={t("Siguiendo")} hidden={tab !== "home"}>
            <HomeScreen
              active={watching === undefined && tab === "home"}
              home={home}
              key={signedIn ? "signed-in" : "guest"}
              latencyMode={preferences.latencyMode}
              onLink={() => setTab("account")}
              onRetryAccount={account.reload}
              onSearch={() => setTab("search")}
              onWatch={play}
            />
          </section>
          <section aria-label={t("Buscar")} hidden={tab !== "search"}>
            <SearchScreen onWatch={play} />
          </section>
          <section aria-label={t("Categorías")} hidden={tab !== "categories"}>
            <CategoriesScreen
              active={watching === undefined && tab === "categories"}
              category={category}
              onCategory={setCategory}
              onWatch={play}
            />
          </section>
          <section aria-label={t("Ajustes")} hidden={tab !== "account"}>
            <AccountScreen
              auth={account.auth}
              authBusy={account.busy}
              onBegin={() => void account.begin()}
              onLogout={() => void account.logout()}
              onPreferences={updatePreferences}
              onRetry={account.reload}
              preferences={preferences}
              status={status}
            />
          </section>
        </main>
      </div>
      {watching === undefined ? null : (
        <PlayerScreen
          channel={watching.channel}
          lineup={watching.lineup}
          onBack={() => setWatching(undefined)}
          onChannel={switchChannel}
          onPreferences={updatePreferences}
          preferences={preferences}
          signedIn={signedIn}
        />
      )}
    </>
  )
}
