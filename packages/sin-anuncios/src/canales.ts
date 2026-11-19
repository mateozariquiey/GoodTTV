// Buscar canales y ver uno por su nombre, como el buscador de twitch.tv (la extensión y Android, D24): como invitado y
// sin cuenta, con la relevancia de Twitch (corrige erratas: «ilojuan» da illojuan el primero), su foto, sus
// seguidores y si está en directo. API privada del reproductor web, como los VOD (vods.ts).
// También las categorías más vistas y los directos de una (D49), que Helix no da con sus espectadores.
import { globalFetch, LOGIN, NUMERIC_ID, textOf } from "./comun"
import { deviceId, type Fetch, gqlRequest, pick } from "./twitch-source"

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

const SEARCH_MAX = 20

const CHANNEL_FIELDS = `id login displayName profileImageURL(width: 150) followers { totalCount }
  broadcastSettings { title game { displayName } } stream { viewersCount game { displayName } }`

const toResult = (node: unknown): ChannelResult | null => {
  const id = textOf(pick(node, "id"))
  const login = textOf(pick(node, "login"))
  if (id === null || !NUMERIC_ID.test(id) || login === null || !LOGIN.test(login)) return null
  const viewers = pick(node, "stream", "viewersCount")
  const live = pick(node, "stream") !== null && pick(node, "stream") !== undefined
  const followers = pick(node, "followers", "totalCount")
  return {
    avatar: textOf(pick(node, "profileImageURL")),
    category:
      textOf(pick(node, "stream", "game", "displayName")) ??
      textOf(pick(node, "broadcastSettings", "game", "displayName")),
    displayName: (textOf(pick(node, "displayName")) ?? login).slice(0, 60),
    followers: typeof followers === "number" && Number.isFinite(followers) ? followers : 0,
    id,
    login,
    title: textOf(pick(node, "broadcastSettings", "title")) ?? "",
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
  const id = textOf(pick(node, "broadcaster", "id"))
  const login = textOf(pick(node, "broadcaster", "login"))
  const viewers = pick(node, "viewersCount")
  const startedAt = textOf(pick(node, "createdAt"))
  if (id === null || !NUMERIC_ID.test(id) || login === null || !LOGIN.test(login)) return null
  if (typeof viewers !== "number" || !Number.isFinite(viewers) || startedAt === null) return null
  return {
    avatar: textOf(pick(node, "broadcaster", "profileImageURL")),
    // name y no displayName, que Twitch traduce, como en las categorías (CATEGORY_FIELDS).
    category: textOf(pick(node, "game", "name")) ?? "",
    displayName: (textOf(pick(node, "broadcaster", "displayName")) ?? login).slice(0, 60),
    id,
    login,
    startedAt,
    title: textOf(pick(node, "title")) ?? "",
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
          edges { node { title viewersCount createdAt game { name }
            broadcaster { id login displayName profileImageURL(width: 300) } } } } }`,
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

export type CategoryResult = {
  readonly id: string
  readonly slug: string // su nombre en las direcciones de twitch.tv: «just-chatting»
  readonly name: string
  readonly boxArt: string | null
  readonly viewers: number
  readonly channels: number // cuántos canales la emiten ahora
}

const SLUG = /^[a-z0-9-]{1,120}$/
// name y no displayName, que Twitch traduce («Charlando»): el resto de GoodTTV enseña el nombre de Helix, sin traducir.
const CATEGORY_FIELDS =
  "id slug name viewersCount broadcastersCount boxArtURL(width: 144, height: 192)"

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0

const toCategory = (node: unknown): CategoryResult | null => {
  const id = textOf(pick(node, "id"))
  const slug = textOf(pick(node, "slug"))
  const name = textOf(pick(node, "name"))
  if (id === null || !NUMERIC_ID.test(id) || slug === null || !SLUG.test(slug)) return null
  if (name === null) return null
  return {
    boxArt: textOf(pick(node, "boxArtURL")),
    channels: count(pick(node, "broadcastersCount")),
    id,
    name: name.slice(0, 120),
    slug,
    viewers: count(pick(node, "viewersCount")),
  }
}

// Las categorías con más espectadores ahora, como invitado: el directorio de twitch.tv. Twitch las da casi en orden;
// aquí se ordenan del todo.
export const topCategories = async (
  { first = 60 }: { first?: number } = {},
  red: Fetch = globalFetch,
): Promise<readonly CategoryResult[]> => {
  const data = await gqlRequest(
    {
      query: `query($first: Int!) { games(first: $first) { edges { node { ${CATEGORY_FIELDS} } } } }`,
      variables: { first: Math.min(100, Math.max(1, first)) },
    },
    deviceId(),
    red,
  )
  const edges = pick(data, "data", "games", "edges")
  return (Array.isArray(edges) ? edges : [])
    .map((edge) => toCategory(pick(edge, "node")))
    .filter((category): category is CategoryResult => category !== null)
    .sort((a, b) => b.viewers - a.viewers)
}

// Una categoría por su nombre de dirección, con sus directos más vistos; null si no existe.
export const categoryStreams = async (
  slug: string,
  { first = 60 }: { first?: number } = {},
  red: Fetch = globalFetch,
): Promise<{
  readonly category: CategoryResult
  readonly streams: readonly PopularStream[]
} | null> => {
  const name = slug.toLowerCase()
  if (!SLUG.test(name)) return null
  const data = await gqlRequest(
    {
      query: `query($slug: String!, $first: Int!) { game(slug: $slug) { ${CATEGORY_FIELDS}
        streams(first: $first) { edges { node { title viewersCount createdAt game { name }
          broadcaster { id login displayName profileImageURL(width: 300) } } } } } }`,
      variables: { first: Math.min(100, Math.max(1, first)), slug: name },
    },
    deviceId(),
    red,
  )
  const game = pick(data, "data", "game")
  const category = toCategory(game)
  if (category === null) return null
  const edges = pick(game, "streams", "edges")
  const streams = (Array.isArray(edges) ? edges : [])
    .map((edge) => toPopular(pick(edge, "node")))
    .filter((stream): stream is PopularStream => stream !== null)
    .sort((a, b) => b.viewers - a.viewers)
  return { category, streams }
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
