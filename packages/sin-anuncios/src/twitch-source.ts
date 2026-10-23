// Red con Twitch para el reproductor propio: token de reproducción como invitado, lista maestra, VOD en curso y
// lectura del tiempo del contenido de un fragmento. API privada del reproductor web (sin Client-Integrity). Cada
// petición sale por el fetch que se le dé (en Android, la red nativa); si no, por el global.
import {
  type Bytes,
  firstVideoPts,
  fmp4FirstVideoTime,
  fmp4VideoTrack,
  type VideoTrack,
} from "./media-time"
import {
  attrs,
  broadcastIdOf,
  listVariants,
  pickVariant,
  type Variant,
  type Want,
} from "./playlist"

const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"
const TOKEN_QUERY = `query($login: String!, $playerType: String!, $platform: String!) {
  streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) { value signature }
}`
const VOD_ID_QUERY = `query($login: String!) { user(login: $login) { stream { archiveVideo { id recordedAt } } } }`
const VOD_TOKEN_QUERY = `query($id: ID!) {
  videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature }
}`

// Por dónde salen las peticiones a Twitch. Por defecto, el fetch global en el momento de pedir.
export type Fetch = typeof fetch
const globalFetch: Fetch = (input, init) => fetch(input, init)

export const deviceId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")

// Error HTTP con su código: 404 en usher significa que el canal no emite.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} ${url.slice(0, 60)}`)
  }
}

export const getText = async (
  url: string,
  init: RequestInit = {},
  red: Fetch = globalFetch,
): Promise<string> => {
  const response = await red(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...init.headers },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new HttpError(response.status, url)
  return response.text()
}

