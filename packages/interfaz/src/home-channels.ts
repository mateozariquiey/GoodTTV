import { useEffect, useMemo, useRef } from "react"
import { type Channel, fromRecent, fromStream } from "./channel"
import type { HomeData, HomeSketch } from "./data"
import { type FollowedOrder, sortFollowed } from "./watch-time"

// Las listas de Inicio y el canal abierto, como los usan la extensión (Desktop.tsx) y Android (pantallas/App.tsx): las
// mismas listas van a Inicio, a la columna de la extensión y a ↑ ↓ (o las flechas) del reproductor.

export type HomeChannels = {
  readonly following: readonly Channel[]
  readonly popular: readonly Channel[]
  readonly recents: readonly Channel[]
}

// Tus seguidos (por espectadores o primero los que más ves, watch-time.ts), los populares y los recientes. Con lo
// guardado de hace rato (sketch), solo los recientes, sin su directo, hasta que llega lo de ahora. Cada lista cambia
// solo cuando cambia lo suyo, para no volver a pintar lo que no.
export const useHomeChannels = (
  data: HomeData | undefined,
  sketch: HomeSketch | undefined,
  order: FollowedOrder,
): HomeChannels => {
  const following = useMemo(
    () =>
      sortFollowed(
        data?.following.map(fromStream) ?? [],
        order,
        data?.recents.map((recent) => recent.login),
      ),
    [data, order],
  )
  const popular = useMemo(() => data?.popular.map(fromStream) ?? [], [data])
  const recents = useMemo(
    () =>
      data?.recents.map((recent) => fromRecent(recent, data.recentLive.get(recent.login))) ??
      sketch?.recents.map((recent) => fromRecent(recent, undefined)) ??
      [],
    [data, sketch],
  )
  return useMemo(() => ({ following, popular, recents }), [following, popular, recents])
}

// El canal de la dirección: el último abierto desde una lista o la búsqueda (opened), con lo que se sabía de él; si se
// llega por la dirección, lo que digan las listas; y si no está en ninguna, solo su nombre de usuario (la pantalla lo
// completa con catalog.channel).
export const channelToShow = (
  login: string,
  opened: Channel | undefined,
  lists: HomeChannels,
): Channel => {
  if (opened?.login === login) return opened
  const known = [...lists.following, ...lists.popular, ...lists.recents].find(
    (each) => each.login === login,
  )
  return known ?? { displayName: login, login }
}

// La lista de la que salió el canal, para recorrerla desde el reproductor: tus seguidos, los populares o los recientes
// que emiten. Si no está en ninguna, vacía.
export const lineupOf = (login: string | undefined, lists: HomeChannels): readonly Channel[] => {
  for (const list of [
    lists.following,
    lists.popular,
    lists.recents.filter((each) => each.live === true),
  ]) {
    if (list.some((each) => each.login === login)) return list
  }
  return []
}

// Al volver a Inicio, al día: el canal que acabas de ver ya está en «Seguir viendo». Al abrir no, porque ya carga
// useHome.
export const useRefreshOnReturnHome = (atHome: boolean, refresh: () => unknown): void => {
  const wasHome = useRef(atHome)
  useEffect(() => {
    if (atHome && !wasHome.current) void refresh()
    wasHome.current = atHome
  }, [atHome, refresh])
}
