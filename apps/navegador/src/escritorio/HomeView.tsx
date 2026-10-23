import {
  type Channel,
  formatViewers,
  type HomeData,
  type HomeSketch,
  previewAt,
  type Resource,
  unfinishedVods,
} from "@goodttv/interfaz"
import { useMemo } from "react"
import { Avatar } from "./Avatar"
import { RetryButton } from "./RetryButton"
import { VideoTile } from "./Videos"

type Open = (channel: Channel) => void

const linkProps = (channel: Channel, onOpen: Open) => ({
  href: `#/canal/${channel.login}`,
  onClick: (event: { preventDefault: () => void }) => {
    event.preventDefault()
    onOpen(channel)
  },
})

// Miniatura de un directo, sin marco: al pasar el ratón o con el foco, contorno blanco.
const Thumbnail = ({ channel, onOpen }: { readonly channel: Channel; readonly onOpen: Open }) => (
  <a className="thumb" {...linkProps(channel, onOpen)}>
    <span className="thumb__image">
      <img alt="" loading="lazy" src={previewAt(channel.thumbnailUrl, 440, 248)} />
      <span className="thumb__live">En directo</span>
      {channel.viewerCount === undefined ? null : (
        <span className="thumb__viewers">{formatViewers(channel.viewerCount)} espectadores</span>
      )}
    </span>
    <span className="thumb__meta">
      <Avatar name={channel.displayName} url={channel.profileImageUrl} />
      <span>
        <b className="thumb__title" title={channel.title}>
          {channel.title}
        </b>
        <span className="thumb__line">{channel.displayName}</span>
        <span className="thumb__line">{channel.category}</span>
      </span>
    </span>
  </a>
)

// La forma de una lista mientras llega lo de ahora (lo guardado es de hace rato): los huecos de las miniaturas, vacíos,
// para que nada salte al llegar.
const Placeholders = ({ count }: { readonly count: number }) => (
  <div aria-busy="true" className="grid">
    {Array.from({ length: count }, (_, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: huecos iguales, sin nada propio
      <span aria-hidden="true" className="thumb placeholder" key={index}>
        <span className="thumb__image" />
        <span className="thumb__meta">
          <span className="avatar" />
          <span>
            <b className="thumb__title">&nbsp;</b>
            <span className="thumb__line">&nbsp;</span>
            <span className="thumb__line">&nbsp;</span>
          </span>
        </span>
      </span>
    ))}
  </div>
)

const Grid = ({
  channels,
  onOpen,
}: {
  readonly channels: readonly Channel[]
  readonly onOpen: Open
}) => (
  <div className="grid">
    {channels.map((channel) => (
      <Thumbnail channel={channel} key={channel.login} onOpen={onOpen} />
    ))}
  </div>
)

// Sin cuenta no se sabe si están en directo: entonces no se dice nada. Mientras llega (pending), el hueco de la línea.
const Recents = ({
  channels,
  known,
  onOpen,
  pending,
}: {
  readonly channels: readonly Channel[]
  readonly known: boolean
  readonly onOpen: Open
  readonly pending: boolean
}) => (
  <ul className="recents">
    {channels.map((channel) => (
      <li key={channel.login}>
        <a className="recent" {...linkProps(channel, onOpen)}>
          <Avatar name={channel.displayName} url={channel.profileImageUrl} />
          <span className="recent__text">
            <b>{channel.displayName}</b>
            {pending ? (
              <span className="recent__state placeholder">&nbsp;</span>
            ) : known ? (
              <span
                className={
                  channel.live === true ? "recent__state recent__state--live" : "recent__state"
                }
              >
                {channel.live === true ? (
                  <>
                    <i aria-hidden="true" />
                    En directo
                  </>
                ) : (
                  "Desconectado"
                )}
              </span>
            ) : null}
          </span>
        </a>
      </li>
    ))}
  </ul>
)

