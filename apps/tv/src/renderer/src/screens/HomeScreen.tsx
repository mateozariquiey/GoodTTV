import type { LatencyMode } from "@goodttv/contratos"
import {
  type Channel,
  type Clave,
  fromRecent,
  fromStream,
  type Home,
  previewAt,
  t,
  tMensaje,
  useGuestPopular,
  usePrewarm,
} from "@goodttv/interfaz"
import { useEffect, useMemo, useState } from "react"
import { navigation } from "../navigation"
import { Avatar, ChannelRow, LiveBadge, RetryButton, StateMessage, Uptime, Viewers } from "../ui"

type Section = {
  readonly channels: readonly Channel[]
  readonly id: "following" | "recents" | "popular"
  readonly title: Clave // se traduce al pintarla
}

type HomeScreenProps = {
  readonly active: boolean
  readonly home: Home
  readonly latencyMode: LatencyMode
  readonly onLink: () => void
  readonly onRetryAccount: () => Promise<void>
  readonly onSearch: () => void
  readonly onWatch: (channel: Channel, lineup: readonly Channel[]) => void
}

const REFRESH_MS = 120_000
const STALE_MS = 60_000
const PREWARM_MS = 400 // con el foco este tiempo en un canal en directo, se precalienta su directo

export const rowId = (section: string, login: string): string => `home-${section}-${login}`

