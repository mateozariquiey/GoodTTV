import { useCallback, useEffect, useState } from "react"

// Los canales que más ves, para ordenar tus seguidos como el «Recomendado para ti» de Twitch, que su API no da (Helix
// solo los ordena por espectadores): los minutos que suena cada canal en GoodTTV, en directo o en sus VOD, con más peso
// lo reciente (vale la mitad cada 14 días). En el localStorage de la página, como los VOD a medias (vod-progress.ts):
// la extensión y Android, sin datos de la cuenta.

const KEY = "minutos-por-canal"
const ORDER_KEY = "orden-seguidos"
const HALF_LIFE_MS = 14 * 24 * 3_600_000
const LIMIT = 300 // los de más peso; los demás se olvidan
const MINUTE_MS = 60_000

export type FollowedOrder = "recomendado" | "espectadores"

type Entry = { readonly at: number; readonly minutes: number }
type Store = Readonly<Record<string, Entry>>

const storageOf = (): Storage | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const read = (storage: Storage | undefined): Store => {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "{}")
    return typeof parsed === "object" && parsed !== null ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

// Los minutos de un canal, ya descontado el tiempo que ha pasado desde el último.
const weight = (entry: Entry | undefined, now: number): number =>
  entry === undefined || !Number.isFinite(entry.minutes) || !Number.isFinite(entry.at)
    ? 0
    : entry.minutes * 0.5 ** (Math.max(0, now - entry.at) / HALF_LIFE_MS)

export const addWatchMinute = (login: string, storage = storageOf(), now = Date.now()): void => {
  if (storage === undefined) return
  const store: Record<string, Entry> = { ...read(storage) }
  store[login] = { at: now, minutes: weight(store[login], now) + 1 }
  const kept = Object.entries(store)
    .sort(([, a], [, b]) => weight(b, now) - weight(a, now))
    .slice(0, LIMIT)
  storage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)))
}

// Tus seguidos en el orden elegido. Recomendado: primero los que más ves; luego los que has abierto hace poco (recents,
// del más reciente al más antiguo); el resto, por espectadores, como Twitch.
export const sortFollowed = <
  Item extends { readonly login: string; readonly viewerCount?: number },
>(
  channels: readonly Item[],
  order: FollowedOrder,
  recents: readonly string[] = [],
  storage = storageOf(),
  now = Date.now(),
): Item[] => {
  const byViewers = [...channels].sort((a, b) => (b.viewerCount ?? 0) - (a.viewerCount ?? 0))
  if (order === "espectadores") return byViewers
  const store = read(storage)
  const recent = new Map(recents.map((login, index) => [login, index]))
  const rank = (item: Item): number => recent.get(item.login) ?? Number.POSITIVE_INFINITY
  return byViewers
    .map((item, index) => ({ index, item, minutes: weight(store[item.login], now) }))
    .sort((a, b) => b.minutes - a.minutes || rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item)
}

// Cuenta un minuto por cada minuto que «active» (sonando, en la pestaña que suena) sigue cierto en ese canal.
export const useWatchTime = (login: string | undefined, active: boolean): void => {
  useEffect(() => {
    if (login === undefined || !active) return undefined
    const timer = setInterval(() => addWatchMinute(login), MINUTE_MS)
    return () => clearInterval(timer)
  }, [active, login])
}

const readOrder = (storage = storageOf()): FollowedOrder =>
  storage?.getItem(ORDER_KEY) === "recomendado" ? "recomendado" : "espectadores"

// El orden elegido, el mismo en todas las pestañas: cambiarlo en una lo cambia en las demás (evento «storage»).
export const useFollowedOrder = (): readonly [FollowedOrder, (order: FollowedOrder) => void] => {
  const [order, setOrder] = useState(readOrder)
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === ORDER_KEY) setOrder(readOrder())
    }
    addEventListener("storage", onStorage)
    return () => removeEventListener("storage", onStorage)
  }, [])
  const choose = useCallback((next: FollowedOrder) => {
    storageOf()?.setItem(ORDER_KEY, next)
    setOrder(next)
  }, [])
  return [order, choose]
}
