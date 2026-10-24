import type { LatencyMode } from "@goodttv/contratos"
import { useEffect, useRef } from "react"
import type { Channel } from "../channel"
import { prewarmStream } from "./useHlsPlayer"

export const OPENING_PREWARM_MS = 10_000 // al abrir, plazo para saber si el último canal visto emite

// Al abrir GoodTTV en Inicio, el último canal que viste, que suele ser el primero que se abre (REN-1). Una sola vez y
// con el modo guardado (ready). Se precalienta en cuanto se sabe que emite, por lo guardado de la última vez o por lo
// de ahora, durante los primeros segundos; no si se abrió en otra vista o se sale de Inicio antes. prewarm: cómo se
// precalienta (en Android, el motor de la app; si no, el directo de la página).
export const useOpeningPrewarm = (
  atHome: boolean,
  lastSeen: Channel | undefined,
  mode: LatencyMode,
  ready: boolean,
  prewarm: (login: string, mode: LatencyMode) => void = prewarmStream,
): void => {
  const done = useRef(false)
  const openedAt = useRef(Date.now())
  const prewarmRef = useRef(prewarm)
  prewarmRef.current = prewarm
  useEffect(() => {
    if (done.current || !ready) return
    if (!atHome || Date.now() - openedAt.current > OPENING_PREWARM_MS) {
      done.current = true
      return
    }
    if (lastSeen?.live !== true) return
    done.current = true
    prewarmRef.current(lastSeen.login, mode)
  }, [atHome, lastSeen, mode, ready])
}
