// Red con Twitch para el reproductor propio: token de reproducción como invitado, lista maestra, VOD en curso y
// lectura del tiempo del contenido de un fragmento. API privada del reproductor web (sin Client-Integrity).
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
const VOD_ID_QUERY = `query($login: String!) { user(login: $login) { stream { archiveVideo { id } } } }`
const VOD_TOKEN_QUERY = `query($id: ID!) {
  videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature }
}`

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

export const getText = async (url: string, init: RequestInit = {}): Promise<string> => {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...init.headers },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new HttpError(response.status, url)
  return response.text()
}

export const getBytes = async (url: string, range = false): Promise<Bytes> => {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, ...(range ? { Range: "bytes=0-262143" } : {}) },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new HttpError(response.status, url)
  return new Uint8Array(await response.arrayBuffer())
}

type TokenData = { readonly signature: string; readonly value: string }

const gql = async (
  query: string,
  variables: Record<string, string>,
  device: string,
): Promise<unknown> =>
  JSON.parse(
    await getText("https://gql.twitch.tv/gql", {
      body: JSON.stringify({ query, variables }),
      headers: { "Client-ID": CLIENT_ID, "Content-Type": "text/plain", "X-Device-Id": device },
      method: "POST",
    }),
  )

const pick = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>(
    (node, key) =>
      typeof node === "object" && node !== null
        ? (node as Record<string, unknown>)[key]
        : undefined,
    value,
  )

const tokenOf = (value: unknown): TokenData | null => {
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
): Promise<OpenedVariant> => {
  const { platform, playerType } = sessionKind(source)
  const result = await gql(TOKEN_QUERY, { login: channel, platform, playerType }, device)
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
  readonly url: string
}

export interface VodSource {
  readonly segments: readonly VodSegment[]
  refresh(): Promise<void>
}

// El VOD que Twitch graba del directo: sin anuncios insertados y unos segundos por detrás del borde. Sus trozos son
// varios fragmentos del directo seguidos, con el mismo tiempo de contenido. Solo existe si el canal guarda VOD
// públicos.
export class Vod implements VodSource {
  id: string | null = null
  segments: readonly VodSegment[] = []
  private url: string | null = null

  constructor(
    private readonly channel: string,
    private readonly want: Want | null,
  ) {}

  async open(): Promise<void> {
    const device = deviceId()
    const id = pick(
      await gql(VOD_ID_QUERY, { login: this.channel }, device),
      "data",
      "user",
      "stream",
      "archiveVideo",
      "id",
    )
    if (typeof id !== "string") throw new Error("el canal no tiene VOD en curso")
    const token = tokenOf(
      pick(await gql(VOD_TOKEN_QUERY, { id }, device), "data", "videoPlaybackAccessToken"),
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
      await getText(`https://usher.ttvnw.net/vod/${id}.m3u8?${params}`),
      this.want,
    )
    if (variant === undefined) throw new Error("el VOD no tiene vídeo")
    this.url = variant.url
    this.id = id
  }

  async refresh(): Promise<void> {
    if (this.url === null) return
    const base = this.url.split("?")[0]?.replace(/[^/]*$/, "") ?? ""
    const absolute = (name: string): string => (name.startsWith("http") ? name : base + name)
    const segments: VodSegment[] = []
    let elapsed = 0
    let duration = 0
    let map: string | null = null
    for (const line of (await getText(this.url)).split("\n")) {
      if (line.startsWith("#EXT-X-MAP:")) {
        const uri = attrs(line.slice(11))["URI"]
        map = uri === undefined ? null : absolute(uri)
      } else if (line.startsWith("#EXTINF:")) duration = Number(line.slice(8).split(",")[0])
      else if (line !== "" && !line.startsWith("#")) {
        // Los trozos «-unmuted» no se pueden descargar: Twitch sirve la versión silenciada.
        segments.push({
          duration,
          elapsed,
          map,
          url: absolute(line.trim().replace(/-unmuted\.ts$/, "-muted.ts")),
        })
        elapsed += duration
      }
    }
    this.segments = segments
  }
}

// Pistas de vídeo de los segmentos de inicialización fMP4 ya leídos.
const tracks = new Map<string, VideoTrack | null>()
export const videoTrackOf = async (map: string): Promise<VideoTrack | null> => {
  if (!tracks.has(map)) tracks.set(map, fmp4VideoTrack(await getBytes(map)))
  return tracks.get(map) ?? null
}

// Tiempo del contenido al principio de un fragmento: PTS en TS, tfdt en fMP4 (map: su segmento de inicialización).
// Lee solo el principio (petición por rangos).
export const probeTime = async (url: string, map: string | null): Promise<number> => {
  const bytes = await getBytes(url, true)
  const time =
    map === null
      ? firstVideoPts(bytes)
      : await videoTrackOf(map).then((track) =>
          track === null ? null : fmp4FirstVideoTime(bytes, track),
        )
  if (time === null || !Number.isFinite(time)) throw new Error("fragmento sin tiempo de vídeo")
  return time
}
