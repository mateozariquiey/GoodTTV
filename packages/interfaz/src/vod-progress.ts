import type { VideoDetail } from "@goodttv/contratos"

// Por dónde va cada VOD (VOD-1; la extensión y Android): para reanudar donde se dejó y marcar en las listas lo visto.
// En el localStorage de la página, como Inicio de la última vez: se lee sin esperar, y las pestañas de la extensión lo
// comparten. Sin datos de la cuenta: solo vídeos públicos y posiciones.

const KEY = "vods-vistos"
const LIMIT = 100 // los más recientes; los demás se olvidan
// Cerca del final (o pasado el 97 %) cuenta como visto: volver a abrirlo empieza desde el principio.
const END_SLACK_S = 45
const SEEN_RATIO = 0.97
// Al reanudar, unos segundos antes de donde se dejó, para retomar el hilo.
export const RESUME_BACK_S = 5
// Lo que no llega a esto no se guarda: abrirlo y cerrarlo no lo deja «a medias».
const MIN_PROGRESS_S = 15

export type VodProgress = {
  readonly id: string
  readonly at: number // s
  readonly seconds: number // duración
  readonly updatedAt: number // ms
  readonly title: string
  readonly login: string
  readonly displayName: string
  readonly thumbnail: string | null
  readonly createdAt: string
}

type Store = Readonly<Record<string, VodProgress>>

// Lo último leído, mientras no cambie: cada tarjeta de una lista de vídeos pregunta por el suyo, y la lista se vuelve a
// pintar a menudo (con el chat o la posición del vídeo). Parsear las 100 entradas para cada tarjeta costaba.
let lastRead: { readonly raw: string; readonly storage: Storage; readonly store: Store } | null =
  null

const read = (storage: Storage | undefined): Store => {
  try {
    const raw = storage?.getItem(KEY) ?? "{}"
    if (storage !== undefined && lastRead?.storage === storage && lastRead.raw === raw)
      return lastRead.store
    const parsed: unknown = JSON.parse(raw)
    const store = typeof parsed === "object" && parsed !== null ? (parsed as Store) : {}
    if (storage !== undefined) lastRead = { raw, storage, store }
    return store
  } catch {
    return {}
  }
}

const valid = (entry: VodProgress | undefined): entry is VodProgress =>
  entry !== undefined &&
  typeof entry.id === "string" &&
  Number.isFinite(entry.at) &&
  Number.isFinite(entry.seconds) &&
  entry.seconds > 0

export const isSeen = (entry: VodProgress): boolean =>
  entry.at >= entry.seconds - END_SLACK_S || entry.at >= entry.seconds * SEEN_RATIO

const storageOf = (): Storage | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export const vodProgress = (id: string, storage = storageOf()): VodProgress | undefined => {
  const entry = read(storage)[id]
  return valid(entry) ? entry : undefined
}

// Dónde empezar: unos segundos antes de donde se dejó; desde el principio si no se empezó o ya se vio.
export const resumeAt = (entry: VodProgress | undefined): number =>
  entry === undefined || isSeen(entry) || entry.at < MIN_PROGRESS_S
    ? 0
    : Math.max(0, entry.at - RESUME_BACK_S)

export const saveVodProgress = (
  video: VideoDetail,
  at: number,
  storage = storageOf(),
  now = Date.now(),
): void => {
  if (storage === undefined || !Number.isFinite(at)) return
  const seconds = video.seconds > 0 ? video.seconds : at
  const store = { ...read(storage) }
  const previous = store[video.id]
  if (at < MIN_PROGRESS_S && (previous === undefined || previous.at < MIN_PROGRESS_S)) return
  store[video.id] = {
    at: Math.min(at, seconds),
    createdAt: video.createdAt,
    displayName: video.owner.displayName,
    id: video.id,
    login: video.owner.login,
    seconds,
    thumbnail: video.thumbnail,
    title: video.title.slice(0, 200),
    updatedAt: now,
  }
  const kept = Object.values(store)
    .filter(valid)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, LIMIT)
  try {
    storage.setItem(KEY, JSON.stringify(Object.fromEntries(kept.map((entry) => [entry.id, entry]))))
  } catch {
    // Sin sitio: se pierde esta posición, no el vídeo.
  }
}

// Los vídeos a medias, del último que se vio al primero (para «Seguir viendo»).
export const unfinishedVods = (storage = storageOf()): readonly VodProgress[] =>
  Object.values(read(storage))
    .filter(valid)
    .filter((entry) => entry.at >= MIN_PROGRESS_S && !isSeen(entry))
    .sort((a, b) => b.updatedAt - a.updatedAt)

export const forgetVodProgress = (id: string, storage = storageOf()): void => {
  const store = { ...read(storage) }
  delete store[id]
  storage?.setItem(KEY, JSON.stringify(store))
}