export const HomeScreen = ({
  active,
  home,
  latencyMode,
  onLink,
  onRetryAccount,
  onSearch,
  onWatch,
}: HomeScreenProps) => {
  const { fromSaved, known, reading, refresh, resource, retry, signedIn, unreachable } = home
  const [previewedId, setPreviewedId] = useState<string>() // la fila enfocada (rowId)
  // Sin cuenta, los directos más vistos, como invitado: la primera pantalla ya deja ver algo.
  const guestPopular = useGuestPopular(known && !signedIn)

  // Refresh in place when coming back from playback and periodically while visible. Lo guardado de la última vez no
  // cuenta: lo de ahora ya está en camino.
  useEffect(() => {
    if (!active) return undefined
    if (!fromSaved && resource.kind === "ready" && Date.now() - resource.updatedAt > STALE_MS) {
      void refresh()
    }
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [active, fromSaved, refresh, resource])

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
        ? [
            {
              channels: following.map(fromStream),
              id: "following" as const,
              title: "Siguiendo" as const,
            },
          ]
        : []),
      {
        channels: recents.map((recent) => fromRecent(recent, recentLive.get(recent.login))),
        id: "recents" as const,
        title: "Recientes" as const,
      },
      ...(signedIn
        ? [
            {
              channels: popular
                .filter((stream) => !followingIds.has(stream.userLogin))
                .slice(0, 12)
                .map(fromStream),
              id: "popular" as const,
              title: "Populares ahora" as const,
            },
          ]
        : guestPopular.channels.length > 0
          ? [
              {
                channels: guestPopular.channels,
                id: "popular" as const,
                title: "Populares ahora" as const,
              },
            ]
          : []),
    ]
  }, [guestPopular.channels, resource, signedIn])

  // La fila enfocada, con lo que digan las listas de ahora: un refresco, o lo de ahora tras lo guardado, puede cambiar
  // su título, sus espectadores o si está en directo sin que la fila pierda el foco.
  const previewed = useMemo(() => {
    for (const section of sections) {
      const channel = section.channels.find((each) => rowId(section.id, each.login) === previewedId)
      if (channel !== undefined) return channel
    }
    return undefined
  }, [previewedId, sections])
  // Con el foco quieto en un canal en directo, su directo se va preparando: al pulsar OK suele estar ya listo.
  usePrewarm(
    active && previewed !== undefined && previewed.live !== false ? previewed.login : null,
    latencyMode,
    PREWARM_MS,
  )

  const liveFollowing = sections.find((section) => section.id === "following")?.channels.length ?? 0
  const firstChannel = sections.find((section) => section.channels.length > 0)?.channels[0]
  const preview = previewed ?? firstChannel

  return (
    <div className="home">
      <div className="guide">
        {/* Sin poder comprobar la cuenta, lo de la última vez si lo hay; el foco, en la lista si la hay. */}
        {unreachable === undefined ? null : (
          <div className="state state--error" role="alert">
            <p className="state__title">{t("No se pudo comprobar tu cuenta")}</p>
            <p className="state__detail">
              {fromSaved
                ? t("Lo que ves es de la última vez ({error}).", { error: tMensaje(unreachable) })
                : t("La sesión no se ha cerrado ({error}).", { error: tMensaje(unreachable) })}
            </p>
            <RetryButton
              entry={firstChannel === undefined}
              navId="home-account-retry"
              onRetry={onRetryAccount}
            />
          </div>
        )}
        {resource.kind === "loading" && !reading && unreachable === undefined ? (
          <StateMessage kind="loading" title={t("Cargando canales…")} />
        ) : null}
        {resource.kind === "error" ? (
          <StateMessage
            action={{ id: "home-retry", label: t("Reintentar"), run: retry }}
            detail={tMensaje(resource.message)}
            kind="error"
            title={t("No se pudo cargar la lista de Twitch")}
          />
        ) : null}
        {signedIn || !known ? null : (
          <div className="guide__intro">
            <p>{t("Vincula tu cuenta para ver aquí a quién sigues en directo.")}</p>
            <div className="guide__actions">
              <button
                className="button button--primary"
                data-nav
                data-nav-entry=""
                data-nav-id="home-link"
                onClick={onLink}
                type="button"
              >
                {t("Vincular cuenta")}
              </button>
              <button
                className="button"
                data-nav
                data-nav-id="home-search"
                onClick={onSearch}
                type="button"
              >
                {t("Buscar un canal")}
              </button>
            </div>
          </div>
        )}
        {sections.map((section) => (
          <section aria-label={t(section.title)} className="guide__section" key={section.id}>
            <h2 className="guide__heading">
              {section.id === "following" ? (
                <>
                  <LiveBadge />
                  <span>
                    {liveFollowing === 1
                      ? t("1 canal que sigues")
                      : t("{n} canales que sigues", { n: liveFollowing })}
                  </span>
                </>
              ) : (
                t(section.title)
              )}
            </h2>
            {section.channels.length === 0 ? (
              <p className="guide__empty">
                {section.id === "following"
                  ? t("Nadie a quien sigues está en directo ahora.")
                  : section.id === "recents"
                    ? t("Los canales que veas aparecerán aquí.")
                    : t("No hay directos populares disponibles.")}
              </p>
            ) : (
              <ul className="guide__list">
                {section.channels.map((channel) => (
                  <li key={channel.login}>
                    <ChannelRow
                      channel={channel}
                      entry={channel === firstChannel}
                      navId={rowId(section.id, channel.login)}
                      onFocus={() => setPreviewedId(rowId(section.id, channel.login))}
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
      <Preview channel={preview} known={known || signedIn} signedIn={signedIn} />
    </div>
  )
}

// También la usa el directorio de categorías (CategoriesScreen), con los directos de una.
export const Preview = ({
  channel,
  known,
  signedIn,
}: {
  readonly channel: Channel | undefined
  readonly known: boolean // sin saber aún si hay cuenta, ni una cosa ni otra
  readonly signedIn: boolean
}) => {
  const [failed, setFailed] = useState<string>()
  if (channel === undefined && !known) return <aside className="preview preview--empty" />
  if (channel === undefined) {
    return (
      <aside className="preview preview--empty">
        <p>
          {signedIn
            ? t("Cuando alguien a quien sigues esté en directo, lo verás aquí.")
            : t("Busca un canal por su nombre o vincula tu cuenta de Twitch.")}
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
          <span className="preview__offline">{t("Desconectado")}</span>
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
              {t("desde hace")} <Uptime channel={channel} />
            </span>
          </>
        )}
      </p>
      <p className="preview__hint">
        <kbd>OK</kbd> {channel.live === false ? t("para abrir el canal") : t("para ver")}
      </p>
    </aside>
  )
}
