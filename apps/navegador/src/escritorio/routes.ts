import { useSyncExternalStore } from "react"

// Dónde está la persona, en la dirección de la página: #/canal/<login>, #/ajustes o Inicio. Así funcionan el botón
// atrás del navegador y los enlaces directos a un canal (el menú «Abrir en GoodTTV» de twitch.tv).
export type Route =
  | { readonly view: "home" }
  | { readonly view: "channel"; readonly login: string }
  | { readonly view: "settings" }

const LOGIN = /^[a-z0-9_]{1,25}$/

export const parseRoute = (hash: string): Route => {
  const [, view = "", login = ""] = hash.replace(/^#/, "").split("/")
  if (view === "canal" && LOGIN.test(login.toLowerCase())) {
    return { login: login.toLowerCase(), view: "channel" }
  }
  if (view === "ajustes") return { view: "settings" }
  return { view: "home" }
}

export const routeHash = (route: Route): string =>
  route.view === "channel"
    ? `#/canal/${route.login}`
    : route.view === "settings"
      ? "#/ajustes"
      : "#/"

export const navigate = (route: Route): void => {
  if (location.hash !== routeHash(route)) location.hash = routeHash(route)
}

const subscribe = (onChange: () => void): (() => void) => {
  addEventListener("hashchange", onChange)
  return () => removeEventListener("hashchange", onChange)
}

export const useRoute = (): Route =>
  parseRoute(useSyncExternalStore(subscribe, () => location.hash))
