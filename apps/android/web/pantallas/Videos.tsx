import type { VideoCard } from "@goodttv/contratos"
import {
  formatAgo,
  formatClock,
  formatViewers,
  prefetchVod,
  t,
  useChannelVods,
  useIdioma,
  useUnfinishedVods,
  vodTileProgress,
} from "@goodttv/interfaz"
import { FilmStripIcon } from "@phosphor-icons/react"
import { memo } from "react"
import { routeHash } from "./rutas"

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
  const { ratio, seen } = vodTileProgress(video.id, current)
  const datos = [
    channel,
    formatAgo(video.createdAt),
    video.views === undefined
      ? undefined
      : t("{n} visualizaciones", { n: formatViewers(video.views) }),
  ].filter((each) => each !== undefined && each !== "")
  return (
    <li>
      <a
        aria-current={current ? "page" : undefined}
        className={`directo video${current ? " video--actual" : ""}`}
        href={routeHash({ id: video.id, view: "vod" })}
        // El que se está viendo no se vuelve a abrir: su dirección no lleva el segundo ni el directo del que se vino al
        // retroceder, y se perdía «Ir al directo».
        onClick={current ? (event) => event.preventDefault() : undefined}
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
            <span className="video__visto">{t("Viéndolo")}</span>
          ) : seen ? (
            <span className="video__visto">{t("Visto")}</span>
          ) : null}
          {ratio === null ? null : (
            <span className="video__progreso">
              <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
            </span>
          )}
        </span>
        <span className="directo__texto">
          <span className="directo__titulo video__titulo">{video.title || t("Sin título")}</span>
          <span className="directo__categoria">{datos.join(" · ")}</span>
        </span>
      </a>
    </li>
  )
}

// Memoizado: el canal y el VOD se vuelven a pintar a menudo (la hora, el chat, la posición del vídeo), y la lista no
// cambia con eso.
export const ChannelVideos = memo(function ChannelVideos({
  current,
  login,
}: {
  readonly current?: string // el VOD que se está viendo
  readonly login: string
}) {
  useIdioma() // con memo no se vuelve a pintar solo al cambiar el idioma
  const loaded = useChannelVods(login)
  const videos = loaded.kind === "ready" ? (loaded.list?.videos ?? []) : []
  // Los suyos a medias, sin el que se está viendo.
  const unfinished = useUnfinishedVods(login, current)
  return (
    <section aria-label={t("Vídeos")} className="videos">
      {unfinished.length === 0 ? null : (
        <>
          <h2 className="seccion">{t("Seguir viendo")}</h2>
          <ul className="directos">
            {unfinished.map((entry) => (
              <VideoItem key={entry.id} video={entry} />
            ))}
          </ul>
          <h2 className="seccion">{t("Todos")}</h2>
        </>
      )}
      {loaded.kind === "loading" ? (
        <p className="nota">{t("Cargando…")}</p>
      ) : loaded.kind === "error" ? (
        <p className="nota">{t("No se pudieron cargar.")}</p>
      ) : videos.length === 0 ? (
        <p className="nota">
          {t("Este canal no guarda sus emisiones, o son solo para suscriptores.")}
        </p>
      ) : (
        <ul className="directos">
          {videos.map((video) => (
            <VideoItem current={video.id === current} key={video.id} video={video} />
          ))}
        </ul>
      )}
    </section>
  )
})
