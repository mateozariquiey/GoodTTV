import { StoredTokenSchema, type TokenStore, TWITCH_CHAT_SCOPES } from "@goodttv/servicios"

// ?twitchfalso[=ms]: una cuenta y un Helix falsos, para medir el arranque de Inicio con cuenta sin la del usuario
// (herramientas/laboratorio/inicio.mjs). La página contesta ella misma lo que se pide a id.twitch.tv y api.twitch.tv,
// cada petición tras ms (170 por defecto: lo que tardaba cada una desde mini-agentes el 23 de octubre, aun reutilizando
// la conexión). El directo no cambia: va por el fetch original (installDirecto).
// - La sesión, Inicio guardado y lo demás que la página guarda en localStorage van a sessionStorage: así no pisa una
//   cuenta de verdad, y sigue al recargar la pestaña.
// - Los títulos y las categorías de los directos llevan el id de esta carga (window.twitchFalso.carga): lo que se vea
//   con otro es de una carga anterior. Cada petición queda en window.twitchFalso.peticiones, con su inicio y su fin en
//   ms desde que se abrió la página.
// - El token «falso-caducado» no vale: validar y Helix dan 401, y renovarlo da otro que sí.
// - Con datos en sessionStorage («twitch-falso-datos»: seguidos y populares como los da Helix, y las fotos por id), los
//   directos son esos en vez de los inventados: para hacer capturas con canales de verdad.

const TOKEN_KEY = "twitch-falso-token"
const ACCOUNT = { id: "9000", login: "prueba", name: "Prueba" }
const AVATAR =
  "https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-300x300.png"
const FOLLOWED = 12
const POPULAR = 24

type Peticion = { readonly ruta: string; readonly inicio: number; fin?: number; estado?: number }
type Datos = {
  readonly seguidos: readonly { readonly user_login: string }[]
  readonly populares: readonly { readonly user_login: string }[]
  readonly fotos: Readonly<Record<string, string>>
}

const readDatos = (): Datos | undefined => {
  try {
    return JSON.parse(sessionStorage.getItem("twitch-falso-datos") ?? "null") ?? undefined
  } catch {
    return undefined
  }
}

export const fakeTwitchDelay = (search: string): number | undefined => {
  const params = new URLSearchParams(search)
  if (!params.has("twitchfalso")) return undefined
  const ms = Number(params.get("twitchfalso") || 170)
  return Number.isFinite(ms) && ms >= 0 ? ms : 170
}

// La sesión falsa, en sessionStorage: la crea la primera vez (válida 4 h, como las de Twitch).
export const fakeTokens = (storage: Storage): TokenStore => ({
  clear: async () => storage.removeItem(TOKEN_KEY),
  isSecure: false,
  load: async () => {
    const text = storage.getItem(TOKEN_KEY)
    return text === null ? undefined : StoredTokenSchema.parse(JSON.parse(text))
  },
  save: async (token) => storage.setItem(TOKEN_KEY, JSON.stringify(StoredTokenSchema.parse(token))),
})

export const seedFakeToken = (storage: Storage): void => {
  if (storage.getItem(TOKEN_KEY) !== null) return
  storage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: "falso-1",
      expiresAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
      refreshToken: "falso-renovar-1",
    }),
  )
}

const stream = (id: number, login: string, carga: string, what: string) => ({
  game_name: `Juego ${carga}`,
  id: `s${id}`,
  started_at: new Date(Date.now() - 3_600_000).toISOString(),
  tags: [],
  thumbnail_url: "https://static-cdn.jtvnw.net/previews-ttv/live_user_x-{width}x{height}.jpg",
  title: `${what} de ahora ${carga}`,
  type: "live",
  user_id: String(id),
  user_login: login,
  user_name: login,
  viewer_count: 100_000 - id,
})

