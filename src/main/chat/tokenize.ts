import type { ChatEmote, ChatToken } from "../../shared/chat"

// The subset of an EventSub chat fragment this client renders. Cheermotes render as text.
export type ChatFragment = {
  readonly emote?: { readonly id: string } | null | undefined
  readonly text: string
  readonly type: string
}

export type EmoteLookup = ReadonlyMap<string, ChatEmote>

const TWITCH_EMOTE_ID = /^[a-zA-Z0-9_]{1,80}$/

export const twitchEmote = (id: string, name: string): ChatEmote | undefined =>
  TWITCH_EMOTE_ID.test(id)
    ? {
        name,
        provider: "twitch",
        // Documented CDN template; "default" serves the animated variant when one exists.
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`,
        zeroWidth: false,
      }
    : undefined

const pushText = (tokens: ChatToken[], text: string): void => {
  if (text === "") return
  const last = tokens.at(-1)
  if (last?.kind === "text") {
    tokens[tokens.length - 1] = { kind: "text", text: last.text + text }
    return
  }
  tokens.push({ kind: "text", text })
}

// A zero-width emote stacks on the emote just before it, ignoring the separating space.
const lastEmoteIndex = (tokens: readonly ChatToken[]): number => {
  const last = tokens.length - 1
  const lastToken = tokens[last]
  if (lastToken?.kind === "emote") return last
  if (
    lastToken?.kind === "text" &&
    lastToken.text.trim() === "" &&
    tokens[last - 1]?.kind === "emote"
  )
    return last - 1
  return -1
}

const pushEmote = (tokens: ChatToken[], emote: ChatEmote): void => {
  const baseIndex = emote.zeroWidth ? lastEmoteIndex(tokens) : -1
  const base = tokens[baseIndex]
  if (base?.kind === "emote" && base.overlays.length < 8) {
    tokens.splice(baseIndex, tokens.length - baseIndex, {
      ...base,
      overlays: [...base.overlays, emote],
    })
    return
  }
  tokens.push({ emote, kind: "emote", overlays: [] })
}

export const tokenizeFragments = (
  fragments: readonly ChatFragment[],
  emotes: EmoteLookup,
): ChatToken[] => {
  const tokens: ChatToken[] = []
  for (const fragment of fragments) {
    if (fragment.type === "emote" && fragment.emote != null) {
      const emote = twitchEmote(fragment.emote.id, fragment.text)
      if (emote !== undefined) {
        pushEmote(tokens, emote)
        continue
      }
    }
    if (fragment.type === "mention") {
      tokens.push({ kind: "mention", text: fragment.text })
      continue
    }
    // Third-party emotes are whole words inside text; keep the original spacing intact.
    for (const part of fragment.text.split(/(\s+)/)) {
      const emote = part.trim() === "" ? undefined : emotes.get(part)
      if (emote === undefined) pushText(tokens, part)
      else pushEmote(tokens, emote)
    }
  }
  return tokens
}

// Twitch lets chatters pick colours that disappear on a dark background. Keep the hue,
// raise the lightness until it reads on the chat surface, and give colourless users one.
const FALLBACK_COLORS = ["#ff7f50", "#9acd32", "#1e90ff", "#ff69b4", "#daa520", "#5f9ea0"]

const hexToRgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]

const luminance = ([red, green, blue]: [number, number, number]): number => {
  const linear = (channel: number): number => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

const toHex = (channels: readonly number[]): string =>
  `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`

export const readableUserColor = (color: string, userId: string): string => {
  const normalized = color.toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    const seed = [...userId].reduce((sum, character) => sum + character.charCodeAt(0), 0)
    return FALLBACK_COLORS[seed % FALLBACK_COLORS.length] ?? "#bf94ff"
  }
  let rgb = hexToRgb(normalized)
  // 0.18 relative luminance gives at least ~7:1 against the near-black chat surface.
  for (let step = 0; step < 12 && luminance(rgb) < 0.18; step += 1) {
    rgb = rgb.map((channel) => channel + (255 - channel) * 0.18) as [number, number, number]
  }
  return toHex(rgb)
}
