import { useCallback, useEffect, useRef, useState } from "react"
import { type Channel, fromStream, toRecent } from "./channel"
import { useAppStatus, useAuth, usePreferences } from "./data"
import { useLayer, useRemoteInput } from "./navigation"
import { PlayerScreen } from "./player/PlayerScreen"
import { AccountScreen } from "./screens/AccountScreen"
import { HomeScreen } from "./screens/HomeScreen"
import { SearchScreen } from "./screens/SearchScreen"
import { Avatar } from "./ui"

type Tab = "home" | "search" | "account"

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: "home", label: "Siguiendo" },
  { id: "search", label: "Buscar" },
  { id: "account", label: "Ajustes" },
]

type Watching = { readonly channel: Channel; readonly lineup: readonly Channel[] }

export const App = () => {
  useRemoteInput()
  const status = useAppStatus()
  const account = useAuth()
  const { preferences, update: updatePreferences } = usePreferences()
  const [tab, setTab] = useState<Tab>("home")
  const [watching, setWatching] = useState<Watching>()
  const shell = useRef<HTMLDivElement>(null)
  const signedIn = account.auth?.kind === "authenticated"

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
      id: `tab-${tab}`,
      onBack: () => {
        if (tab !== "home") setTab("home")
      },
      root: shell,
    },
    watching === undefined,
  )

  const play = useCallback(
    (channel: Channel, lineup: readonly Channel[]) => {
      setWatching({ channel, lineup })
      void window.api.recents.add(toRecent(channel)).catch(() => undefined)
      // Opened by name: fill in title, viewers and the id chat needs, if the channel is live.
      if (signedIn && channel.userId === undefined) {
        void window.api.catalog
          .streamsByLogin([channel.login])
          .then(([stream]) => {
            if (stream === undefined) return
            const enriched = fromStream(stream)
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
          <nav aria-label="Secciones" className="tabs">
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
                {item.label}
              </button>
            ))}
          </nav>
          {account.auth?.kind === "authenticated" ? (
            <span className="topbar__account">
              {account.auth.displayName}
              <Avatar
                channel={{
                  displayName: account.auth.displayName,
                  login: account.auth.login,
                  ...(account.auth.profileImageUrl === undefined
                    ? {}
                    : { profileImageUrl: account.auth.profileImageUrl }),
                }}
                size="sm"
              />
            </span>
          ) : null}
        </header>
        <main className="content">
          <section aria-label="Siguiendo" hidden={tab !== "home"}>
            <HomeScreen
              active={watching === undefined && tab === "home"}
              key={signedIn ? "signed-in" : "guest"}
              latencyMode={preferences.latencyMode}
              onLink={() => setTab("account")}
              onSearch={() => setTab("search")}
              onWatch={play}
              signedIn={signedIn}
            />
          </section>
          <section aria-label="Buscar" hidden={tab !== "search"}>
            <SearchScreen onWatch={play} signedIn={signedIn} />
          </section>
          <section aria-label="Ajustes" hidden={tab !== "account"}>
            <AccountScreen
              auth={account.auth}
              authBusy={account.busy}
              onBegin={() => void account.begin()}
              onLogout={() => void account.logout()}
              onPreferences={updatePreferences}
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
