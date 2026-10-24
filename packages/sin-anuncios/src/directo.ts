// Directo sin anuncios para un reproductor hls.js, sin depender del transporte. Atiende las rutas /stream/ con
// Response estándar: en la tele las sirve el servidor HTTPS local (apps/tele/src/main/stream/stream-service.ts) y en
// la extensión, la propia página atiende con ellas sus fetch (directo-fetch.ts).
//   /stream/<login>/live.m3u8?modo=…[&q=WxH@fps][&visita=…]  lista HLS (recarga bloqueante con _HLS_msn)
//   /stream/<login>/info?…                 duración de los fragmentos, calidades y si el canal emite
//   /stream/<login>/precalentar?modo=…     abre ya el empalme de un canal que probablemente se va a abrir
//   /stream/vod?u=…[&desde=…&map=…]        trozos del VOD (no traen CORS), recortados si hace falta
// Un canal a la vez (más uno precalentado): pedir otro, u otra calidad, para el anterior. Sin peticiones en 30 s, se
// para.
import { Empalme, type EmpalmeEvent, type EmpalmeOptions } from "./empalme"
import { type Bytes, firstVideoPts, fmp4FirstVideoTime, trimFmp4, trimTs } from "./media-time"
import { AUDIO_ONLY, type Want } from "./playlist"
import { type Fetch, getBytes, HttpError, videoTrackOf } from "./twitch-source"

const LOGIN = /^[a-z0-9_]{1,25}$/
// Modos de retraso (LatencyMode en los contratos de cada app) y lo que cambia en el empalme.
const MODES = {
  adaptativo: { fillSlack: 2, startBackSeconds: null, vod: true },
  directo: { fillSlack: 2, startBackSeconds: null, vod: false },
  "sin-paradas": { fillSlack: null, startBackSeconds: 24, vod: true },
} as const
type Mode = keyof typeof MODES
const modeOf = (value: string | null): Mode =>
  value !== null && Object.hasOwn(MODES, value) ? (value as Mode) : "adaptativo"
const QUALITY = /^(\d{2,5}x\d{2,5}|audio_only)@(\d{1,3})$/
const VISIT = /^[a-z0-9]{1,40}$/ // una por reproductor creado en la página
const IDLE_MS = 30_000
// El de antes de un cambio de calidad, sin peticiones de su reproductor durante esto, se para (ver ensure).
const OUTGOING_IDLE_MS = 10_000
// Cuánto se retiene una petición de la lista hasta que haya un fragmento nuevo. Largo para que una espera del relleno
// con el VOD (sin nada nuevo durante 15-25 s) no acabe en una respuesta sin novedades: tras ella, hls.js no vuelve a
// preguntar hasta pasados TARGETDURATION/2 (6,5 s con relleno). Por debajo de IDLE_MS; el reproductor espera la
// respuesta algo más (playlistLoadPolicy en useHlsPlayer.ts).
const BLOCK_MS = 20_000

// Lo que el directo usa del empalme (sustituible en las pruebas).
export type DirectoEmpalme = Pick<
  Empalme,
  | "changed"
  | "knowsVodUrl"
  | "lastPublished"
  | "liveSegmentDuration"
  | "newVisit"
  | "playlist"
  | "start"
  | "status"
  | "stop"
  | "waitFor"
>

export type SimulatedPause = {
  readonly atStart: boolean
  readonly every: number
  readonly length: number
}

// "cada,duración[,arranque]" (s): pausas globales simuladas para probar el relleno; con arranque=1, también una al
// abrir el canal (todas las sesiones con anuncio de entrada). cada=0: solo esa. En la tele llega en
// GOODTTV_PAUSA_SIMULADA.
export const parseSimulatedPause = (text: string): SimulatedPause | null => {
  const [every = 0, length = 0, atStart = 0] = text.split(",").map(Number)
  return length > 0 && (every > 0 || atStart === 1)
    ? { atStart: atStart === 1, every, length }
    : null
}

export type DirectoOptions = {
  // Por dónde se pide a Twitch: en la extensión, el fetch del navegador sin pasar por el directo; en Android, la red
  // nativa. Si no, el fetch global.
  readonly fetch?: Fetch
  readonly log?: (event: EmpalmeEvent) => void
  readonly simulatedPause?: SimulatedPause | null
  readonly createEmpalme?: (options: EmpalmeOptions) => DirectoEmpalme
}

