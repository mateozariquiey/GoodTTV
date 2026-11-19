import { useEffect, useState } from "react"
import { type Channel, fromSearch } from "./channel"
import { searchChannels } from "./data"
import { idiomaActual, t } from "./idioma"

// Buscar canales al escribir, en las tres versiones: la extensión (Search.tsx), Android (pantallas/Busqueda.tsx) y la
// TV (screens/SearchScreen.tsx, en apps/tv). Cada una pinta la lista y decide qué hace Enter (o «Ir», o el mando).

export type ChannelSearch =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly text: string }
  | { readonly kind: "ready"; readonly text: string; readonly channels: readonly Channel[] }
  | { readonly kind: "error"; readonly text: string }

// Lo escrito (text, ya sin espacios a los lados) se busca tras un momento sin escribir (delayMs), para no pedir una
// búsqueda por letra; con menos de minLength letras, nada. Cada consulta empieza sin los resultados de la anterior, y
// una respuesta que llega tarde (bien o mal) se descarta. retry vuelve a pedir la misma.
export const useChannelSearch = (
  text: string,
  { delayMs, minLength = 1 }: { readonly delayMs: number; readonly minLength?: number },
): { readonly results: ChannelSearch; readonly retry: () => void } => {
  const [results, setResults] = useState<ChannelSearch>({ kind: "idle" })
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt vuelve a buscar al reintentar.
  useEffect(() => {
    if (text.length < minLength) {
      setResults({ kind: "idle" })
      return undefined
    }
    setResults({ kind: "loading", text })
    let current = true
    const timer = setTimeout(() => {
      searchChannels(text)
        .then((cards) => {
          if (current) setResults({ channels: cards.map(fromSearch), kind: "ready", text })
        })
        .catch(() => {
          if (current) setResults({ kind: "error", text })
        })
    }, delayMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [attempt, delayMs, minLength, text])
  return { results, retry: () => setAttempt((value) => value + 1) }
}

const LOGIN = /^[a-zA-Z0-9_]{1,25}$/

// El canal con ese nombre tal cual, si puede ser un nombre de usuario de Twitch: para abrirlo sin buscar.
export const typedChannel = (text: string): Channel | undefined =>
  LOGIN.test(text) ? { displayName: text, login: text.toLowerCase() } : undefined

// La línea bajo el nombre de un canal encontrado: sus seguidores, abreviados con un decimal («12,3 mil»), y su
// categoría. Lo que no se sabe no sale.
export const channelSearchDetail = (channel: Channel): string =>
  [
    channel.followers === undefined
      ? null
      : t("{n} seguidores", {
          n: new Intl.NumberFormat(idiomaActual(), {
            maximumFractionDigits: 1,
            notation: "compact",
          }).format(channel.followers),
        }),
    channel.category || null,
  ]
    .filter((each) => each !== null)
    .join(" · ")
