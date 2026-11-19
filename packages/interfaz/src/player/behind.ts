import { useEffect, useState } from "react"

// Retraso típico de un espectador de Twitch respecto al emisor (embed oficial, medido: ~2,7 s). Quien escribe en el
// chat lo hace viendo el directo con ese retraso.
export const TWITCH_VIEWER_LATENCY = 3

// Cuánto va la imagen por detrás de lo que ve un espectador normal de Twitch, en segundos enteros: el precio de no ver
// anuncios. null mientras no se sabe. Se mira cada segundo; el chat se retrasa lo mismo.
export const useBehind = (latency: { readonly current: number | null }): number | null => {
  const [behind, setBehind] = useState<number | null>(null)
  useEffect(() => {
    const timer = setInterval(() => {
      const seconds = latency.current
      setBehind(seconds === null ? null : Math.max(0, Math.round(seconds - TWITCH_VIEWER_LATENCY)))
    }, 1000)
    return () => clearInterval(timer)
  }, [latency])
  return behind
}

// El retraso del chat (s): lo que la imagen va por detrás de un espectador normal de Twitch, para que el chat vaya a la
// par de ella. latency: la del reproductor (s), null mientras no se sabe. Sin ella, null (el chat espera) si la imagen
// está por llegar (latencyComing), y 0 si no va a llegar (sin directo, un fallo): el chat no se queda esperando.
export const chatDelayOf = (latency: number | null, latencyComing: boolean): number | null => {
  if (latency !== null) return Math.max(0, latency - TWITCH_VIEWER_LATENCY)
  return latencyComing ? null : 0
}