export type DirectoRequest = {
  readonly range?: string | null // cabecera Range, solo para los trozos del VOD sin recortar
  readonly signal?: AbortSignal // quien pide ya no espera la respuesta
}

export type Directo = {
  readonly handle: (url: URL, request?: DirectoRequest) => Promise<Response>
  readonly stop: () => void
}

type Active = {
  readonly empalme: DirectoEmpalme
  readonly login: string
  readonly mode: Mode
  readonly quality: string | null
  lastUse: number
  visit: string | null
  served: { readonly visit: string; readonly n: number } | null // la última lista entregada y a qué reproductor
}

// Los trozos salen de fetch o de recortarlos en memoria: siempre sobre un ArrayBuffer, aunque Bytes no lo diga.
const reply = (status: number, type: string, body?: string | Bytes): Response =>
  new Response((body as string | Uint8Array<ArrayBuffer> | undefined) ?? null, {
    headers: {
      "cache-control": "no-store",
      "content-type": type,
      "x-content-type-options": "nosniff",
    },
    status,
  })
const TEXT = "text/plain; charset=utf-8"

// En Node (la tele), que un temporizador pendiente no impida cerrar el proceso; en el navegador no hace falta.
const unref = (timer: ReturnType<typeof setTimeout>): void => {
  ;(timer as unknown as { unref?: () => void }).unref?.()
}

