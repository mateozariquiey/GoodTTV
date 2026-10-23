import type { VideoCard, VideoList } from "@goodttv/contratos"
import {
  formatAgo,
  formatClock,
  isSeen,
  prefetchVod,
  unfinishedVods,
  vodProgress,
} from "@goodttv/interfaz"
import { FilmStripIcon } from "@phosphor-icons/react"
import { useEffect, useMemo, useState } from "react"

// Los vídeos de un canal (VOD-1 y COL-2): debajo de la ficha del canal, o en su sitio si no está en directo, y debajo
// de un VOD, los demás del canal. Encima, en una fila, los suyos que tienes a medias. Cada tarjeta dice si ya lo viste o
// por dónde ibas; al pasar el ratón, se pide ya su lista (vod-cache.ts).

export const VideoTile = ({
  channel,
  current = false,
  video,
}: {
  readonly channel?: string // en «Seguir viendo»: de quién es
  readonly current?: boolean // el que se está viendo
  readonly video: Pick<VideoCard, "createdAt" | "id" | "seconds" | "thumbnail" | "title"> &
    Partial<Pick<VideoCard, "views">>
}) => {
  const progress = vodProgress(video.id)
  const seen = progress !== undefined && isSeen(progress)
  const ratio =
    progress === undefined || seen || current ? null : progress.at / Math.max(1, progress.seconds)
  return (
    <a
      aria-current={current ? "page" : undefined}
      className="video-tile"
      href={`#/vod/${video.id}`}
      onPointerEnter={() => prefetchVod(video.id)}
      title={video.title}
    >
      <span className="video-tile__picture">
        {video.thumbnail === null ? (
          // Twitch no hace la miniatura de una emisión hasta que acaba: sin ella, la tarjeta parecía rota.
          <FilmStripIcon aria-hidden="true" className="video-tile__empty" />
        ) : (
          <img alt="" decoding="async" loading="lazy" src={video.thumbnail} />
        )}
        <span className="video-tile__length">{formatClock(video.seconds)}</span>
        {current ? (
          <span className="video-tile__seen">Viéndolo</span>
        ) : seen ? (
          <span className="video-tile__seen">Visto</span>
        ) : null}
        {ratio === null ? null : (
          <span className="video-tile__progress">
            <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </span>
        )}
      </span>
      <span className="video-tile__title">{video.title || "Sin título"}</span>
      <span className="video-tile__meta">
        {channel === undefined ? null : <b>{channel} · </b>}
        {formatAgo(video.createdAt)}
      </span>
    </a>
  )
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly list: VideoList | null }

export const ChannelVideos = ({
  current,
  login,
  offline,
  title,
}: {
  readonly current?: string // el VOD que se está viendo
  readonly login: string
  readonly offline: boolean
  readonly title?: string
}) => {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" })
  useEffect(() => {
    const vods = window.api.vods
    if (vods === undefined) return undefined
    let active = true
    setLoaded({ kind: "loading" })
    vods
      .list(login)
      .then((list) => {
        if (active) setLoaded({ kind: "ready", list })
      })
      .catch(() => {
        if (active) setLoaded({ kind: "error" })
      })
    return () => {
      active = false
    }
  }, [login])
  // Los suyos a medias, sin el que se está viendo. Se leen al abrir el canal o el vídeo.
  const unfinished = useMemo(
    () => unfinishedVods().filter((entry) => entry.login === login && entry.id !== current),
    [current, login],
  )
  if (window.api.vods === undefined) return null
  const videos = loaded.kind === "ready" ? (loaded.list?.videos ?? []) : []
  return (
    <section aria-label="Vídeos" className={`videos${offline ? " videos--offline" : ""}`}>
      {unfinished.length === 0 ? null : (
        <>
          <h2 className="videos__title">Seguir viendo</h2>
          <div className="videos__row">
            {unfinished.map((entry) => (
              <VideoTile key={entry.id} video={entry} />
            ))}
          </div>
        </>
      )}
      <h2 className="videos__title">
        {title ?? (offline ? "Sus últimas emisiones" : "Emisiones anteriores")}
      </h2>
      {loaded.kind === "loading" ? (
        <p className="videos__note">Cargando…</p>
      ) : loaded.kind === "error" ? (
        <p className="videos__note">No se pudieron cargar.</p>
      ) : videos.length === 0 ? (
        <p className="videos__note">
          Este canal no guarda sus emisiones, o son solo para suscriptores.
        </p>
      ) : (
        <div className="videos__grid">
          {videos.map((video) => (
            <VideoTile current={video.id === current} key={video.id} video={video} />
          ))}
        </div>
      )}
    </section>
  )
}
