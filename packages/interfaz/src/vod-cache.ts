import type { VideoDetail } from "@goodttv/contratos"

// La lista maestra y los datos de cada VOD (VOD-1; la extensión y Android), pedidos en cuanto es probable que se abra
// (al pasar el ratón por su tarjeta o empezar a tocarla, o, para retroceder un directo, el VOD que lo graba): al abrirlo,
// el reproductor ya los tiene. Retroceder un directo esperaba ~0,24 s a los datos antes de crear el reproductor. El
// token de la lista dura horas; los dos se guardan 5 min. Lo que falla no se guarda: se vuelve a pedir.
const KEEP_MS = 5 * 60_000
// Cada cuánto renovarlos mientras pueden hacer falta (el canal con su VOD en curso, para retroceder): antes de que
// caduquen, para que nunca haya que esperarlos (renewVod).
export const VOD_WARM_MS = 4 * 60_000

type Cache<Value> = Map<string, { readonly at: number; readonly value: Promise<Value> }>

const cached = <Value>(
  cache: Cache<Value>,
  id: string,
  load: () => Promise<Value>,
): Promise<Value> => {
  const entry = cache.get(id)
  if (entry !== undefined && Date.now() - entry.at < KEEP_MS) return entry.value
  const value = load()
  cache.set(id, { at: Date.now(), value })
  value.catch(() => {
    if (cache.get(id)?.value === value) cache.delete(id)
  })
  return value
}

// Pide otra vez sin esperar a que caduque; mientras llega, y si falla, sigue valiendo lo de antes.
const renew = <Value>(cache: Cache<Value>, id: string, load: () => Promise<Value>): void => {
  const value = load()
  value.then(
    () => cache.set(id, { at: Date.now(), value }),
    () => undefined,
  )
}

const urls: Cache<string> = new Map()
const details: Cache<VideoDetail | null> = new Map()

const vodsApi = () => {
  const vods = window.api.vods
  if (vods === undefined) throw new Error("sin VOD")
  return vods
}

const loadPlayback = async (id: string): Promise<string> => vodsApi().playback(id)
const loadDetail = async (id: string): Promise<VideoDetail | null> => vodsApi().get(id)

export const vodPlayback = (id: string): Promise<string> => cached(urls, id, () => loadPlayback(id))

export const vodDetail = (id: string): Promise<VideoDetail | null> =>
  cached(details, id, () => loadDetail(id))

export const prefetchVod = (id: string): void => {
  vodPlayback(id).catch(() => undefined)
  vodDetail(id).catch(() => undefined)
}

// Para tenerlos siempre a mano mientras pueden hacer falta: cada VOD_WARM_MS.
export const renewVod = (id: string): void => {
  renew(urls, id, () => loadPlayback(id))
  renew(details, id, () => loadDetail(id))
}
