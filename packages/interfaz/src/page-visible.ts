import { useSyncExternalStore } from "react"

// Si la página está a la vista: la pestaña de la extensión, o la app de Android con la pantalla encendida. Oculta, lo
// que nadie mira (el chat) no hace falta que siga.

const isVisible = (): boolean => document.visibilityState === "visible"

const subscribe = (onChange: () => void): (() => void) => {
  document.addEventListener("visibilitychange", onChange)
  return () => document.removeEventListener("visibilitychange", onChange)
}

export const usePageVisible = (): boolean => useSyncExternalStore(subscribe, isVisible)
