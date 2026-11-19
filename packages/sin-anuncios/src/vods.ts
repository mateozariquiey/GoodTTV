// Los VOD de Twitch (VOD-1; la extensión y Android, D24): los vídeos de un canal, la lista maestra para verlos sin
// anuncios (como el relleno del empalme: usher no los inserta), las miniaturas de la barra y el chat del vídeo. API
// privada del reproductor web, como invitado y sin Client-Integrity: por eso el chat se pide por posición (pedirlo por
// cursor exige integridad, comprobado el 21 de octubre). Cada petición sale por el fetch que se dé.
import type {
  LiveArchive,
  Storyboard,
  VideoCard,
  VideoDetail,
  VideoList,
  VideoOwner,
} from "@goodttv/contratos"
import { globalFetch, NUMERIC_ID, textOf } from "./comun"
import {
  deviceId,
  type Fetch,
  getText,
  gqlRequest,
  pick,
  vodMasterOf,
  vodToken,
} from "./twitch-source"

const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

const VIDEO_FIELDS = `id title lengthSeconds createdAt viewCount
  previewThumbnailURL(width: 320, height: 180) game { displayName } seekPreviewsURL`
const OWNER_FIELDS = "id login displayName profileImageURL(width: 70)"

const toCard = (node: unknown): VideoCard | null => {
  const id = textOf(pick(node, "id"))
  if (id === null || !NUMERIC_ID.test(id)) return null
  const thumbnail = textOf(pick(node, "previewThumbnailURL"))
  return {
    category: textOf(pick(node, "game", "displayName")),
    createdAt: textOf(pick(node, "createdAt")) ?? new Date(0).toISOString(),
    id,
    seconds: number(pick(node, "lengthSeconds")),
    storyboard: textOf(pick(node, "seekPreviewsURL")),
    // Sin miniatura todavía, Twitch da la de «404_processing».
    thumbnail: thumbnail?.includes("404_processing") === true ? null : thumbnail,
    title: textOf(pick(node, "title")) ?? "",
    views: number(pick(node, "viewCount")),
  }
}

const toOwner = (node: unknown): VideoOwner | null => {
  const id = textOf(pick(node, "id"))
  const login = textOf(pick(node, "login"))
  if (id === null || login === null) return null
  return {
    avatar: textOf(pick(node, "profileImageURL")),
    displayName: textOf(pick(node, "displayName")) ?? login,
    id,
    login,
  }
}

// Las emisiones guardadas de un canal (sin los destacados ni los subidos), de la más reciente a la más antigua. null si
// el canal no existe.
export const videosOf = async (
  login: string,
  { first = 30, red = globalFetch }: { first?: number; red?: Fetch } = {},
): Promise<VideoList | null> => {
  const data = await gqlRequest(
    {
      query: `query($login: String!, $first: Int!) { user(login: $login) { ${OWNER_FIELDS}
        videos(first: $first, type: ARCHIVE, sort: TIME) { edges { node { ${VIDEO_FIELDS} } } } } }`,
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
): Promise<VideoDetail | null> => {
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

// La lista maestra del vídeo en usher, con su token de invitado: se le da a hls.js (o a Media3) tal cual. Los VOD solo
// para suscriptores no se pueden ver así: usher contesta 403.
export const vodMasterUrl = async (id: string, red: Fetch = globalFetch): Promise<string> => {
  const token = await vodToken(id, deviceId(), red)
  if (token === null) throw new Error("sin token del vídeo")
  return vodMasterOf(id, token)
}

// Las miniaturas de la barra (Storyboard, en @goodttv/contratos): la de más calidad.
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
      const commentId = textOf(pick(node, "id"))
      const userId = textOf(pick(node, "commenter", "id"))
      const login = textOf(pick(node, "commenter", "login"))
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
        color: textOf(pick(node, "message", "userColor")),
        displayName: textOf(pick(node, "commenter", "displayName")) ?? login,
        fragments: (Array.isArray(fragments) ? fragments : []).map((fragment) => ({
          emoteId: textOf(pick(fragment, "emote", "emoteID")),
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

// Un VOD solo para suscriptores: su token de invitado restringe sus calidades (chansub.restricted_bitrates, vacío en uno
// público), y usher contesta 403. Comprobado el 29 de octubre con los de jaimemellado_. Si no se sabe (no hay token
// legible o la petición falla), se da por visible, como antes.
const guestCanWatch = async (id: string, red: Fetch): Promise<boolean> => {
  try {
    const token = await vodToken(id, deviceId(), red)
    if (token === null) return true
    const restricted = pick(JSON.parse(token.value), "chansub", "restricted_bitrates")
    return !Array.isArray(restricted) || restricted.length === 0
  } catch {
    return true
  }
}

// La emisión en curso de un canal y su VOD (DVR-1, retroceder el directo; LiveArchive, en @goodttv/contratos): cuándo
// empezó y el vídeo que la graba, si el canal guarda sus emisiones y se pueden ver sin suscripción (si no, retroceder
// abriría un VOD que no se puede ver). null si no emite.
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
  const startedAt = textOf(pick(stream, "createdAt"))
  if (startedAt === null) return null
  const id = textOf(pick(stream, "archiveVideo", "id"))
  const archiveId = id !== null && NUMERIC_ID.test(id) && (await guestCanWatch(id, red)) ? id : null
  return {
    archiveId,
    recordedAt: textOf(pick(stream, "archiveVideo", "recordedAt")),
    startedAt,
  }
}
