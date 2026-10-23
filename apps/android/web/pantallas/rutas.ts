import { useEffect, useRef, useSyncExternalStore } from "react"

// Dónde está la persona, en la dirección de la página: #/canal/<login>, #/vod/<id>, #/buscar, #/cuenta o Inicio. Cada
// cambio es una entrada del historial, así que Atrás vuelve a la pantalla de antes (atras()).
export type Route =
  | { readonly view: "home" }
  | { readonly view: "channel"; readonly login: string }
  // Un VOD (VOD-1): #/vod/<id>. Al retroceder un directo (DVR-1), en un segundo (?t=) y con el canal para volver al
  // directo (?directo=), como en la extensión.
  | { readonly view: "vod"; readonly id: string; readonly at?: number; readonly live?: string }
  | { readonly view: "search" }
  | { readonly view: "account" }

const LOGIN = /^[a-z0-9_]{1,25}$/

export const parseRoute = (hash: string): Route => {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?")
  const [, view = "", login = ""] = path.split("/")
  if (view === "canal" && LOGIN.test(login.toLowerCase())) {
    return { login: login.toLowerCase(), view: "channel" }
  }
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
  if (view === "buscar") return { view: "search" }
  if (view === "cuenta") return { view: "account" }
  return { view: "home" }
}

const vodQuery = (route: Extract<Route, { view: "vod" }>): string => {
  const params = new URLSearchParams()
  if (route.at !== undefined) params.set("t", String(Math.floor(route.at)))
  if (route.live !== undefined) params.set("directo", route.live)
  const query = params.toString()
  return query === "" ? "" : `?${query}`
}

export const routeHash = (route: Route): string => {
  switch (route.view) {
    case "channel":
      return `#/canal/${route.login}`
    case "vod":
      return `#/vod/${route.id}${vodQuery(route)}`
    case "search":
      return "#/buscar"
    case "account":
      return "#/cuenta"
    case "home":
      return "#/"
  }
}

// Con «sustituir», sin dejar la pantalla de ahora en el historial (cambiar de canal con las flechas, como en la tele:
// Atrás vuelve a Inicio, no recorre los canales vistos; o retroceder un directo y volver a él, que es seguir viendo lo
// mismo).
export const navigate = (route: Route, sustituir = false): void => {
  if (location.hash === routeHash(route)) return
  if (sustituir) location.replace(routeHash(route))
  else location.hash = routeHash(route)
}

const subscribe = (onChange: () => void): (() => void) => {
  addEventListener("hashchange", onChange)
  return () => removeEventListener("hashchange", onChange)
}

// Lo que Atrás cierra antes de dejar la pantalla (una hoja, la lista de emotes), del último que se abrió al primero.
const cerrables: (() => void)[] = []

// Mientras «abierto», Atrás (el de la app o la flecha) llama a «cerrar» en vez de dejar la pantalla.
export const useAtrasCierra = (abierto: boolean, cerrar: () => void): void => {
  const ultimo = useRef(cerrar)
  ultimo.current = cerrar
  useEffect(() => {
    if (!abierto) return undefined
    const cierra = (): void => ultimo.current()
    cerrables.push(cierra)
    return () => {
      const index = cerrables.lastIndexOf(cierra)
      if (index >= 0) cerrables.splice(index, 1)
    }
  }, [abierto])
}

// Cierra lo último que se abrió encima (una hoja, la lista de emotes); false si no había nada. MainActivity lo pide antes
// de volver a vertical (goodttvCerrar), para que Atrás cierre primero la hoja también en horizontal.
export const cerrarLoAbierto = (): boolean => {
  const cerrar = cerrables.pop()
  if (cerrar === undefined) return false
  cerrar()
  return true
}

// Atrás, el de la app (MainActivity lo pide a la página, goodttvAtras) y el de las flechas: true si queda pantalla a la
// que volver (o algo abierto que cerrar). No vale el historial de la WebView: Chromium se salta las entradas añadidas sin
// un toque en la página (volver al canal desde el minirreproductor se toca en la app), y Atrás cerraría la app en vez de
// volver a Inicio. Desde la página, history.back() no se las salta. Si no hay a dónde volver (se llegó por una «ruta» de
// adb), a Inicio. Si ha cambiado la ruta, history.back() ha funcionado; el plan B no se aplica aunque luego se vuelva a
// la misma.
export const atras = (): boolean => {
  if (cerrarLoAbierto()) return true
  if (parseRoute(location.hash).view === "home") return false
  let vuelto = false
  const alVolver = (): void => {
    vuelto = true
  }
  addEventListener("hashchange", alVolver, { once: true })
  history.back()
  setTimeout(() => {
    removeEventListener("hashchange", alVolver)
    if (!vuelto) navigate({ view: "home" })
  }, 300)
  return true
}

// A Inicio sin dejar atrás la pantalla de ahora (al cerrarse el PiP con el canal: volver atrás podría montar otro).
export const aInicio = (): void => location.replace("#/")

export const useRoute = (): Route =>
  parseRoute(useSyncExternalStore(subscribe, () => location.hash))
