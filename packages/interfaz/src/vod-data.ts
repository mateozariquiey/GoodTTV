import type { Storyboard, VideoDetail, VideoList } from "@goodttv/contratos"
import { useCallback, useEffect, useMemo, useState } from "react"
import { vodDetail } from "./vod-cache"
import { unfinishedVods, type VodProgress } from "./vod-progress"

// Lo que la extensión y Android piden para enseñar un VOD (VOD-1) y los vídeos de un canal (COL-2): los datos del
// vídeo, sus miniaturas para la barra y la lista del canal, con los suyos a medias. Cada versión los pinta a su manera
// (VodView.tsx y Videos.tsx de la extensión; pantallas/Vod.tsx y pantallas/Videos.tsx de Android).

export type VodLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" } // ya no existe, o no se puede ver
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly video: VideoDetail }

// Los datos de un VOD (título, canal, miniaturas, chat): suelen estar ya pedidos (vod-cache.ts), al pasar el ratón por
// su tarjeta o, retrocediendo un directo, al ver el canal. retry: los pide otra vez, tras un fallo.
export const useVodDetail = (
  id: string,
): { readonly load: VodLoad; readonly retry: () => void } => {
  const [load, setLoad] = useState<VodLoad>({ kind: "loading" })
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: «attempt» vuelve a pedirlo.
  useEffect(() => {
    if (window.api.vods === undefined) {
      setLoad({ kind: "error" })
      return undefined
    }
    let active = true
    setLoad({ kind: "loading" })
    vodDetail(id)
      .then((video) => {
        if (active) setLoad(video === null ? { kind: "missing" } : { kind: "ready", video })
      })
      .catch(() => {
        if (active) setLoad({ kind: "error" })
      })
    return () => {
      active = false
    }
  }, [attempt, id])
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { load, retry }
}

// Las miniaturas de la barra de un VOD, para verlas al moverse por él. null mientras llegan, o si no tiene.
export const useStoryboard = (video: VideoDetail | null): Storyboard | null => {
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null)
  useEffect(() => {
    setStoryboard(null)
    const url = video?.storyboard
    if (url == null || window.api.vods === undefined) return undefined
    let active = true
    window.api.vods
      .storyboard(url)
      .then((board) => {
        if (active) setStoryboard(board)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [video])
  return storyboard
}

export type VodListLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly list: VideoList | null }

// Los vídeos de un canal. Sin window.api.vods, se queda cargando.
export const useChannelVods = (login: string): VodListLoad => {
  const [load, setLoad] = useState<VodListLoad>({ kind: "loading" })
  useEffect(() => {
    const vods = window.api.vods
    if (vods === undefined) return undefined
    let active = true
    setLoad({ kind: "loading" })
    vods
      .list(login)
      .then((list) => {
        if (active) setLoad({ kind: "ready", list })
      })
      .catch(() => {
        if (active) setLoad({ kind: "error" })
      })
    return () => {
      active = false
    }
  }, [login])
  return load
}

// Los vídeos del canal que tienes a medias, sin el que se está viendo (current). Se leen al abrir el canal o el vídeo.
export const useUnfinishedVods = (
  login: string,
  current: string | undefined,
): readonly VodProgress[] =>
  useMemo(
    () => unfinishedVods().filter((entry) => entry.login === login && entry.id !== current),
    [current, login],
  )