export const getBytes = async (
  url: string,
  range = false,
  red: Fetch = globalFetch,
): Promise<Bytes> => {
  const response = await red(url, {
    headers: { "User-Agent": USER_AGENT, ...(range ? { Range: "bytes=0-262143" } : {}) },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new HttpError(response.status, url)
  return new Uint8Array(await response.arrayBuffer())
}

export type TokenData = { readonly signature: string; readonly value: string }

// Una petición a GQL como invitado: una consulta, o una persistida (`extensions`) como las del reproductor web.
export const gqlRequest = async (
  body: Readonly<Record<string, unknown>>,
  device: string,
  red: Fetch = globalFetch,
): Promise<unknown> =>
  JSON.parse(
    await getText(
      "https://gql.twitch.tv/gql",
      {
        body: JSON.stringify(body),
        headers: { "Client-ID": CLIENT_ID, "Content-Type": "text/plain", "X-Device-Id": device },
        method: "POST",
      },
      red,
    ),
  )

const gql = (
  query: string,
  variables: Record<string, string>,
  device: string,
  red: Fetch,
): Promise<unknown> => gqlRequest({ query, variables }, device, red)

export const pick = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>(
    (node, key) =>
      typeof node === "object" && node !== null
        ? (node as Record<string, unknown>)[key]
        : undefined,
    value,
  )

export const tokenOf = (value: unknown): TokenData | null => {
  const signature = pick(value, "signature")
  const tokenValue = pick(value, "value")
  return typeof signature === "string" && typeof tokenValue === "string"
    ? { signature, value: tokenValue }
    : null
}

export type OpenedVariant = Variant & {
  readonly broadcastId: string | null
  readonly expires: number
  readonly variants: readonly Variant[]
}

// Tipo de sesión «tipo» o «tipo@plataforma» (por ejemplo, mobile_feed@android); sin plataforma, la web.
export const sessionKind = (
  source: string,
): { readonly platform: string; readonly playerType: string } => {
  const [playerType = source, platform = "web"] = source.split("@")
  return { platform, playerType }
}

// Abre una sesión de invitado de un tipo de reproductor (site, embed, popout, mobile_feed@android…) y elige la
// variante pedida.
export const openVariant = async (
  channel: string,
  source: string,
  device: string,
  want: Want | null,
  red: Fetch = globalFetch,
): Promise<OpenedVariant> => {
  const { platform, playerType } = sessionKind(source)
  const result = await gql(TOKEN_QUERY, { login: channel, platform, playerType }, device, red)
  const token = tokenOf(pick(result, "data", "streamPlaybackAccessToken"))
  if (token === null) throw new Error("sin token de reproducción")
  const params = new URLSearchParams({
    allow_audio_only: "true",
    allow_source: "true",
    fast_bread: "true",
    p: String(Math.floor(Math.random() * 1e7)),
    platform,
    player_backend: "mediaplayer",
    playlist_include_framerate: "true",
    sig: token.signature,
    supported_codecs: "h264",
    token: token.value,
  })
  const master = await getText(
    `https://usher.ttvnw.net/api/channel/hls/${channel.toLowerCase()}.m3u8?${params}`,
    {},
    red,
  )
  const variant = pickVariant(master, want)
  if (variant === undefined) throw new Error("la lista maestra no tiene vídeo")
  const expires = Number(pick(JSON.parse(token.value) as unknown, "expires") ?? 0)
  return { ...variant, broadcastId: broadcastIdOf(master), expires, variants: listVariants(master) }
}

export type VodSegment = {
  readonly duration: number
  readonly elapsed: number
  readonly map: string | null
  // Hora real de su principio, si la lista del VOD la trae (casi siempre; es la misma que la del directo). Un trozo
  // sin ella sigue la del anterior más su duración, como en HLS, salvo tras una discontinuidad.
  readonly pdt?: string | null
  readonly url: string
}

export interface VodSource {
  readonly segments: readonly VodSegment[]
  // Cuándo empezó a grabarse (ms desde 1970), para los trozos sin hora.
  readonly recordedAt?: number | null
  refresh(): Promise<void>
}

// Hora real (ms) del principio de un trozo del VOD: la de su lista o, si no la trae, cuándo empezó a grabarse más su
// posición, que en octubre de 2026 caía 1,6-2,4 s por detrás de la real (siete canales). null si no se sabe.
export const vodHour = (source: VodSource, segment: VodSegment): number | null => {
  const pdt = segment.pdt == null ? Number.NaN : Date.parse(segment.pdt)
  if (Number.isFinite(pdt)) return pdt
  return source.recordedAt == null ? null : source.recordedAt + segment.elapsed * 1000
}

// El VOD que Twitch graba del directo: sin anuncios insertados y unos segundos por detrás del borde. Sus trozos son
// varios fragmentos del directo seguidos, con el mismo tiempo de contenido. Solo existe si el canal guarda VOD
// públicos.
export class Vod implements VodSource {
  id: string | null = null
  recordedAt: number | null = null
  segments: readonly VodSegment[] = []
  private url: string | null = null

  constructor(
    private readonly channel: string,
    private readonly want: Want | null,
    private readonly red: Fetch = globalFetch,
  ) {}

  async open(): Promise<void> {
    const device = deviceId()
    const video = pick(
      await gql(VOD_ID_QUERY, { login: this.channel }, device, this.red),
      "data",
      "user",
      "stream",
      "archiveVideo",
    )
    const id = pick(video, "id")
    if (typeof id !== "string") throw new Error("el canal no tiene VOD en curso")
    const recordedAt = Date.parse(String(pick(video, "recordedAt")))
    const token = tokenOf(
      pick(
        await gql(VOD_TOKEN_QUERY, { id }, device, this.red),
        "data",
        "videoPlaybackAccessToken",
      ),
    )
    if (token === null) throw new Error("sin token del VOD")
    const params = new URLSearchParams({
      allow_source: "true",
      p: String(Math.floor(Math.random() * 1e7)),
      platform: "web",
      player_backend: "mediaplayer",
      playlist_include_framerate: "true",
      sig: token.signature,
      supported_codecs: "h264",
      token: token.value,
    })
    const variant = pickVariant(
      await getText(`https://usher.ttvnw.net/vod/${id}.m3u8?${params}`, {}, this.red),
      this.want,
    )
    if (variant === undefined) throw new Error("el VOD no tiene vídeo")
    this.url = variant.url
    this.id = id
    this.recordedAt = Number.isFinite(recordedAt) ? recordedAt : null
  }

  async refresh(): Promise<void> {
    if (this.url === null) return
    const base = this.url.split("?")[0]?.replace(/[^/]*$/, "") ?? ""
    const absolute = (name: string): string => (name.startsWith("http") ? name : base + name)
    const segments: VodSegment[] = []
    let elapsed = 0
    let duration = 0
    let map: string | null = null
    let pdt: string | null = null
    for (const line of (await getText(this.url, {}, this.red)).split("\n")) {
      if (line.startsWith("#EXT-X-MAP:")) {
        const uri = attrs(line.slice(11))["URI"]
        map = uri === undefined ? null : absolute(uri)
      } else if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) pdt = line.slice(25).trim()
      else if (line.startsWith("#EXT-X-DISCONTINUITY")) pdt = null
      else if (line.startsWith("#EXTINF:")) duration = Number(line.slice(8).split(",")[0])
      else if (line !== "" && !line.startsWith("#")) {
        // Los trozos «-unmuted» no se pueden descargar: Twitch sirve la versión silenciada.
        segments.push({
          duration,
          elapsed,
          map,
          pdt,
          url: absolute(line.trim().replace(/-unmuted\.ts$/, "-muted.ts")),
        })
        elapsed += duration
        // El siguiente, si no trae la suya, empieza donde acaba este.
        const start: number = pdt === null ? Number.NaN : Date.parse(pdt)
        pdt = Number.isFinite(start) ? new Date(start + duration * 1000).toISOString() : null
      }
    }
    this.segments = segments
  }
}

// Pistas de vídeo de los segmentos de inicialización fMP4 ya leídos.
const tracks = new Map<string, VideoTrack | null>()
export const videoTrackOf = async (
  map: string,
  red: Fetch = globalFetch,
): Promise<VideoTrack | null> => {
  if (!tracks.has(map)) tracks.set(map, fmp4VideoTrack(await getBytes(map, false, red)))
  return tracks.get(map) ?? null
}

// Tiempo del contenido al principio de un fragmento: PTS en TS, tfdt en fMP4 (map: su segmento de inicialización).
// Lee solo el principio (petición por rangos).
export const probeTime = async (
  url: string,
  map: string | null,
  red: Fetch = globalFetch,
): Promise<number> => {
  const bytes = await getBytes(url, true, red)
  const time =
    map === null
      ? firstVideoPts(bytes)
      : await videoTrackOf(map, red).then((track) =>
          track === null ? null : fmp4FirstVideoTime(bytes, track),
        )
  if (time === null || !Number.isFinite(time)) throw new Error("fragmento sin tiempo de vídeo")
  return time
}
