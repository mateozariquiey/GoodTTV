import type { Route } from "./escritorio/routes"

// Varias pestañas de GoodTTV (EXT-5): el botón y «Abrir en GoodTTV» llevan a la que ya muestra esa vista, si la hay; si
// no, abren otra. Sin el permiso «tabs», el fondo no ve las direcciones de las pestañas: pregunta a las páginas
// (runtime.sendMessage), y contesta la que la muestra, con su pestaña.

// fondo.ts solo importa los tipos: el fondo debe quedar en un solo archivo (vite.config.ts), sin trozos compartidos.

// login: el canal; null, Inicio.
export type TabQuery = { readonly goodttv: "busca"; readonly login: string | null }
export type TabFound = { readonly tabId: number; readonly windowId: number }

export const isTabQuery = (message: unknown): message is TabQuery =>
  typeof message === "object" &&
  message !== null &&
  (message as TabQuery).goodttv === "busca" &&
  ((message as TabQuery).login === null || typeof (message as TabQuery).login === "string")

export const showsQuery = (query: TabQuery, route: Route): boolean =>
  query.login === null
    ? route.view === "home"
    : route.view === "channel" && route.login === query.login
