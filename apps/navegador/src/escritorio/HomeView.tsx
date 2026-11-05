import {
  type Channel,
  formatViewers,
  type HomeData,
  type HomeSketch,
  previewAt,
  type Resource,
  t,
  tMensaje,
  unfinishedVods,
  useGuestPopular,
} from "@goodttv/interfaz"
import { useMemo, useState } from "react"
import { Avatar } from "./Avatar"
import { RetryButton } from "./RetryButton"
import { VideoTile } from "./Videos"

type Open = (channel: Channel) => void

// Qué se ve en Inicio, si hay vídeos a medias. Inicio se vuelve a montar al volver de un vídeo: aquí sigue lo elegido.
type HomeShow = "live" | "videos"
let lastShow: HomeShow = "live"

const GUEST_PLACEHOLDERS = 12 // la forma de «Populares ahora» sin cuenta, mientras llega

const linkProps = (channel: Channel, onOpen: Open) => ({
  href: `#/canal/${channel.login}`,
  onClick: (event: { preventDefault: () => void }) => {
    event.preventDefault()
    onOpen(channel)
  },
})

// Miniatura de un directo, sin marco: al pasar el ratón o con el foco, contorno blanco.
const Thumbnail = ({
  channel,
  large,
  onOpen,
}: {
  readonly channel: Channel
  readonly large: boolean
  readonly onOpen: Open
}) => (
  <a className="thumb" {...linkProps(channel, onOpen)}>
    <span className="thumb__image">
      <img
        alt=""
        loading="lazy"
        src={
          large
            ? previewAt(channel.thumbnailUrl, 880, 496)
            : previewAt(channel.thumbnailUrl, 440, 248)
        }
      />
      <span className="thumb__viewers">
        <i aria-hidden="true" />
        <span className="visually-hidden">{t("En directo")}</span>
        {channel.viewerCount === undefined ? null : ` ${formatViewers(channel.viewerCount)}`}
      </span>
    </span>
    <span className="thumb__meta">
      <b className="thumb__name">{channel.displayName}</b>
      <span className="thumb__line thumb__title" title={channel.title}>
        {channel.title}
      </span>
      <span className="thumb__line thumb__line--dim">{channel.category}</span>
    </span>
  </a>
)

// La forma de una lista mientras llega lo de ahora (lo guardado es de hace rato): los huecos de las miniaturas, vacíos,
// para que nada salte al llegar.
const Placeholders = ({ count, poster }: { readonly count: number; readonly poster: boolean }) => (
  <div aria-busy="true" className={poster ? "grid grid--poster" : "grid"}>
    {Array.from({ length: count }, (_, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: huecos iguales, sin nada propio
      <span aria-hidden="true" className="thumb placeholder" key={index}>
        <span className="thumb__image" />
        <span className="thumb__meta">
          <b className="thumb__name">&nbsp;</b>
          <span className="thumb__line">&nbsp;</span>
          <span className="thumb__line">&nbsp;</span>
        </span>
      </span>
    ))}
  </div>
)

