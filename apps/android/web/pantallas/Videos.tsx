import type { VideoCard, VideoList } from "@goodttv/contratos"
import {
  formatAgo,
  formatClock,
  formatViewers,
  isSeen,
  prefetchVod,
  unfinishedVods,
  vodProgress,
} from "@goodttv/interfaz"
import { FilmStripIcon } from "@phosphor-icons/react"
import { useEffect, useMemo, useState } from "react"

// Los vídeos de un canal (VOD-1 y COL-2), como la extensión (Videos.tsx) pero en la «lista con miniatura» de Inicio:
// debajo de la ficha del canal (en su pestaña) y, debajo de un VOD, los demás del canal, con el que se ve marcado.
// Encima, «Seguir viendo»: los suyos que tienes a medias. Cada uno dice si ya lo viste o por dónde ibas. Al empezar a tocarlo se pide ya su lista (vod-cache.ts), como precalentar un
// directo.

type Video = Pick<VideoCard, "createdAt" | "id" | "seconds" | "thumbnail" | "title"> &
  Partial<Pick<VideoCard, "views">>

export const VideoItem = ({
  channel,
  current = false,
  video,
}: {
  readonly channel?: string // en «Vídeos a medias»: de quién es
  readonly current?: boolean // el que se está viendo
  readonly video: Video
}) => {
  const progress = vodProgress(video.id)
  const seen = progress !== undefined && isSeen(progress)
  const ratio =
    progress === undefined || seen || current ? null : progress.at / Math.max(1, progress.seconds)
  const datos = [
    channel,
    formatAgo(video.createdAt),
    video.views === undefined ? undefined : `${formatViewers(video.views)} visualizaciones`,
  ].filter((each) => each !== undefined && each !== "")
  return (
    <li>
      <a
        aria-current={current ? "page" : undefined}
        className={`directo video${current ? " video--actual" : ""}`}
        href={`#/vod/${video.id}`}
        onPointerDown={() => prefetchVod(video.id)}
      >
        <span className="directo__miniatura">
          {video.thumbnail === null ? (
            // Twitch no hace la miniatura de una emisión hasta que acaba: sin ella, parecía rota.
            <FilmStripIcon aria-hidden="true" className="video__vacio" />
          ) : (
            <img alt="" decoding="async" loading="lazy" src={video.thumbnail} />
          )}
          <span className="video__duracion">{formatClock(video.seconds)}</span>
          {current ? (
            <span className="video__visto">Viéndolo</span>
          ) : seen ? (
            <span className="video__visto">Visto</span>
          ) : null}
          {ratio === null ? null : (
            <span className="video__progreso">
              <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
            </span>
          )}
        </span>
        <span className="directo__texto">
          <span className="directo__titulo video__titulo">{video.title || "Sin título"}</span>
          <span className="directo__categoria">{datos.join(" · ")}</span>
        </span>
      </a>
    </li>
  )
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly list: VideoList | null }

export const ChannelVideos = ({
  current,
  login,
}: {
  readonly current?: string // el VOD que se está viendo
  readonly login: string
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
  const videos = loaded.kind === "ready" ? (loaded.list?.videos ?? []) : []
  // Los suyos a medias, sin el que se está viendo. Se leen al abrir el canal o el vídeo.
  const unfinished = useMemo(
    () => unfinishedVods().filter((entry) => entry.login === login && entry.id !== current),
    [current, login],
  )
  return (
    <section aria-label="Vídeos" className="videos">
      {unfinished.length === 0 ? null : (
        <>
          <h2 className="seccion">Seguir viendo</h2>
          <ul className="directos">
            {unfinished.map((entry) => (
              <VideoItem key={entry.id} video={entry} />
            ))}
          </ul>
          <h2 className="seccion">Todos</h2>
        </>
      )}
      {loaded.kind === "loading" ? (
        <p className="nota">Cargando…</p>
      ) : loaded.kind === "error" ? (
        <p className="nota">No se pudieron cargar.</p>
      ) : videos.length === 0 ? (
        <p className="nota">Este canal no guarda sus emisiones, o son solo para suscriptores.</p>
      ) : (
        <ul className="directos">
          {videos.map((video) => (
            <VideoItem current={video.id === current} key={video.id} video={video} />
          ))}
        </ul>
      )}
    </section>
  )
}
