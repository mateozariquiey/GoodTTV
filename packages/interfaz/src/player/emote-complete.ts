import type { ChatEmote, ChatEmoteGroups } from "@goodttv/contratos"

// Completar emotes al escribir en el chat (CHAT-1), sin su aspecto: la palabra que acaba en el cursor, los emotes que
// empiezan por ella y cómo queda el texto al elegir uno. Como en Twitch, «:» delante de la palabra pide sugerencias.

export const SUGGESTIONS_MAX = 8
const MIN_PREFIX = 2

export type Word = { readonly end: number; readonly start: number; readonly text: string }

export const NO_EMOTES: ChatEmoteGroups = { channel: [], global: [], twitch: [] }

// La palabra que acaba en el cursor: desde el último espacio.
export const wordAt = (text: string, caret: number): Word => {
  let start = caret
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) start--
  return { end: caret, start, text: text.slice(start, caret) }
}

// Los que empiezan por lo escrito (sin «:» y sin distinguir mayúsculas): primero los del canal, luego los tuyos de
// Twitch y los globales, y en cada grupo los más cortos, que son los más parecidos a lo escrito.
export const suggestEmotes = (
  groups: ChatEmoteGroups,
  typed: string,
  max = SUGGESTIONS_MAX,
): ChatEmote[] => {
  const prefix = (typed.startsWith(":") ? typed.slice(1) : typed).toLowerCase()
  if (prefix.length < MIN_PREFIX) return []
  const seen = new Set<string>()
  const found: ChatEmote[] = []
  for (const group of [groups.channel, groups.twitch, groups.global]) {
    const matches = group
      .filter((emote) => !seen.has(emote.name) && emote.name.toLowerCase().startsWith(prefix))
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    for (const emote of matches) {
      seen.add(emote.name)
      found.push(emote)
    }
    if (found.length >= max) break
  }
  return found.slice(0, max)
}

// La palabra cambiada por el emote, con un espacio detrás; el cursor, tras el espacio.
export const replaceWord = (
  text: string,
  word: Word,
  name: string,
): { readonly caret: number; readonly text: string } => {
  const after = text.slice(word.end).replace(/^ /, "")
  return {
    caret: word.start + name.length + 1,
    text: `${text.slice(0, word.start)}${name} ${after}`,
  }
}

// La imagen pequeña (1x) de un emote, para la lista y las sugerencias: el chat usa la 2x, que en los animados de 7TV
// pesa 300-600 KB, y con decenas a la vez Firefox tardaba o dejaba huecos (22 oct, illojuan).
export const emoteThumb = (emote: ChatEmote): string => {
  switch (emote.provider) {
    case "7tv":
    case "bttv":
      return emote.url.replace(/\/2x\.webp$/, "/1x.webp")
    case "ffz":
      return emote.url.replace(/\/2$/, "/1")
    case "twitch":
      return emote.url.replace(/\/2\.0$/, "/1.0")
  }
}

// El emote en el cursor (desde la lista o el chat), separado de lo que haya antes con un espacio.
export const insertAt = (
  text: string,
  caret: number,
  name: string,
): { readonly caret: number; readonly text: string } => {
  const before = text.slice(0, caret)
  const gap = before === "" || /\s$/.test(before) ? "" : " "
  return replaceWord(text, { end: caret, start: caret, text: "" }, `${gap}${name}`)
}