export const createDirecto = ({
  createEmpalme = (options) => new Empalme(options),
  fetch: red = (input, init) => fetch(input, init),
  log = () => undefined,
  simulatedPause = null,
}: DirectoOptions = {}): Directo => {
  let active: Active | undefined
  let warm: Active | undefined // precalentado (ver prewarm)
  let outgoing: Active | undefined // el de antes de cambiar de calidad, para su reproductor (ver ensure)
  const trimmed = new Map<string, Bytes>() // «url|comienzo» → trozo recortado y comprobado (5 min)

  // Recorte comprobado: se descarga el trozo, se corta y se mide dónde empieza de verdad.
  const trimVod = async (url: string, from: number, map: string | null): Promise<number | null> => {
    const bytes = await getBytes(url, false, red)
    const track = map === null ? null : await videoTrackOf(map, red)
    const cut =
      map === null ? trimTs(bytes, from) : track === null ? null : trimFmp4(bytes, track, from)
    const start =
      cut === null ? null : track === null ? firstVideoPts(cut) : fmp4FirstVideoTime(cut, track)
    if (cut === null || start === null || !Number.isFinite(start)) return null
    const key = `${url}|${start}`
    trimmed.set(key, cut)
    unref(setTimeout(() => trimmed.delete(key), 300_000))
    return start
  }

  const vodUrl = (url: string, from: number | null, map: string | null): string => {
    const query = new URLSearchParams({ u: url })
    if (from !== null) query.set("desde", String(from))
    if (from !== null && map !== null) query.set("map", map)
    return `/stream/vod?${query}`
  }

  const stopActive = (): void => {
    active?.empalme.stop()
    active = undefined
  }
  const stopWarm = (): void => {
    warm?.empalme.stop()
    warm = undefined
  }
  const stopOutgoing = (): void => {
    outgoing?.empalme.stop()
    outgoing = undefined
  }

  const matches = (
    stream: Active | undefined,
    login: string,
    quality: string | null,
    mode: Mode,
  ): stream is Active => {
    if (stream === undefined || stream.login !== login || stream.mode !== mode) return false
    // Sin calidad pedida (la automática), el empalme elige una, y pedir después esa misma no lo recrea. Pero uno abierto
    // con otra pedida no vale para la automática: al volver a «Auto» tras elegir 720p, se quedaba en 720p.
    const current = stream.quality ?? stream.empalme.status().quality ?? null
    return quality === null ? stream.quality === null : current === quality
  }

  const create = (
    login: string,
    quality: string | null,
    mode: Mode,
    visit: string | null,
  ): Active => {
    const match = quality === null ? null : QUALITY.exec(quality)
    const want: Want | null =
      match === null ? null : { fps: Number(match[2]), resolution: match[1] ?? "" }
    const settings = MODES[mode]
    // En solo audio, sin el relleno con el VOD: sus trozos son de vídeo, y se sitúan por la imagen. En una pausa de
    // anuncios en todas las sesiones, silencio, como en el modo directo.
    const audioOnly = want?.resolution === AUDIO_ONLY
    const empalme = createEmpalme({
      channel: login,
      fetch: red,
      fillSlack: settings.fillSlack,
      log: (event) => log({ ...event, canal: login }),
      simulatedPause,
      startBackSeconds: settings.startBackSeconds,
      vod: settings.vod && !audioOnly,
      vodTrimmer: trimVod,
      vodUrl,
      want,
    })
    void empalme.start()
    return { empalme, lastUse: Date.now(), login, mode, quality, served: null, visit }
  }

  // Otra calidad del mismo canal para otro reproductor (otra visita): el empalme de antes no se para todavía, sigue
  // sirviendo al suyo hasta que deja de pedir. En Android, el que suena mientras se prepara el nuevo al pasar a solo audio
  // o volver al vídeo (el relevo, Reproductor.kt), sin corte; en todas, una petición tardía del reproductor de antes ya
  // no para el nuevo. Con otro canal, se paran los dos, como siempre.
  const ensure = (
    login: string,
    quality: string | null,
    mode: Mode,
    visit: string | null,
  ): Active => {
    if (visit !== null && outgoing?.visit === visit && matches(outgoing, login, quality, mode)) {
      outgoing.lastUse = Date.now()
      return outgoing
    }
    const previous: Active | undefined = active // sin el estrechamiento de matches()
    if (!matches(active, login, quality, mode)) {
      const sameChannel = previous?.login === login && previous.mode === mode
      if (sameChannel && previous?.visit != null && visit !== null && previous.visit !== visit) {
        stopOutgoing()
        outgoing = previous
        active = undefined
      } else {
        stopActive()
        if (!sameChannel) stopOutgoing()
      }
      if (matches(warm, login, quality, mode)) {
        active = warm // ya precalentado: con parte del arranque hecho
        warm = undefined
      } else active = create(login, quality, mode, visit)
    }
    active.lastUse = Date.now()
    if (visit !== null && visit !== active.visit) {
      active.visit = visit
      active.empalme.newVisit()
    }
    return active
  }

  // Precalentar: abre ya, sin parar el que suena, el empalme de un canal que probablemente se va a abrir (el ratón se
  // para encima o el foco se queda en él). Si se abre, pasa a ser el activo con el directo ya publicado; si no, se para
  // como cualquier otro sin peticiones (IDLE_MS). Uno solo a la vez.
  const prewarm = (login: string, quality: string | null, mode: Mode): void => {
    if (matches(active, login, quality, mode)) {
      active.lastUse = Date.now()
      return
    }
    if (!matches(warm, login, quality, mode)) {
      stopWarm()
      warm = create(login, quality, mode, null)
      log({ canal: login, ev: "precalentado" })
    }
    warm.lastUse = Date.now()
  }

  const idle = setInterval(() => {
    if (active !== undefined && Date.now() - active.lastUse > IDLE_MS) stopActive()
    if (warm !== undefined && Date.now() - warm.lastUse > IDLE_MS) stopWarm()
    if (outgoing !== undefined && Date.now() - outgoing.lastUse > OUTGOING_IDLE_MS) stopOutgoing()
  }, 5000)
  unref(idle)

  const serveVod = async (query: URLSearchParams, request: DirectoRequest): Promise<Response> => {
    const target = query.get("u") ?? ""
    const map = query.get("map")
    // Solo URL que el empalme ha publicado (el activo o, en un relevo, el de antes): no es un proxy abierto.
    const empalme = [active, outgoing].find((stream) =>
      stream?.empalme.knowsVodUrl(target),
    )?.empalme
    if (empalme === undefined || (map !== null && !empalme.knowsVodUrl(map))) {
      return reply(403, TEXT)
    }
    const desde = query.get("desde")
    if (desde !== null) {
      // Trozo recortado: el que se comprobó al publicarlo; si caducó, se recorta otra vez y debe empezar igual.
      let body = trimmed.get(`${target}|${desde}`)
      if (body === undefined) {
        const start = await trimVod(target, Number(desde), map)
        if (start !== null && Math.abs(start - Number(desde)) < 0.001)
          body = trimmed.get(`${target}|${start}`)
      }
      if (body === undefined) return reply(502, TEXT)
      return reply(200, map === null ? "video/mp2t" : "video/mp4", body)
    }
    const timeout = AbortSignal.timeout(20_000)
    const upstream = await red(target, {
      headers: request.range == null ? {} : { Range: request.range },
      redirect: "error",
      signal: request.signal === undefined ? timeout : AbortSignal.any([timeout, request.signal]),
    })
    const headers: Record<string, string> = {
      "cache-control": "no-store",
      "content-type": upstream.headers.get("content-type") ?? "video/mp2t",
    }
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name)
      if (value !== null) headers[name] = value
    }
    return new Response(upstream.body, { headers, status: upstream.status })
  }

  // Espera a que haya algo publicado (o a saber que el canal no emite) antes de responder: contesta en cuanto el
  // empalme cambia, sin sondear.
  const serveInfo = async (stream: Active, signal: AbortSignal | undefined): Promise<Response> => {
    const started = Date.now()
    let status = stream.empalme.status()
    while (
      status.published === 0 &&
      !status.offline &&
      Date.now() - started < 20_000 &&
      signal?.aborted !== true &&
      stream === active // si se paró (otro canal), changed() ya no espera: el bucle no cedería el hilo
    ) {
      await stream.empalme.changed(Math.min(1000, 20_000 - (Date.now() - started)), signal)
      status = stream.empalme.status()
    }
    log({ canal: stream.login, ev: "info", ms: Date.now() - started, publicados: status.published })
    return reply(
      200,
      "application/json; charset=utf-8",
      JSON.stringify({ ...status, segmentDuration: stream.empalme.liveSegmentDuration() }),
    )
  }

  // Recarga bloqueante: hls.js pide _HLS_msn=N y la respuesta espera a que exista el fragmento N. Sin _HLS_msn, si ese
  // mismo reproductor (visita) ya tiene lo último, también se espera a algo nuevo: es como pregunta hls.js tras una
  // respuesta sin novedades, y si vuelve a recibir la misma lista no pregunta otra vez hasta pasados 6,5 s.
  const servePlaylist = async (
    stream: Active,
    query: URLSearchParams,
    signal: AbortSignal | undefined,
  ): Promise<Response> => {
    const msn = Number(query.get("_HLS_msn"))
    const visit = query.get("visita")
    if (Number.isFinite(msn) && msn > 0) await stream.empalme.waitFor(msn, BLOCK_MS, signal)
    else if (visit !== null && stream.served?.visit === visit) {
      await stream.empalme.waitFor(stream.served.n + 1, BLOCK_MS, signal)
    }
    stream.lastUse = Date.now()
    const text = stream.empalme.playlist()
    const n = stream.empalme.lastPublished()
    if (text === null || n === null) return reply(stream.empalme.status().offline ? 404 : 503, TEXT)
    if (visit !== null && VISIT.test(visit)) stream.served = { n, visit }
    return reply(200, "application/vnd.apple.mpegurl", text)
  }

  const route = (url: URL, request: DirectoRequest): Promise<Response> => {
    const query = url.searchParams
    if (url.pathname === "/stream/vod") return serveVod(query, request)
    const [, , login = "", resource = ""] = url.pathname.split("/")
    if (!LOGIN.test(login) || !["info", "live.m3u8", "precalentar"].includes(resource)) {
      return Promise.resolve(reply(404, TEXT))
    }
    const q = query.get("q")
    const quality = q !== null && QUALITY.test(q) ? q : null
    const mode = modeOf(query.get("modo"))
    if (resource === "precalentar") {
      prewarm(login, quality, mode)
      return Promise.resolve(reply(204, TEXT))
    }
    const visit = query.get("visita")
    const stream = ensure(login, quality, mode, visit !== null && VISIT.test(visit) ? visit : null)
    return resource === "info"
      ? serveInfo(stream, request.signal)
      : servePlaylist(stream, query, request.signal)
  }

  const handle = async (url: URL, request: DirectoRequest = {}): Promise<Response> => {
    if (!url.pathname.startsWith("/stream/")) return reply(404, TEXT)
    try {
      return await route(url, request)
    } catch (error) {
      // Si quien pide ya no espera (hls.js canceló el trozo), nadie leerá la respuesta: no es un error del servidor.
      if (request.signal?.aborted !== true)
        log({ error: String(error).slice(0, 160), ev: "error-servidor" })
      return reply(error instanceof HttpError ? 502 : 500, TEXT)
    }
  }

  return {
    handle,
    stop: () => {
      clearInterval(idle)
      stopActive()
      stopWarm()
      stopOutgoing()
    },
  }
}
