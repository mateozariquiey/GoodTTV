import type { ReplayMessage } from "@goodttv/contratos"
import { useEffect, useMemo, useRef, useState } from "react"
import { CHAT_HISTORY, type ChatView } from "./useChat"

// El chat de un VOD a la par de la imagen (VOD-1). Twitch solo lo da como invitado por posición (unos 50 mensajes desde
// un segundo, vods.ts): se piden por delante de lo que se ve y, al saltar fuera de lo pedido, desde el sitio nuevo. Se
// enseñan los que ya han pasado, como en el directo.

const AHEAD_S = 60 // pedir más cuando quede menos que esto por delante
const BEFORE_S = 20 // al saltar, también un poco de antes: el contexto
const EMPTY_STEP_S = 30 // sin mensajes en un tramo, se sigue desde más adelante
// Más allá de lo pedido, hasta esto se sigue pidiendo desde donde se quedó (un chat muy activo da 50 mensajes en unos
// segundos); más lejos, o antes de lo pedido, es un salto: se empieza desde el sitio nuevo.
const JUMP_S = 120
const RETRY_MS = 5000

type Loaded = {
  readonly messages: readonly ReplayMessage[] // por orden de posición, sin repetir
  readonly from: number
  readonly to: number // hasta dónde se ha pedido, s
}

const EMPTY: Loaded = { from: Number.POSITIVE_INFINITY, messages: [], to: Number.NEGATIVE_INFINITY }

const merge = (loaded: Loaded, from: number, list: readonly ReplayMessage[]): Loaded => {
  const known = new Set(loaded.messages.map((message) => message.id))
  const messages = [...loaded.messages, ...list.filter((message) => !known.has(message.id))].sort(
    (a, b) => a.offset - b.offset,
  )
  const last = list.reduce((max, message) => Math.max(max, message.offset), from)
  // Cada respuesta avanza al menos un segundo: la siguiente nunca repite la misma petición.
  return {
    from: Math.min(loaded.from, from),
    messages,
    to: Math.max(loaded.to, list.length === 0 ? from + EMPTY_STEP_S : last, from + 1),
  }
}

export const useReplayChat = (
  videoId: string | undefined,
  channelId: string | undefined,
  time: number,
  enabled: boolean,
): ChatView => {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY)
  const [status, setStatus] = useState<ChatView["status"]>("connecting")
  // Una petición a la vez; la de otro vídeo ya no cuenta (generation). No van atadas al efecto, que se repite cada
  // segundo con la imagen.
  const busy = useRef(false)
  const failedAt = useRef(0)
  const generation = useRef(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: otro vídeo, desde cero.
  useEffect(() => {
    generation.current++
    busy.current = false
    setLoaded(EMPTY)
    setStatus("connecting")
  }, [videoId])

  const second = Math.floor(time)
  useEffect(() => {
    const vods = window.api.vods
    if (!enabled || videoId === undefined || channelId === undefined || vods === undefined) return
    if (busy.current || Date.now() - failedAt.current < RETRY_MS) return
    const jumped = second < loaded.from - 1 || second > loaded.to + JUMP_S
    if (!jumped && loaded.to - second > AHEAD_S) return
    // Sin saltos, se sigue desde lo último pedido; tras un salto, desde el sitio nuevo.
    const from = jumped ? Math.max(0, second - BEFORE_S) : Math.floor(loaded.to) + 1
    const asked = generation.current
    busy.current = true
    vods
      .comments({ channelId, offset: from, videoId })
      .then((list) => {
        if (asked !== generation.current) return
        setLoaded((previous) => merge(jumped ? EMPTY : previous, from, list))
        setStatus("connected")
      })
      .catch(() => {
        if (asked !== generation.current) return
        failedAt.current = Date.now()
        setStatus("error")
      })
      .finally(() => {
        if (asked === generation.current) busy.current = false
      })
  }, [channelId, enabled, loaded, second, videoId])

  // Los que ya han pasado, los últimos CHAT_HISTORY.
  const messages = useMemo(() => {
    let end = 0
    while (end < loaded.messages.length && (loaded.messages[end]?.offset ?? 0) <= time) end++
    return loaded.messages.slice(Math.max(0, end - CHAT_HISTORY), end)
  }, [loaded, time])

  return { delay: null, messages, status: enabled ? status : "off" }
}
