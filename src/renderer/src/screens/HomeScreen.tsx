import { useCallback, useEffect, useMemo, useState } from "react"
import { type Channel, fromRecent, fromStream, previewAt } from "../channel"
import { loadHome, useResource } from "../data"
import { navigation } from "../navigation"
import { Avatar, ChannelRow, LiveBadge, StateMessage, Uptime, Viewers } from "../ui"

type Section = {
  readonly channels: readonly Channel[]
  readonly id: "following" | "recents" | "popular"
  readonly title: string
}

type HomeScreenProps = {
  readonly active: boolean
  readonly onLink: () => void
  readonly onSearch: () => void
  readonly onWatch: (channel: Channel, lineup: readonly Channel[]) => void
  readonly signedIn: boolean
}

const REFRESH_MS = 120_000
const STALE_MS = 60_000

export const rowId = (section: string, login: string): string => `home-${section}-${login}`

export const HomeScreen = ({ active, onLink, onSearch, onWatch, signedIn }: HomeScreenProps) => {
  const load = useCallback(() => loadHome(signedIn), [signedIn])
  const { refresh, resource, retry } = useResource(load)
  const [previewed, setPreviewed] = useState<Channel>()

  // Refresh in place when coming back from playback and periodically while visible.
  useEffect(() => {
    if (!active) return undefined
    if (resource.kind === "ready" && Date.now() - resource.updatedAt > STALE_MS) void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [active, refresh, resource])

  // If the focused channel vanished in a refresh, put focus back on something real.
  useEffect(() => {
    if (active && resource.kind === "ready") requestAnimationFrame(() => navigation.ensureFocus())
  }, [active, resource])

  const sections = useMemo((): readonly Section[] => {
    if (resource.kind !== "ready") return []
    const { following, popular, recentLive, recents } = resource.value
    const followingIds = new Set(following.map((stream) => stream.userLogin))
    return [
      ...(signedIn
        ? [{ channels: following.map(fromStream), id: "following" as const, title: "Siguiendo" }]
        : []),
      {
        channels: recents.map((recent) => fromRecent(recent, recentLive.get(recent.login))),
        id: "recents" as const,
        title: "Recientes",
      },
      ...(signedIn
        ? [
            {
              channels: popular
                .filter((stream) => !followingIds.has(stream.userLogin))
                .slice(0, 12)
                .map(fromStream),
              id: "popular" as const,
              title: "Populares ahora",
            },
          ]
        : []),
    ]
  }, [resource, signedIn])

  const liveFollowing = sections.find((section) => section.id === "following")?.channels.length ?? 0
  const firstChannel = sections.find((section) => section.channels.length > 0)?.channels[0]
  const preview = previewed ?? firstChannel

  return (
    <div className="home">
      <div className="guide">
        {resource.kind === "loading" ? (
          <StateMessage kind="loading" title="Cargando canales…" />
        ) : null}
        {resource.kind === "error" ? (
          <StateMessage
            action={{ id: "home-retry", label: "Reintentar", run: retry }}
            detail={resource.message}
            kind="error"
            title="No se pudo cargar la lista de Twitch"
          />
        ) : null}
        {signedIn ? null : (
          <div className="guide__intro">
            <p>Vincula tu cuenta para ver aquí a quién sigues en directo.</p>
            <div className="guide__actions">
              <button
                className="button button--primary"
                data-nav
                data-nav-entry=""
                data-nav-id="home-link"
                onClick={onLink}
                type="button"
              >
                Vincular cuenta
              </button>
              <button
                className="button"
                data-nav
                data-nav-id="home-search"
                onClick={onSearch}
                type="button"
              >
                Buscar un canal
              </button>
            </div>
          </div>
        )}
        {sections.map((section) => (
          <section aria-label={section.title} className="guide__section" key={section.id}>
            <h2 className="guide__heading">
              {section.id === "following" ? (
                <>
                  <LiveBadge />
                  <span>
                    {liveFollowing === 1
                      ? "1 canal que sigues"
                      : `${liveFollowing} canales que sigues`}
                  </span>
                </>
              ) : (
                section.title
              )}
            </h2>
            {section.channels.length === 0 ? (
              <p className="guide__empty">
                {section.id === "following"
                  ? "Nadie a quien sigues está en directo ahora."
                  : section.id === "recents"
                    ? "Los canales que veas aparecerán aquí."
                    : "No hay directos populares disponibles."}
              </p>
            ) : (
              <ul className="guide__list">
                {section.channels.map((channel) => (
                  <li key={channel.login}>
                    <ChannelRow
                      channel={channel}
                      entry={channel === firstChannel}
                      navId={rowId(section.id, channel.login)}
                      onFocus={() => setPreviewed(channel)}
                      onOpen={() =>
                        onWatch(
                          channel,
                          section.channels.filter((candidate) => candidate.live !== false),
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <Preview channel={preview} signedIn={signedIn} />
    </div>
  )
}

const Preview = ({
  channel,
  signedIn,
}: {
  readonly channel: Channel | undefined
  readonly signedIn: boolean
}) => {
  const [failed, setFailed] = useState<string>()
  if (channel === undefined) {
    return (
      <aside className="preview preview--empty">
        <p>
          {signedIn
            ? "Cuando alguien a quien sigues esté en directo, lo verás aquí."
            : "Busca un canal por su nombre o vincula tu cuenta de Twitch."}
        </p>
      </aside>
    )
  }
  const image = previewAt(channel.thumbnailUrl, 1280, 720)
  return (
    <aside aria-live="polite" className="preview">
      <div className="preview__media">
        {channel.live !== false && image !== undefined && failed !== image ? (
          <img alt="" key={image} onError={() => setFailed(image)} src={image} />
        ) : (
          <div className="preview__placeholder">
            <Avatar channel={channel} size="lg" />
          </div>
        )}
      </div>
      <h1 className="preview__title">{channel.title ?? channel.displayName}</h1>
      <p className="preview__meta">
        {channel.live === false ? (
          <span className="preview__offline">Desconectado</span>
        ) : (
          <LiveBadge />
        )}
        <strong>{channel.displayName}</strong>
        {channel.category === undefined || channel.category === "" ? null : (
          <>
            <span aria-hidden="true">·</span>
            <span>{channel.category}</span>
          </>
        )}
        {channel.viewerCount === undefined ? null : (
          <>
            <span aria-hidden="true">·</span>
            <Viewers channel={channel} />
          </>
        )}
        {channel.startedAt === undefined ? null : (
          <>
            <span aria-hidden="true">·</span>
            <span>
              desde hace <Uptime channel={channel} />
            </span>
          </>
        )}
      </p>
      <p className="preview__hint">
        <kbd>OK</kbd> {channel.live === false ? "para abrir el canal" : "para ver"}
      </p>
    </aside>
  )
}
