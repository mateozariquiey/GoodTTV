import {
  type CommonRoute,
  commonRouteHash,
  LOGIN_PATTERN,
  parseCommonRoute,
  routeParts,
  useHash,
} from "@goodttv/interfaz"

// Dónde está la persona, en la dirección de la página: #/canal/<login>, #/ajustes, #/categorias o Inicio. Así funcionan el botón
// atrás del navegador y los enlaces directos a un canal (el menú «Abrir en GoodTTV» de twitch.tv). Inicio, el canal, el
// VOD y las categorías son comunes con Android (routes.ts, en @goodttv/interfaz); aquí, lo propio de la extensión.
export type Route =
  | CommonRoute
  | { readonly view: "settings" }
  // Varios canales en una pestaña (EXT-6): #/cuadricula/<login>,<login>…
  | { readonly view: "grid"; readonly logins: readonly string[] }

export const parseRoute = (hash: string): Route => {
  const { segment, view } = routeParts(hash)
  if (view === "ajustes") return { view: "settings" }
  if (view === "cuadricula") {
    const logins = segment.toLowerCase().split(",")
    return {
      logins: [...new Set(logins.filter((each) => LOGIN_PATTERN.test(each)))].slice(0, 4),
      view: "grid",
    }
  }
  return parseCommonRoute(hash)
}

export const routeHash = (route: Route): string =>
  route.view === "settings"
    ? "#/ajustes"
    : route.view === "grid"
      ? `#/cuadricula/${route.logins.join(",")}`
      : commonRouteHash(route)

export const navigate = (route: Route): void => {
  if (location.hash !== routeHash(route)) location.hash = routeHash(route)
}

export const useRoute = (): Route => parseRoute(useHash())
