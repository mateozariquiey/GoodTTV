import { useSyncExternalStore } from "react"

// Las direcciones que comparten la extensión (escritorio/routes.ts) y Android (pantallas/rutas.ts), en el hash de la
// página: Inicio, un canal, un VOD y el directorio de categorías. Cada una añade las suyas (la extensión, los ajustes y
// la cuadrícula; Android, la búsqueda y la cuenta), y cómo se navega es de cada una.
export type CommonRoute =
  | { readonly view: "home" }
  | { readonly view: "channel"; readonly login: string }
  // Un VOD (VOD-1): #/vod/<id>. Al retroceder un directo (DVR-1), en un segundo (?t=) y con el canal para volver al
  // directo (?directo=).
  | { readonly view: "vod"; readonly id: string; readonly at?: number; readonly live?: string }
  // El directorio (D49): #/categorias, y una por su nombre en las direcciones de twitch.tv, #/categoria/just-chatting.
  | { readonly view: "categories" }
  | { readonly view: "category"; readonly slug: string }

// Un nombre de usuario de Twitch, ya en minúsculas.
export const LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/
const SLUG = /^[a-z0-9-]{1,120}$/

// Las partes de una dirección: #/<view>/<segment>?<query>.
export const routeParts = (
  hash: string,
): { readonly query: string; readonly segment: string; readonly view: string } => {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?")
  const [, view = "", segment = ""] = path.split("/")
  return { query, segment, view }
}

// Una dirección común; si no es ninguna (o no puede existir, como un canal con espacios), Inicio.
export const parseCommonRoute = (hash: string): CommonRoute => {
  const { query, segment, view } = routeParts(hash)
  if (view === "canal" && LOGIN_PATTERN.test(segment.toLowerCase())) {
    return { login: segment.toLowerCase(), view: "channel" }
  }
  if (view === "vod" && /^\d{1,20}$/.test(segment)) {
    const params = new URLSearchParams(query)
    const at = Number(params.get("t") ?? "")
    const live = (params.get("directo") ?? "").toLowerCase()
    return {
      id: segment,
      view: "vod",
      ...(params.has("t") && Number.isFinite(at) && at >= 0 ? { at } : {}),
      ...(LOGIN_PATTERN.test(live) ? { live } : {}),
    }
  }
  if (view === "categorias") return { view: "categories" }
  if (view === "categoria" && SLUG.test(segment.toLowerCase())) {
    return { slug: segment.toLowerCase(), view: "category" }
  }
  return { view: "home" }
}

const vodQuery = (route: Extract<CommonRoute, { view: "vod" }>): string => {
  const params = new URLSearchParams()
  if (route.at !== undefined) params.set("t", String(Math.floor(route.at)))
  if (route.live !== undefined) params.set("directo", route.live)
  const query = params.toString()
  return query === "" ? "" : `?${query}`
}

// La dirección de una ruta común: la inversa de parseCommonRoute. Para un enlace, mejor esto que escribirla a mano.
export const commonRouteHash = (route: CommonRoute): string => {
  switch (route.view) {
    case "channel":
      return `#/canal/${route.login}`
    case "vod":
      return `#/vod/${route.id}${vodQuery(route)}`
    case "categories":
      return "#/categorias"
    case "category":
      return `#/categoria/${route.slug}`
    case "home":
      return "#/"
  }
}

const subscribe = (onChange: () => void): (() => void) => {
  addEventListener("hashchange", onChange)
  return () => removeEventListener("hashchange", onChange)
}

// La dirección de la página, al día: cada app la convierte en su ruta (useRoute).
export const useHash = (): string => useSyncExternalStore(subscribe, () => location.hash)
