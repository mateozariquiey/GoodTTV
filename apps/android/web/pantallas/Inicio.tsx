import {
  type Channel,
  type Clave,
  type FollowedOrder,
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
import { ArrowsDownUpIcon, MagnifyingGlassIcon, UserIcon } from "@phosphor-icons/react"
import { type ReactNode, useEffect, useState } from "react"
import { Avatar, Reintentar } from "./comun"
import { Opciones } from "./controles"
import { useAtrasCierra } from "./rutas"
import { VideoItem } from "./Videos"

type Open = (channel: Channel) => void

const GUEST_PLACEHOLDERS = 8 // la forma de «Populares ahora» sin cuenta, mientras llega
type Account = { readonly displayName: string; readonly profileImageUrl?: string | undefined }

// Inicio: arriba el logo, la búsqueda y el avatar (la cuenta y los ajustes); debajo, los seguidos en directo (por
// espectadores o «Recomendado para ti», como en Twitch), los canales recientes, los vídeos a medias (VOD-1) y los
// populares, como en la extensión. Cada directo, con su miniatura pequeña y el título (la «lista
// con miniatura», investigacion/android/interfaz/propuesta-and3.html).

const aMedias = () => (window.api.vods === undefined ? [] : unfinishedVods().slice(0, 8))

const linkProps = (channel: Channel, onOpen: Open) => ({
  href: `#/canal/${channel.login}`,
  onClick: (event: { preventDefault: () => void }) => {
    event.preventDefault()
    onOpen(channel)
  },
})

const Directo = ({ channel, onOpen }: { readonly channel: Channel; readonly onOpen: Open }) => (
  <li>
    <a className="directo" {...linkProps(channel, onOpen)}>
      <span className="directo__miniatura">
        <img alt="" loading="lazy" src={previewAt(channel.thumbnailUrl, 440, 248)} />
        {channel.viewerCount === undefined ? null : (
          <span className="directo__espectadores">
            <i aria-hidden="true" />
            {formatViewers(channel.viewerCount)}
            <span className="oculto">{t("espectadores")}</span>
          </span>
        )}
      </span>
      <span className="directo__texto">
        <b className="directo__nombre">{channel.displayName}</b>
        <span className="directo__titulo">{channel.title}</span>
        {channel.category === undefined || channel.category === "" ? null : (
          <span className="directo__categoria">{channel.category}</span>
        )}
      </span>
    </a>
  </li>
)

// La forma de una lista mientras llega lo de ahora (lo guardado es de hace rato): los huecos vacíos, para que nada salte
// al llegar.
const Huecos = ({ count }: { readonly count: number }) => (
  <ul aria-busy="true" className="directos">
    {Array.from({ length: count }, (_, index) => (
      <li aria-hidden="true" key={index}>
        <span className="directo hueco">
          <span className="directo__miniatura" />
          <span className="directo__texto">
            <b className="directo__nombre">&nbsp;</b>
            <span className="directo__titulo">&nbsp;</span>
            <span className="directo__categoria">&nbsp;</span>
          </span>
        </span>
      </li>
    ))}
  </ul>
)

const Lista = ({
  channels,
  onOpen,
}: {
  readonly channels: readonly Channel[]
  readonly onOpen: Open
}) => (
  <ul className="directos">
    {channels.map((channel) => (
      <Directo channel={channel} key={channel.login} onOpen={onOpen} />
    ))}
  </ul>
)

// Los últimos canales vistos, en una fila que se desliza. Sin cuenta no se sabe si están en directo: entonces no se dice.
const Recientes = ({
  channels,
  known,
  onOpen,
}: {
  readonly channels: readonly Channel[]
  readonly known: boolean
  readonly onOpen: Open
}) => (
  <ul className="recientes">
    {channels.map((channel) => {
      const state = !known ? "" : channel.live === true ? " reciente--vivo" : " reciente--fuera"
      return (
        <li key={channel.login}>
          <a className={`reciente${state}`} {...linkProps(channel, onOpen)}>
            <Avatar name={channel.displayName} url={channel.profileImageUrl} />
            <span className="reciente__nombre">{channel.displayName}</span>
            {known ? (
              <span className="oculto">
                {channel.live === true ? t("En directo") : t("Desconectado")}
              </span>
            ) : null}
          </a>
        </li>
      )
    })}
  </ul>
)

export const Inicio = ({
  account,
  following,
  hidden,
  onOpen,
  onOrder,
  onRetry,
  onRetryAccount,
  order,
  popular,
  recents,
  resource,
  signedIn,
  sketch,
  unreachable,
}: {
  readonly account: Account | undefined
  readonly following: readonly Channel[]
  readonly hidden: boolean // hay otra pantalla encima: Inicio sigue montado, para volver donde estaba
  readonly onOpen: Open
  readonly onOrder: (order: FollowedOrder) => void
  readonly onRetry: () => void
  readonly onRetryAccount: () => Promise<void>
  readonly order: FollowedOrder
  readonly popular: readonly Channel[]
  readonly recents: readonly Channel[]
  readonly resource: Resource<HomeData>
  readonly signedIn: boolean
  readonly sketch: HomeSketch | undefined // lo guardado es de hace rato: la forma de las listas, mientras llega lo de ahora
  readonly unreachable: string | undefined // no se pudo comprobar la cuenta: el motivo
}) => {
  // Los VOD a medias, para seguir donde se dejaron: se leen otra vez al volver a Inicio (sigue montado debajo, con lo de
  // antes, para no moverse mientras no se ve).
  const [vods, setVods] = useState(aMedias)
  useEffect(() => {
    if (!hidden) setVods(aMedias())
  }, [hidden])
  // Con vídeos a medias, se elige arriba qué ver: debajo de la lista de canales hacía falta recorrerla entera.
  const [vista, setVista] = useState<"directo" | "videos">("directo")
  const enVideos = vista === "videos" && vods.length > 0
  const enDirecto = (
    <>
      {t("En directo")}
      {following.length > 0 ? <span className="seccion__cuenta">{following.length}</span> : null}
    </>
  )
  const guest = useGuestPopular(!signedIn && resource.kind === "ready" && unreachable === undefined)
  // Sin poder comprobar la cuenta no se pide nada a Twitch: lo que se ve, si hay algo, es lo de la última vez.
  const notice =
    unreachable === undefined ? null : (
      <div className="aviso aviso--alerta" role="alert">
        <p>
          {t("No se pudo comprobar tu cuenta ({error}).", { error: unreachable })}{" "}
          {resource.kind === "ready"
            ? t("Lo que ves es de la última vez.")
            : t("La sesión no se ha cerrado.")}
        </p>
        <Reintentar onRetry={onRetryAccount} />
      </div>
    )
  let body: ReactNode
  if (resource.kind === "error") {
    body = (
      <div className="aviso">
        <p>{t("No se pudo cargar Inicio ({error}).", { error: tMensaje(resource.message) })}</p>
        <button className="boton" onClick={onRetry} type="button">
          {t("Reintentar")}
        </button>
      </div>
    )
  } else if (resource.kind === "loading" && !signedIn) {
    // Sin cuenta, o sin saber aún si la hay: ni la bienvenida ni «Seguir viendo» hasta tener lo de verdad.
    body = notice ?? <p className="nota">{t("Cargando…")}</p>
  } else {
    body = (
      <>
        {notice}
        {signedIn || vods.length > 0 ? (
          <div className="seccion seccion--con-boton">
            {vods.length === 0 ? (
              <h2>{enDirecto}</h2>
            ) : (
              <div className="titulos">
                <button
                  aria-pressed={!enVideos}
                  className="titulo"
                  onClick={() => setVista("directo")}
                  type="button"
                >
                  {enDirecto}
                </button>
                <button
                  aria-pressed={enVideos}
                  className="titulo"
                  onClick={() => setVista("videos")}
                  type="button"
                >
                  {t("Vídeos")}
                  <span className="seccion__cuenta">{vods.length}</span>
                </button>
              </div>
            )}
            {signedIn && !enVideos ? <Orden onOrder={onOrder} order={order} /> : null}
          </div>
        ) : null}
        {enVideos ? (
          <ul className="directos">
            {vods.map((entry) => (
              <VideoItem channel={entry.displayName} key={entry.id} video={entry} />
            ))}
          </ul>
        ) : (
          <>
            {signedIn ? (
              <section>
                {resource.kind === "loading" && (sketch?.following ?? 0) > 0 ? (
                  <Huecos count={sketch?.following ?? 0} />
                ) : resource.kind === "loading" ? (
                  <p className="nota">{t("Cargando…")}</p>
                ) : following.length === 0 ? (
                  <p className="nota">{t("Ninguno de tus seguidos está en directo ahora.")}</p>
                ) : (
                  <Lista channels={following} onOpen={onOpen} />
                )}
              </section>
            ) : (
              <div className="bienvenida">
                <h1>{t("Twitch sin anuncios")}</h1>
                <p>
                  {t(
                    "Busca un canal por su nombre, o vincula tu cuenta para ver aquí a quién sigues y leer el chat.",
                  )}
                </p>
                <a className="boton boton--principal" href="#/cuenta">
                  {t("Vincular la cuenta")}
                </a>
              </div>
            )}
            {recents.length === 0 ? null : (
              <section>
                <h2 className="seccion">{t("Seguir viendo")}</h2>
                <Recientes
                  channels={recents}
                  known={signedIn && sketch === undefined}
                  onOpen={onOpen}
                />
              </section>
            )}
            {popular.length + guest.channels.length > 0 ? (
              <section>
                <h2 className="seccion">{t("Populares ahora")}</h2>
                <Lista channels={signedIn ? popular : guest.channels} onOpen={onOpen} />
              </section>
            ) : (sketch?.popular ?? 0) > 0 || guest.loading ? (
              <section>
                <h2 className="seccion">{t("Populares ahora")}</h2>
                <Huecos count={guest.loading ? GUEST_PLACEHOLDERS : (sketch?.popular ?? 0)} />
              </section>
            ) : null}
          </>
        )}
      </>
    )
  }
  return (
    <div className={`pantalla inicio${hidden ? " pantalla--debajo" : ""}`} inert={hidden}>
      <header className="barra barra--inicio">
        <span aria-hidden="true" className="logo" />
        <span className="marca">GoodTTV</span>
        <a aria-label={t("Buscar un canal")} className="boton-icono" href="#/buscar">
          <MagnifyingGlassIcon />
        </a>
        <a aria-label={t("Cuenta y ajustes")} className="boton-icono" href="#/cuenta">
          {account === undefined ? (
            <UserIcon />
          ) : (
            <Avatar
              className="avatar avatar--barra"
              name={account.displayName}
              url={account.profileImageUrl}
            />
          )}
        </a>
      </header>
      <main className="inicio__cuerpo">{body}</main>
    </div>
  )
}

const ORDENES: Readonly<Record<FollowedOrder, Clave>> = {
  espectadores: "Espectadores",
  recomendado: "Recomendado para ti",
}

// El orden de tus seguidos, en un menú que cuelga del botón, como en Twitch (una hoja desde abajo quedaría debajo del
// minirreproductor, que va encima de la página). Recomendado: primero los que más ves en GoodTTV (watch-time.ts), porque
// la API de Twitch solo los da por espectadores. Se cierra al elegir, al tocar fuera o con Atrás.
const Orden = ({
  onOrder,
  order,
}: {
  readonly onOrder: (order: FollowedOrder) => void
  readonly order: FollowedOrder
}) => {
  const [abierto, setAbierto] = useState(false)
  useAtrasCierra(abierto, () => setAbierto(false))
  useEffect(() => {
    if (!abierto) return undefined
    const fuera = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || event.target.closest(".orden") === null)
        setAbierto(false)
    }
    addEventListener("pointerdown", fuera, { capture: true })
    return () => removeEventListener("pointerdown", fuera, { capture: true })
  }, [abierto])
  return (
    <div className="orden">
      <button
        aria-expanded={abierto}
        aria-haspopup="menu"
        aria-label={t("Ordenar: {orden}", { orden: t(ORDENES[order]) })}
        className="orden__boton"
        onClick={() => setAbierto(!abierto)}
        type="button"
      >
        <ArrowsDownUpIcon aria-hidden="true" />
      </button>
      {abierto ? (
        <div className="orden__menu">
          <p className="orden__titulo">{t("Ordenar por")}</p>
          <Opciones
            elegida={order}
            onElegir={(valor) => {
              onOrder(valor)
              setAbierto(false)
            }}
            opciones={(["recomendado", "espectadores"] as const).map((valor) => ({
              nombre: t(ORDENES[valor]),
              valor,
            }))}
          />
          <p className="orden__nota">
            {t("«Recomendado para ti»: primero los que más ves en GoodTTV.")}
          </p>
        </div>
      ) : null}
    </div>
  )
}
