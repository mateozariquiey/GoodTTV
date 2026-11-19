import type { LiveArchive } from "@goodttv/contratos"
import { useEffect, useState } from "react"
import { prefetchVod, renewVod, VOD_WARM_MS } from "./vod-cache"

// Retroceder el directo (DVR-1; la extensión y Android): la emisión en curso y el VOD que la graba. Con él, la barra del
// canal va desde que empezó la emisión, y retroceder más de lo que cabe en la lista del empalme lleva a ese VOD en el
// momento elegido. Sin VOD público, no se ofrece.

export type LiveRewind = {
  readonly archive: LiveArchive | null
  readonly now: number // la hora (ms), al segundo mientras hay VOD: la barra avanza con ella
}

// onAir: el directo se está viendo; antes no se pide. Mientras se ve el canal, su VOD y sus datos se tienen a mano
// (vod-cache.ts): retroceder no espera a pedirlos. Valen 5 min: se renuevan.
export const useLiveArchive = (login: string, onAir: boolean): LiveRewind => {
  const [archive, setArchive] = useState<LiveArchive | null>(null)
  useEffect(() => {
    setArchive(null)
    const vods = window.api.vods
    if (!onAir || vods === undefined) return undefined
    let active = true
    vods
      .archive(login)
      .then((value) => {
        if (active) setArchive(value)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [login, onAir])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = archive?.archiveId
    if (id == null) return undefined
    prefetchVod(id)
    const warm = setInterval(() => renewVod(id), VOD_WARM_MS)
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(warm)
      clearInterval(timer)
    }
  }, [archive])
  return { archive, now }
}

// Un momento de la emisión (ms, en hora real) en el VOD que la graba: su id y el segundo, contando desde que empezó a
// grabarse (o, si no se sabe, desde que empezó la emisión). null sin VOD.
export const archiveMoment = (
  archive: LiveArchive | null,
  wallMs: number,
): { readonly at: number; readonly id: string } | null => {
  const id = archive?.archiveId
  if (id == null) return null
  const origin = Date.parse(archive?.recordedAt ?? archive?.startedAt ?? "")
  if (!Number.isFinite(origin)) return null
  return { at: Math.max(0, (wallMs - origin) / 1000), id }
}

// La barra del directo: desde que empezó la emisión hasta ahora (s), y lo que se ve, la latencia antes de ahora. start:
// cuándo empezó (ms). null sin VOD, o si no se está viendo el directo.
export type LiveBar = {
  readonly duration: number
  readonly position: number
  readonly start: number
}

export const liveBar = (
  { archive, now }: LiveRewind,
  latency: number | null,
  onAir: boolean,
): LiveBar | null => {
  const start = Date.parse(archive?.startedAt ?? "")
  if (archive?.archiveId == null || !Number.isFinite(start) || !onAir) return null
  const duration = Math.max(0, (now - start) / 1000)
  return { duration, position: Math.max(0, duration - (latency ?? 0)), start }
}
