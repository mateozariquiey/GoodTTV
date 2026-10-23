import { useSyncExternalStore } from "react"

// Dónde está la persona, en la dirección de la página: #/canal/<login>, #/ajustes o Inicio. Así funcionan el botón
// atrás del navegador y los enlaces directos a un canal (el menú «Abrir en GoodTTV» de twitch.tv).
export type Route =
  | { readonly view: "home" }
  | { readonly view: "channel"; readonly login: string }
  | { readonly view: "settings" }
  // Un VOD (VOD-1): #/vod/<id>. Al retroceder un directo (DVR-1), en un segundo (?t=) y con el canal para volver al
  // directo (?directo=).
  | { readonly view: "vod"; readonly id: string; readonly at?: number; readonly live?: string }

const LOGIN = /^[a-z0-9_]{1,25}$/

export const parseRoute = (hash: string): Route => {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?")
  const [, view = "", login = ""] = path.split("/")
  if (view === "canal" && LOGIN.test(login.toLowerCase())) {
    return { login: login.toLowerCase(), view: "channel" }
  }
  if (view === "ajustes") return { view: "settings" }
  if (view === "vod" && /^\d{1,20}$/.test(login)) {
    const params = new URLSearchParams(query)
    const at = Number(params.get("t") ?? "")
    const live = (params.get("directo") ?? "").toLowerCase()
    return {
      id: login,
      view: "vod",
      ...(params.has("t") && Number.isFinite(at) && at >= 0 ? { at } : {}),
      ...(LOGIN.test(live) ? { live } : {}),
    }
  }
  return { view: "home" }
}

export const routeHash = (route: Route): string =>
  route.view === "channel"
    ? `#/canal/${route.login}`
    : route.view === "settings"
      ? "#/ajustes"
      : route.view === "vod"
        ? `#/vod/${route.id}${vodQuery(route)}`
        : "#/"

const vodQuery = (route: Extract<Route, { view: "vod" }>): string => {
  const params = new URLSearchParams()
  if (route.at !== undefined) params.set("t", String(Math.floor(route.at)))
  if (route.live !== undefined) params.set("directo", route.live)
  const query = params.toString()
  return query === "" ? "" : `?${query}`
}

export const navigate = (route: Route): void => {
  if (location.hash !== routeHash(route)) location.hash = routeHash(route)
}

const subscribe = (onChange: () => void): (() => void) => {
  addEventListener("hashchange", onChange)
  return () => removeEventListener("hashchange", onChange)
}

export const useRoute = (): Route =>
  parseRoute(useSyncExternalStore(subscribe, () => location.hash))
