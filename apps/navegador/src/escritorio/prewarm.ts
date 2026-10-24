import type { LatencyMode } from "@goodttv/contratos"
import { prewarmStream } from "@goodttv/interfaz"
import { useEffect } from "react"
import { parseRoute } from "./routes"

export const PREWARM_MS = 150 // con el ratón parado este tiempo sobre un canal, se precalienta

// El canal de un enlace (#/canal/<login>) bajo el puntero, o null.
const channelUnder = (target: EventTarget | null): string | null => {
  const link = target instanceof Element ? target.closest('a[href^="#/canal/"]') : null
  const route = parseRoute(link?.getAttribute("href") ?? "")
  return route.view === "channel" ? route.login : null
}

// Precalentar el canal sobre el que se para el ratón, o en cuanto se empieza a pulsar, salvo el que ya se ve: al
// abrirlo, el directo suele estar ya listo. Cada movimiento vuelve a empezar la espera, para no abrir un canal por
// cada fila que se cruza. Con el ratón encima tampoco se precalientan los que se sabe que no emiten, como en la tele.
export const usePointerPrewarm = (
  watching: string | undefined,
  offline: ReadonlySet<string>,
  mode: LatencyMode,
): void => {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onMove = (event: PointerEvent): void => {
      clearTimeout(timer)
      const login = channelUnder(event.target)
      if (login === null || login === watching || offline.has(login)) return
      timer = setTimeout(() => prewarmStream(login, mode), PREWARM_MS)
    }
    const onDown = (event: PointerEvent): void => {
      clearTimeout(timer)
      const login = channelUnder(event.target)
      if (login !== null && login !== watching) prewarmStream(login, mode)
    }
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerdown", onDown)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerdown", onDown)
    }
  }, [mode, offline, watching])
}