// poster: el primero, el doble de ancho y de alto, para la primera pantalla sin cuenta. En los seguidos no: quitaría tres
// canales a la vista en la lista que más se usa.
const Grid = ({
  channels,
  onOpen,
  poster,
}: {
  readonly channels: readonly Channel[]
  readonly onOpen: Open
  readonly poster: boolean
}) => (
  <div className={poster ? "grid grid--poster" : "grid"}>
    {channels.map((channel, index) => (
      <Thumbnail
        channel={channel}
        key={channel.login}
        large={poster && index === 0}
        onOpen={onOpen}
      />
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
                    <i aria-hidden="true" /> {t("En directo")}
                  </>
                ) : (
                  t("Desconectado")
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
  const [show, setShow] = useState(lastShow)
  const inVideos = show === "videos" && vods.length > 0
  const choose = (next: HomeShow): void => {
    lastShow = next
    setShow(next)
  }
  const liveCount =
    following.length > 0 ? <span className="page__count">{following.length}</span> : null
  const guest = useGuestPopular(!signedIn && resource.kind === "ready" && unreachable === undefined)
  // Sin poder comprobar la cuenta no se pide nada a Twitch: lo que se ve, si hay algo, es lo de la última vez.
  const notice =
    unreachable === undefined ? null : (
      <div className="notice-block notice-block--warning" role="alert">
        <p>
          {t("No se pudo comprobar tu cuenta ({error}).", { error: unreachable })}{" "}
          {resource.kind === "ready"
            ? t("Lo que ves es de la última vez.")
            : t("La sesión no se ha cerrado.")}
        </p>
        <RetryButton onRetry={onRetryAccount} />
      </div>
    )
  if (resource.kind === "error") {
    return (
      <div className="page">
        <div className="notice-block">
          <p>{t("No se pudo cargar Inicio ({error}).", { error: tMensaje(resource.message) })}</p>
          <button className="button" onClick={onRetry} type="button">
            {t("Reintentar")}
          </button>
        </div>
      </div>
    )
  }
  // Sin cuenta, o sin saber aún si la hay: ni la bienvenida ni «Seguir viendo» hasta tener lo de verdad.
  if (resource.kind === "loading" && !signedIn) {
    return <div className="page">{notice ?? <p className="page__note">{t("Cargando…")}</p>}</div>
  }
  return (
    <div className="page">
      {notice}
      {vods.length > 0 ? (
        <div className="page__section page__tabs">
          <button
            aria-pressed={!inVideos}
            className="page__tab"
            onClick={() => choose("live")}
            type="button"
          >
            {t("En directo")}
            {liveCount}
          </button>
          <button
            aria-pressed={inVideos}
            className="page__tab"
            onClick={() => choose("videos")}
            type="button"
          >
            {t("Vídeos")}
            <span className="page__count">{vods.length}</span>
          </button>
        </div>
      ) : signedIn ? (
        <h2 className="page__section">
          {t("En directo de tus seguidos")}
          {liveCount}
        </h2>
      ) : null}
      {inVideos ? (
        <div className="videos__grid">
          {vods.map((entry) => (
            <VideoTile channel={entry.displayName} key={entry.id} video={entry} />
          ))}
        </div>
      ) : (
        <>
          {signedIn ? (
            resource.kind === "loading" && (sketch?.following ?? 0) > 0 ? (
              <Placeholders count={sketch?.following ?? 0} poster={false} />
            ) : resource.kind === "loading" ? (
              <p className="page__note">{t("Cargando…")}</p>
            ) : following.length === 0 ? (
              <p className="page__note">{t("Ninguno de tus seguidos está en directo ahora.")}</p>
            ) : (
              <Grid channels={following} onOpen={onOpen} poster={false} />
            )
          ) : (
            <div className="welcome">
              <h1>{t("Twitch sin anuncios")}</h1>
              <p>
                {t("Busca un canal por su nombre en la barra de arriba (atajo")} <kbd>/</kbd>
                {t("), o vincula tu cuenta para ver aquí a quién sigues y leer el chat.")}
              </p>
              <a className="button button--primary" href="#/ajustes">
                {t("Vincular cuenta")}
              </a>
            </div>
          )}
          {recents.length === 0 ? null : (
            <>
              <h2 className="page__section">{t("Seguir viendo")}</h2>
              <Recents
                channels={recents}
                known={signedIn}
                onOpen={onOpen}
                pending={sketch !== undefined}
              />
            </>
          )}
          {popular.length + guest.channels.length > 0 ? (
            <>
              <h2 className="page__section">{t("Populares ahora")}</h2>
              <Grid
                channels={signedIn ? popular : guest.channels}
                onOpen={onOpen}
                poster={!signedIn}
              />
            </>
          ) : (sketch?.popular ?? 0) > 0 || guest.loading ? (
            <>
              <h2 className="page__section">{t("Populares ahora")}</h2>
              <Placeholders
                count={guest.loading ? GUEST_PLACEHOLDERS : (sketch?.popular ?? 0)}
                poster={!signedIn}
              />
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