const answer = (
  url: URL,
  method: string,
  token: string,
  carga: string,
  issued: () => number,
  datos: Datos | undefined,
) => {
  const path = url.pathname
  if (url.hostname === "id.twitch.tv") {
    if (path === "/oauth2/validate") {
      return token === "falso-caducado"
        ? Response.json({ message: "invalid access token", status: 401 }, { status: 401 })
        : Response.json({
            client_id: "falso",
            expires_in: 14_000,
            login: ACCOUNT.login,
            scopes: TWITCH_CHAT_SCOPES.split(" "),
            user_id: ACCOUNT.id,
          })
    }
    if (path === "/oauth2/token" && method === "POST") {
      const n = issued()
      return Response.json({
        access_token: `falso-${n}`,
        expires_in: 14_000,
        refresh_token: `falso-renovar-${n}`,
        scope: TWITCH_CHAT_SCOPES.split(" "),
        token_type: "bearer",
      })
    }
    return new Response(null, { status: 200 })
  }
  if (token === "falso-caducado") return Response.json({ status: 401 }, { status: 401 })
  if (path === "/helix/users") {
    const ids = url.searchParams.getAll("id")
    return Response.json({
      data:
        ids.length === 0
          ? [
              {
                display_name: ACCOUNT.name,
                id: ACCOUNT.id,
                login: ACCOUNT.login,
                profile_image_url: AVATAR,
              },
            ]
          : ids.map((id) => ({
              display_name: `canal${id}`,
              id,
              login: `canal${id}`,
              profile_image_url: datos?.fotos[id] ?? AVATAR,
            })),
    })
  }
  if (path === "/helix/streams/followed") {
    return Response.json({
      data:
        datos?.seguidos ??
        Array.from({ length: FOLLOWED }, (_, i) =>
          stream(1001 + i, `seguido${i + 1}`, carga, "Seguido"),
        ),
      pagination: {},
    })
  }
  if (path === "/helix/streams") {
    // Los recientes (user_login): en directo si son de los seguidos; si no, la lista de populares.
    const logins = url.searchParams.getAll("user_login")
    if (datos !== undefined) {
      const todos = [...datos.seguidos, ...datos.populares]
      return Response.json({
        data:
          logins.length > 0
            ? todos.filter((each) => logins.includes(each.user_login))
            : datos.populares,
        pagination: {},
      })
    }
    const data =
      logins.length > 0
        ? logins.flatMap((login) => {
            const n = Number(/^seguido(\d+)$/.exec(login)?.[1] ?? 0)
            return n >= 1 && n <= FOLLOWED ? [stream(1000 + n, login, carga, "Seguido")] : []
          })
        : Array.from({ length: POPULAR }, (_, i) =>
            stream(2001 + i, `popular${i + 1}`, carga, "Popular"),
          )
    return Response.json({ data, pagination: {} })
  }
  return Response.json({ data: [], pagination: {} })
}

export const installFakeTwitch = (ms: number): void => {
  const original = globalThis.fetch
  const carga = crypto.randomUUID().slice(0, 8)
  const peticiones: Peticion[] = []
  let next = 1
  const datos = readDatos()
  Object.assign(globalThis, { twitchFalso: { carga, peticiones } })
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.hostname !== "id.twitch.tv" && url.hostname !== "api.twitch.tv") {
      return original(input, init)
    }
    const entry: Peticion = {
      inicio: Math.round(performance.now()),
      ruta: `${url.hostname === "id.twitch.tv" ? "id" : "helix"} ${url.pathname.replace(/^\/(helix|oauth2)\//, "")}${url.searchParams.has("id") ? "?id" : url.searchParams.has("user_login") ? "?user_login" : ""}`,
    }
    peticiones.push(entry)
    await new Promise((done) => setTimeout(done, ms))
    const token = (request.headers.get("Authorization") ?? "").replace(/^(OAuth|Bearer) /, "")
    const response = answer(url, request.method, token, carga, () => ++next + Date.now(), datos)
    entry.fin = Math.round(performance.now())
    entry.estado = response.status
    return response
  }
}