export const HomeView = ({
  following,
  onOpen,
  onRetry,
  onRetryAccount,
  popular,
  recents,
  resource,
  signedIn,
  sketch,
  unreachable,
}: {
  readonly following: readonly Channel[]
  readonly onOpen: Open
  readonly onRetry: () => void
  readonly onRetryAccount: () => Promise<void>
  readonly popular: readonly Channel[]
  readonly recents: readonly Channel[]
  readonly resource: Resource<HomeData>
  readonly signedIn: boolean
  readonly sketch: HomeSketch | undefined // lo guardado es de hace rato: la forma de las listas, mientras llega lo de ahora
  readonly unreachable: string | undefined // no se pudo comprobar la cuenta: el motivo
}) => {
  // Los VOD a medias (VOD-1), para seguir donde se dejaron. Se leen al pintar Inicio, que se vuelve a montar al volver.
  const vods = useMemo(
    () => (window.api.vods === undefined ? [] : unfinishedVods().slice(0, 8)),
    [],
  )
  // Sin poder comprobar la cuenta no se pide nada a Twitch: lo que se ve, si hay algo, es lo de la última vez.
  const notice =
    unreachable === undefined ? null : (
      <div className="notice-block notice-block--warning" role="alert">
        <p>
          No se pudo comprobar tu cuenta ({unreachable}).{" "}
          {resource.kind === "ready"
            ? "Lo que ves es de la última vez."
            : "La sesión no se ha cerrado."}
        </p>
        <RetryButton onRetry={onRetryAccount} />
      </div>
    )
  if (resource.kind === "error") {
    return (
      <div className="page">
        <div className="notice-block">
          <p>No se pudo cargar Inicio ({resource.message}).</p>
          <button className="button" onClick={onRetry} type="button">
            Reintentar
          </button>
        </div>
      </div>
    )
  }
  // Sin cuenta, o sin saber aún si la hay: ni la bienvenida ni «Seguir viendo» hasta tener lo de verdad.
  if (resource.kind === "loading" && !signedIn) {
    return <div className="page">{notice ?? <p className="page__note">Cargando…</p>}</div>
  }
  return (
    <div className="page">
      {notice}
      {signedIn ? (
        <>
          <h2 className="page__section">En directo de tus seguidos</h2>
          {resource.kind === "loading" && (sketch?.following ?? 0) > 0 ? (
            <Placeholders count={sketch?.following ?? 0} />
          ) : resource.kind === "loading" ? (
            <p className="page__note">Cargando…</p>
          ) : following.length === 0 ? (
            <p className="page__note">Ninguno de tus seguidos está en directo ahora.</p>
          ) : (
            <Grid channels={following} onOpen={onOpen} />
          )}
        </>
      ) : (
        <div className="welcome">
          <h1>Twitch sin anuncios</h1>
          <p>
            Busca un canal por su nombre en la barra de arriba (atajo <kbd>/</kbd>), o vincula tu
            cuenta para ver aquí a quién sigues y leer el chat.
          </p>
          <a className="button button--primary" href="#/ajustes">
            Vincular cuenta
          </a>
        </div>
      )}
      {recents.length === 0 ? null : (
        <>
          <h2 className="page__section">Seguir viendo</h2>
          <Recents
            channels={recents}
            known={signedIn}
            onOpen={onOpen}
            pending={sketch !== undefined}
          />
        </>
      )}
      {vods.length === 0 ? null : (
        <>
          <h2 className="page__section">Vídeos a medias</h2>
          <div className="videos__grid">
            {vods.map((entry) => (
              <VideoTile channel={entry.displayName} key={entry.id} video={entry} />
            ))}
          </div>
        </>
      )}
      {popular.length > 0 ? (
        <>
          <h2 className="page__section">Populares ahora</h2>
          <Grid channels={popular} onOpen={onOpen} />
        </>
      ) : (sketch?.popular ?? 0) > 0 ? (
        <>
          <h2 className="page__section">Populares ahora</h2>
          <Placeholders count={sketch?.popular ?? 0} />
        </>
      ) : null}
    </div>
  )
}
