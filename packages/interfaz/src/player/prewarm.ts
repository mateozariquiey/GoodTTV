import type { LatencyMode } from "@goodttv/contratos"
import { useEffect } from "react"
import { chosenLiveQuality } from "./live-quality"

// Precalentar: pide al directo que abra ya el empalme de un canal que probablemente se va a abrir, sin parar el que
// suena. Al abrirlo, el arranque lleva ya ese adelanto (abrir las sesiones de Twitch, a veces el directo publicado).
// Con la calidad que se va a pedir: con otra, el directo abriría el canal otra vez.
export const prewarmStream = (login: string, mode: LatencyMode): void => {
  const query = new URLSearchParams({ modo: mode })
  const quality = chosenLiveQuality()
  if (quality !== null) query.set("q", quality)
  void fetch(`/stream/${login}/precalentar?${query}`).catch(() => undefined)
}

// Precalienta un canal cuando lleva «dwellMs» señalado (el ratón encima, el foco en él); null: ninguno.
export const usePrewarm = (login: string | null, mode: LatencyMode, dwellMs: number): void => {
  useEffect(() => {
    if (login === null) return undefined
    const timer = setTimeout(() => prewarmStream(login, mode), dwellMs)
    return () => clearTimeout(timer)
  }, [dwellMs, login, mode])
}
