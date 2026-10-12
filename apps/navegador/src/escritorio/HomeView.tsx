import {
  type Channel,
  formatViewers,
  type HomeData,
  previewAt,
  type Resource,
} from "@goodttv/interfaz"
import { Avatar } from "./Avatar"

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

// Sin cuenta no se sabe si están en directo: entonces no se dice nada.
const Recents = ({
  channels,
  known,
  onOpen,
}: {
  readonly channels: readonly Channel[]
  readonly known: boolean
  readonly onOpen: Open
}) => (
  <ul className="recents">
    {channels.map((channel) => (
      <li key={channel.login}>
        <a className="recent" {...linkProps(channel, onOpen)}>
          <Avatar name={channel.displayName} url={channel.profileImageUrl} />
          <span className="recent__text">
            <b>{channel.displayName}</b>
            {known ? (
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
  popular,
  recents,
  resource,
  signedIn,
}: {
  readonly following: readonly Channel[]
  readonly onOpen: Open
  readonly onRetry: () => void
  readonly popular: readonly Channel[]
  readonly recents: readonly Channel[]
  readonly resource: Resource<HomeData>
  readonly signedIn: boolean
}) => {
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
  return (
    <div className="page">
      {signedIn ? (
        <>
          <h2 className="page__section">En directo de tus seguidos</h2>
          {resource.kind === "loading" ? (
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
          <Recents channels={recents} known={signedIn} onOpen={onOpen} />
        </>
      )}
      {popular.length === 0 ? null : (
        <>
          <h2 className="page__section">Populares ahora</h2>
          <Grid channels={popular} onOpen={onOpen} />
        </>
      )}
    </div>
  )
}
