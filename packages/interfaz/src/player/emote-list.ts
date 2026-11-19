import type { ChatEmote, ChatEmoteGroups } from "@goodttv/contratos"
import { type RefObject, useEffect } from "react"
import { t } from "../idioma"

// La lista de emotes para escribir (CHAT-1) y la ficha de un emote del chat, sin su aspecto: lo que comparten la
// extensión (ChatCompose.tsx y ChatPanel.tsx, con el ratón) y Android (pantallas/Emotes.tsx, con el dedo). Cómo se
// abren, dónde salen y qué hace un clic o una pulsación larga es de cada una.

// De dónde es cada emote, como lo escriben 7TV, BTTV, FFZ y Twitch.
export const EMOTE_PROVIDER: Readonly<Record<ChatEmote["provider"], string>> = {
  "7tv": "7TV",
  bttv: "BTTV",
  ffz: "FFZ",
  twitch: "Twitch",
}

const SECTIONS = [
  ["channel", "Del canal"],
  ["twitch", "Tuyos de Twitch"],
  ["global", "Globales"],
] as const

export type EmoteSection = {
  readonly emotes: readonly ChatEmote[]
  readonly key: keyof ChatEmoteGroups
  readonly title: string
}

// La lista entera, por grupos: los del canal, los tuyos de Twitch y los globales, con los que contienen lo buscado
// (sin distinguir mayúsculas). Los grupos sin ninguno no salen.
export const emoteSections = (groups: ChatEmoteGroups, search: string): EmoteSection[] => {
  const query = search.trim().toLowerCase()
  return SECTIONS.map(([key, title]) => ({
    emotes: groups[key].filter((emote) => emote.name.toLowerCase().includes(query)),
    key,
    title: t(title),
  })).filter((section) => section.emotes.length > 0)
}

// Lo que se sabe de un emote del chat, sacado de sus imágenes: Message (ChatPanel.tsx) deja en data-* el nombre y de
// dónde es, y pone las capas de anchura cero detrás de la imagen base.
export type ChatEmoteInfo = {
  readonly name: string
  readonly overlays: readonly string[]
  readonly provider: ChatEmote["provider"] | undefined
  readonly url: string
}

export const chatEmoteOf = (element: Element): ChatEmoteInfo | null => {
  const [base, ...overlays] = [...element.querySelectorAll<HTMLImageElement>("img")]
  if (base === undefined) return null
  const provider = base.dataset["provider"]
  return {
    name: base.dataset["name"] ?? base.alt,
    overlays: overlays.map((image) => image.dataset["name"] ?? "").filter((name) => name !== ""),
    provider:
      provider !== undefined && provider in EMOTE_PROVIDER
        ? (provider as ChatEmote["provider"])
        : undefined,
    url: base.src,
  }
}

// La línea de la ficha bajo el nombre: de dónde es y con qué capas, «7TV · con RainTime». Vacía si no se sabe nada.
export const chatEmoteDetails = (emote: ChatEmoteInfo): string =>
  [
    emote.provider === undefined ? null : EMOTE_PROVIDER[emote.provider],
    emote.overlays.length > 0 ? t("con {overlays}", { overlays: emote.overlays.join(", ") }) : null,
  ]
    .filter((each) => each !== null)
    .join(" · ")

// Cada emote de la lista se pide tras estar un momento a la vista (o a punto): bajar deprisa, con la rueda o con el
// dedo, no deja pedidas las imágenes de las filas que pasan de largo, que en Zen retrasaban las de abajo (22 oct,
// knekro: 215 pedidas en una bajada), y lo que sale de la vista sin haber cargado se cancela.
export const EMOTE_LOAD_DELAY_MS = 150
const LOAD_MARGIN = "120px 0px"

// Las imágenes de la lista, a mano: cada celda (cells, un selector dentro de root) lleva su <img data-src>, sin src,
// y aquí se le pone al estar a la vista. React no toca ese src, porque no lo lleva. Con otra búsqueda (search), las
// celdas son otras y se vuelven a observar; mientras cargan los emotes (ready falso), no hay celdas.
export const useLazyEmoteImages = (
  root: RefObject<HTMLElement | null>,
  cells: string,
  ready: boolean,
  search: string,
): void => {
  const query = search.trim().toLowerCase()
  // biome-ignore lint/correctness/useExhaustiveDependencies: con otra búsqueda, las celdas son otras.
  useEffect(() => {
    const element = root.current
    if (element === null || !ready) return undefined
    const timers = new Map<Element, ReturnType<typeof setTimeout>>()
    const imageOf = (cell: Element): HTMLImageElement | null => cell.querySelector("img[data-src]")
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { isIntersecting, target } of entries) {
          const image = imageOf(target)
          if (image === null) continue
          if (isIntersecting) {
            if (image.hasAttribute("src") || timers.has(target)) continue
            timers.set(
              target,
              setTimeout(() => {
                timers.delete(target)
                image.src = image.dataset["src"] ?? ""
              }, EMOTE_LOAD_DELAY_MS),
            )
          } else {
            clearTimeout(timers.get(target))
            timers.delete(target)
            if (!image.complete) image.removeAttribute("src")
          }
        }
      },
      { root: element, rootMargin: LOAD_MARGIN },
    )
    for (const cell of element.querySelectorAll(cells)) observer.observe(cell)
    return () => {
      observer.disconnect()
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [ready, query])
}
