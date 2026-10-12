import { type RefObject, useEffect, useLayoutEffect } from "react"

const ALWAYS: RefObject<boolean> = { current: true }

// El chat baja al final con cada mensaje nuevo y también si cambia la altura sin mensajes nuevos: la de la lista (otro
// tamaño de letra, modo teatro, pantalla completa) o la de un mensaje (un emote sin tamaño conocido crece al cargar).
// Con «stick», solo si se estaba abajo: en el escritorio, quien sube a leer se queda donde está. En la tele no se puede
// subir, así que siempre baja.
export const useChatAtBottom = (
  list: RefObject<HTMLElement | null>,
  messages: unknown,
  stick: RefObject<boolean> = ALWAYS,
): void => {
  // Solo con mensajes nuevos: leer scrollHeight obliga a recalcular la disposición.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se baja al final cuando cambian los mensajes.
  useLayoutEffect(() => {
    const element = list.current
    if (element !== null && stick.current) element.scrollTop = element.scrollHeight
  }, [messages])
  // Los cambios de altura, una vez por fotograma como mucho, aunque carguen varios emotes a la vez.
  useEffect(() => {
    const element = list.current
    if (element === null || typeof ResizeObserver === "undefined") return undefined
    let frame = 0
    const toEnd = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (stick.current) element.scrollTop = element.scrollHeight
      })
    }
    const observer = new ResizeObserver(toEnd)
    observer.observe(element)
    element.addEventListener("load", toEnd, true) // «load» no sube: se escucha en la captura
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      element.removeEventListener("load", toEnd, true)
    }
  }, [list, stick])
}
