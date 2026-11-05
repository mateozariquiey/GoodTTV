// Buscar canales y ver uno por su nombre, como el buscador de twitch.tv (la extensión y Android, D24): como invitado y
// sin cuenta, con la relevancia de Twitch (corrige erratas: «ilojuan» da illojuan el primero), su foto, sus
// seguidores y si está en directo. API privada del reproductor web, como los VOD (vods.ts).
import { deviceId, type Fetch, gqlRequest, pick } from "./twitch-source"

const globalFetch: Fetch = (input, init) => fetch(input, init)

export type ChannelResult = {
  readonly id: string
  readonly login: string
  readonly displayName: string
  readonly avatar: string | null
  readonly followers: number
  readonly title: string // el de la emisión en curso o, sin directo, el de la última
  readonly category: string | null
  readonly viewers: number | null // en directo; null sin directo
}

const LOGIN = /^[a-z0-9_]{1,25}$/
const SEARCH_MAX = 20

const CHANNEL_FIELDS = `id login displayName profileImageURL(width: 150) followers { totalCount }
  broadcastSettings { title game { displayName } } stream { viewersCount game { displayName } }`

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null

const toResult = (node: unknown): ChannelResult | null => {
  const id = text(pick(node, "id"))
  const login = text(pick(node, "login"))
  if (id === null || !/^\d{1,20}$/.test(id) || login === null || !LOGIN.test(login)) return null
  const viewers = pick(node, "stream", "viewersCount")
  const live = pick(node, "stream") !== null && pick(node, "stream") !== undefined
  const followers = pick(node, "followers", "totalCount")
  return {
    avatar: text(pick(node, "profileImageURL")),
    category:
      text(pick(node, "stream", "game", "displayName")) ??
      text(pick(node, "broadcastSettings", "game", "displayName")),
    displayName: (text(pick(node, "displayName")) ?? login).slice(0, 60),
    followers: typeof followers === "number" && Number.isFinite(followers) ? followers : 0,
    id,
    login,
    title: text(pick(node, "broadcastSettings", "title")) ?? "",
    viewers: live ? (typeof viewers === "number" && Number.isFinite(viewers) ? viewers : 0) : null,
  }
}

// Los canales que encuentra Twitch para lo escrito, en su orden de relevancia.
export const searchChannels = async (
  query: string,
  { first = SEARCH_MAX, red = globalFetch }: { first?: number; red?: Fetch } = {},
): Promise<readonly ChannelResult[]> => {
  const userQuery = query.trim().slice(0, 100)
  if (userQuery === "") return []
  const data = await gqlRequest(
    {
      query: `query($query: String!) { searchFor(userQuery: $query, platform: "web",
        options: { targets: [{ index: CHANNEL }] }) { channels { edges { item { ... on User { ${CHANNEL_FIELDS} } } } } } }`,
      variables: { query: userQuery },
    },
    deviceId(),
    red,
  )
  const edges = pick(data, "data", "searchFor", "channels", "edges")
  return (Array.isArray(edges) ? edges : [])
    .map((edge) => toResult(pick(edge, "item")))
    .filter((result): result is ChannelResult => result !== null)
    .slice(0, Math.max(1, first))
}

export type PopularStream = {
  readonly id: string
  readonly login: string
  readonly displayName: string
  readonly avatar: string | null
  readonly title: string
  readonly category: string
  readonly viewers: number
  readonly startedAt: string
}

const toPopular = (node: unknown): PopularStream | null => {
  const id = text(pick(node, "broadcaster", "id"))
  const login = text(pick(node, "broadcaster", "login"))
  const viewers = pick(node, "viewersCount")
  const startedAt = text(pick(node, "createdAt"))
  if (id === null || !/^\d{1,20}$/.test(id) || login === null || !LOGIN.test(login)) return null
  if (typeof viewers !== "number" || !Number.isFinite(viewers) || startedAt === null) return null
  return {
    avatar: text(pick(node, "broadcaster", "profileImageURL")),
    category: text(pick(node, "game", "displayName")) ?? "",
    displayName: (text(pick(node, "broadcaster", "displayName")) ?? login).slice(0, 60),
    id,
    login,
    startedAt,
    title: text(pick(node, "title")) ?? "",
    viewers,
  }
}

// Los directos más vistos, como invitado, para la primera pantalla sin cuenta. language: el código de dos letras del
// catálogo; si con ese idioma no sale ninguno, los de todos.
export const popularStreams = async (
  { first = 24, language }: { first?: number; language?: string } = {},
  red: Fetch = globalFetch,
): Promise<readonly PopularStream[]> => {
  const ask = async (languages: readonly string[] | undefined) => {
    const data = await gqlRequest(
      {
        query: `query($first: Int!, $languages: [Language!]) { streams(first: $first, options: { languages: $languages }) {
          edges { node { title viewersCount createdAt game { displayName }
            broadcaster { id login displayName profileImageURL(width: 70) } } } } }`,
        variables: { first, ...(languages === undefined ? {} : { languages }) },
      },
      deviceId(),
      red,
    )
    const edges = pick(data, "data", "streams", "edges")
    return (Array.isArray(edges) ? edges : [])
      .map((edge) => toPopular(pick(edge, "node")))
      .filter((stream): stream is PopularStream => stream !== null)
  }
  const code = language?.toUpperCase()
  const local = code !== undefined && /^[A-Z]{2}$/.test(code) ? await ask([code]) : []
  return local.length > 0 ? local : ask(undefined)
}

// Un canal por su nombre (abierto desde la dirección, o el nombre exacto); null si no existe.
export const channelByLogin = async (
  login: string,
  red: Fetch = globalFetch,
): Promise<ChannelResult | null> => {
  const name = login.toLowerCase()
  if (!LOGIN.test(name)) return null
  const data = await gqlRequest(
    {
      query: `query($login: String!) { user(login: $login) { ${CHANNEL_FIELDS} } }`,
      variables: { login: name },
    },
    deviceId(),
    red,
  )
  return toResult(pick(data, "data", "user"))
}
