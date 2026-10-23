// Los VOD de Twitch (VOD-1; la extensión y Android, D24): los vídeos de un canal, la lista maestra para verlos sin
// anuncios (como el relleno del empalme: usher no los inserta), las miniaturas de la barra y el chat del vídeo. API
// privada del reproductor web, como invitado y sin Client-Integrity: por eso el chat se pide por posición (pedirlo por
// cursor exige integridad, comprobado el 21 de octubre). Cada petición sale por el fetch que se dé.
import { deviceId, type Fetch, getText, gqlRequest, pick, tokenOf } from "./twitch-source"

const globalFetch: Fetch = (input, init) => fetch(input, init)

export type VideoKind = "archive" | "highlight" | "upload"

export type VideoCard = {
  readonly id: string
  readonly title: string
  readonly seconds: number
  readonly createdAt: string // ISO
  readonly views: number
  readonly kind: VideoKind
  readonly category: string | null
  readonly thumbnail: string | null // 320 × 180
  readonly storyboard: string | null // las miniaturas de la barra (info.json)
}

export type VideoOwner = {
  readonly id: string
  readonly login: string
  readonly displayName: string
  readonly avatar: string | null
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null
const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

const VIDEO_FIELDS = `id title lengthSeconds createdAt viewCount broadcastType
  previewThumbnailURL(width: 320, height: 180) game { displayName } seekPreviewsURL`
const OWNER_FIELDS = "id login displayName profileImageURL(width: 70)"

const KINDS: Readonly<Record<string, VideoKind>> = {
  ARCHIVE: "archive",
  HIGHLIGHT: "highlight",
  UPLOAD: "upload",
}

const toCard = (node: unknown): VideoCard | null => {
  const id = text(pick(node, "id"))
  if (id === null || !/^\d{1,20}$/.test(id)) return null
  const thumbnail = text(pick(node, "previewThumbnailURL"))
  return {
    category: text(pick(node, "game", "displayName")),
    createdAt: text(pick(node, "createdAt")) ?? new Date(0).toISOString(),
    id,
    kind: KINDS[String(pick(node, "broadcastType"))] ?? "archive",
    seconds: number(pick(node, "lengthSeconds")),
    storyboard: text(pick(node, "seekPreviewsURL")),
    // Sin miniatura todavía, Twitch da la de «404_processing».
    thumbnail: thumbnail?.includes("404_processing") === true ? null : thumbnail,
    title: text(pick(node, "title")) ?? "",
    views: number(pick(node, "viewCount")),
  }
}

const toOwner = (node: unknown): VideoOwner | null => {
  const id = text(pick(node, "id"))
  const login = text(pick(node, "login"))
  if (id === null || login === null) return null
  return {
    avatar: text(pick(node, "profileImageURL")),
    displayName: text(pick(node, "displayName")) ?? login,
    id,
    login,
  }
}

// Los vídeos de un canal, del más reciente al más antiguo: las emisiones (archive) y, aparte, los destacados y los
// subidos si se piden. null si el canal no existe.
export const videosOf = async (
  login: string,
  {
    first = 30,
    kind = "archive",
    red = globalFetch,
  }: { first?: number; kind?: VideoKind; red?: Fetch } = {},
): Promise<{ readonly owner: VideoOwner; readonly videos: readonly VideoCard[] } | null> => {
  const type = Object.entries(KINDS).find(([, value]) => value === kind)?.[0] ?? "ARCHIVE"
  const data = await gqlRequest(
    {
      query: `query($login: String!, $first: Int!) { user(login: $login) { ${OWNER_FIELDS}
        videos(first: $first, type: ${type}, sort: TIME) { edges { node { ${VIDEO_FIELDS} } } } } }`,
      variables: { first: Math.min(100, Math.max(1, first)), login: login.toLowerCase() },
    },
    deviceId(),
    red,
  )
  const user = pick(data, "data", "user")
  const owner = toOwner(user)
  if (owner === null) return null
  const edges = pick(user, "videos", "edges")
  const videos = (Array.isArray(edges) ? edges : [])
    .map((edge) => toCard(pick(edge, "node")))
    .filter((card): card is VideoCard => card !== null)
  return { owner, videos }
}

// Un vídeo con su canal; null si no existe (o ya no se puede ver).
export const videoById = async (
  id: string,
  red: Fetch = globalFetch,
): Promise<(VideoCard & { readonly owner: VideoOwner }) | null> => {
  const data = await gqlRequest(
    {
      query: `query($id: ID!) { video(id: $id) { ${VIDEO_FIELDS} owner { ${OWNER_FIELDS} } } }`,
      variables: { id },
    },
    deviceId(),
    red,
  )
  const node = pick(data, "data", "video")
  const card = toCard(node)
  const owner = toOwner(pick(node, "owner"))
  return card === null || owner === null ? null : { ...card, owner }
}

const VOD_TOKEN_QUERY = `query($id: ID!) {
  videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature }
}`

// La lista maestra del vídeo en usher, con su token de invitado: se le da a hls.js (o a Media3) tal cual. Los VOD solo
// para suscriptores no se pueden ver así: usher contesta 403.
export const vodMasterUrl = async (id: string, red: Fetch = globalFetch): Promise<string> => {
  const token = tokenOf(
    pick(
      await gqlRequest({ query: VOD_TOKEN_QUERY, variables: { id } }, deviceId(), red),
      "data",
      "videoPlaybackAccessToken",
    ),
  )
  if (token === null) throw new Error("sin token del vídeo")
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
  return `https://usher.ttvnw.net/vod/${id}.m3u8?${params}`
}

// Las miniaturas de la barra: hojas de cols × rows imágenes, una cada «interval» s. La de más calidad.
export type Storyboard = {
  readonly cols: number
  readonly rows: number
  readonly width: number
  readonly height: number
  readonly interval: number
  readonly count: number
  readonly sheets: readonly string[]
}

export const storyboardOf = async (
  url: string,
  red: Fetch = globalFetch,
): Promise<Storyboard | null> => {
  const parsed: unknown = JSON.parse(await getText(url, {}, red))
  if (!Array.isArray(parsed)) return null
  const base = url.replace(/[^/]*$/, "")
  const boards = parsed
    .map((board): Storyboard | null => {
      const images = pick(board, "images")
      const sheets = Array.isArray(images)
        ? images.filter((image) => typeof image === "string")
        : []
      const cols = number(pick(board, "cols"))
      const rows = number(pick(board, "rows"))
      const interval = number(pick(board, "interval"))
      if (sheets.length === 0 || cols < 1 || rows < 1 || interval <= 0) return null
      return {
        cols,
        count: number(pick(board, "count")),
        height: number(pick(board, "height")),
        interval,
        rows,
        sheets: sheets.map((image) => (image.startsWith("http") ? image : base + image)),
        width: number(pick(board, "width")),
      }
    })
    .filter((board): board is Storyboard => board !== null)
  return boards.sort((a, b) => b.width - a.width)[0] ?? null
}

// Dónde está la miniatura del segundo «at»: la hoja y la posición dentro de ella, en miniaturas.
export const thumbnailAt = (
  board: Storyboard,
  at: number,
): { readonly sheet: string; readonly col: number; readonly row: number } | null => {
  const index = Math.min(Math.max(0, Math.floor(at / board.interval)), Math.max(0, board.count - 1))
  const perSheet = board.cols * board.rows
  const sheet = board.sheets[Math.floor(index / perSheet)]
  if (sheet === undefined) return null
  const inSheet = index % perSheet
  return { col: inSheet % board.cols, row: Math.floor(inSheet / board.cols), sheet }
}

export type VideoComment = {
  readonly id: string
  readonly offset: number // s desde el principio del vídeo
  readonly userId: string
  readonly login: string
  readonly displayName: string
  readonly color: string | null
  readonly badges: readonly { readonly setId: string; readonly version: string }[]
  readonly fragments: readonly { readonly text: string; readonly emoteId: string | null }[]
}

// La consulta persistida del reproductor web. Si Twitch la cambia, el chat del vídeo deja de llegar (y el vídeo sigue).
const COMMENTS_HASH = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"

// Los mensajes del chat desde un segundo del vídeo (Twitch da unos 50, empezando algo antes): para seguir, se pide
// desde el último más uno, y se descartan los repetidos por su id.
export const commentsFrom = async (
  id: string,
  offset: number,
  red: Fetch = globalFetch,
): Promise<readonly VideoComment[]> => {
  const data = await gqlRequest(
    {
      extensions: { persistedQuery: { sha256Hash: COMMENTS_HASH, version: 1 } },
      operationName: "VideoCommentsByOffsetOrCursor",
      variables: { contentOffsetSeconds: Math.max(0, Math.floor(offset)), videoID: id },
    },
    deviceId(),
    red,
  )
  const edges = pick(data, "data", "video", "comments", "edges")
  return (Array.isArray(edges) ? edges : [])
    .map((edge): VideoComment | null => {
      const node = pick(edge, "node")
      const commentId = text(pick(node, "id"))
      const userId = text(pick(node, "commenter", "id"))
      const login = text(pick(node, "commenter", "login"))
      if (commentId === null || userId === null || login === null) return null
      const fragments = pick(node, "message", "fragments")
      const badges = pick(node, "message", "userBadges")
      return {
        badges: (Array.isArray(badges) ? badges : [])
          .map((badge) => ({
            setId: String(pick(badge, "setID") ?? ""),
            version: String(pick(badge, "version") ?? ""),
          }))
          .filter((badge) => badge.setId !== ""),
        color: text(pick(node, "message", "userColor")),
        displayName: text(pick(node, "commenter", "displayName")) ?? login,
        fragments: (Array.isArray(fragments) ? fragments : []).map((fragment) => ({
          emoteId: text(pick(fragment, "emote", "emoteID")),
          text: String(pick(fragment, "text") ?? ""),
        })),
        id: commentId,
        login,
        offset: number(pick(node, "contentOffsetSeconds")),
        userId,
      }
    })
    .filter((comment): comment is VideoComment => comment !== null)
}

// La emisión en curso de un canal y su VOD (DVR-1, retroceder el directo): cuándo empezó y el vídeo que la graba, si el
// canal guarda sus emisiones. null si no emite.
export type LiveArchive = {
  readonly startedAt: string // ISO, cuándo empezó la emisión
  readonly archiveId: string | null
  readonly recordedAt: string | null // ISO, cuándo empezó a grabarse el VOD
}

export const liveArchive = async (
  login: string,
  red: Fetch = globalFetch,
): Promise<LiveArchive | null> => {
  const data = await gqlRequest(
    {
      query: `query($login: String!) { user(login: $login) { stream { createdAt archiveVideo { id recordedAt } } } }`,
      variables: { login: login.toLowerCase() },
    },
    deviceId(),
    red,
  )
  const stream = pick(data, "data", "user", "stream")
  const startedAt = text(pick(stream, "createdAt"))
  if (startedAt === null) return null
  const archiveId = text(pick(stream, "archiveVideo", "id"))
  return {
    archiveId: archiveId !== null && /^\d{1,20}$/.test(archiveId) ? archiveId : null,
    recordedAt: text(pick(stream, "archiveVideo", "recordedAt")),
    startedAt,
  }
}
