import {
  type CommonRoute,
  commonRouteHash,
  parseCommonRoute,
  routeParts,
  useHash,
} from "@goodttv/interfaz"
import { useEffect, useRef } from "react"

// Dónde está la persona, en la dirección de la página: #/canal/<login>, #/vod/<id>, #/buscar, #/categorias, #/cuenta o Inicio. Cada
// cambio es una entrada del historial, así que Atrás vuelve a la pantalla de antes (atras()). Inicio, el canal, el VOD
// y las categorías son comunes con la extensión (routes.ts, en @goodttv/interfaz); aquí, lo propio de Android.
export type Route = CommonRoute | { readonly view: "search" } | { readonly view: "account" }

export const parseRoute = (hash: string): Route => {
  const { view } = routeParts(hash)
  if (view === "buscar") return { view: "search" }
  if (view === "cuenta") return { view: "account" }
  return parseCommonRoute(hash)
}

export const routeHash = (route: Route): string => {
  switch (route.view) {
    case "search":
      return "#/buscar"
    case "account":
      return "#/cuenta"
    default:
      return commonRouteHash(route)
  }
}

// Con «sustituir», sin dejar la pantalla de ahora en el historial (cambiar de canal con las flechas, como en la TV:
// Atrás vuelve a Inicio, no recorre los canales vistos; o retroceder un directo y volver a él, que es seguir viendo lo
// mismo).
export const navigate = (route: Route, sustituir = false): void => {
  if (location.hash === routeHash(route)) return
  if (sustituir) location.replace(routeHash(route))
  else location.hash = routeHash(route)
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

export const useRoute = (): Route => parseRoute(useHash())
