// Atajos de teclado del escritorio (Ajustes los enumera). Con un campo de texto activo solo vale Esc, y Espacio sobre
// un botón o un enlace es suyo: lo pulsa.
export type Shortcut =
  | "back"
  | "chat"
  | "fullscreen"
  | "mute"
  | "next"
  | "play-pause"
  | "previous"
  | "search"
  | "theater"

export type ShortcutContext = {
  readonly onControl: boolean // el foco está en un botón, enlace o control
  readonly typing: boolean // el foco está en un campo de texto
}

const KEYS: Readonly<Record<string, Shortcut>> = {
  " ": "play-pause",
  "/": "search",
  ArrowDown: "next",
  ArrowUp: "previous",
  c: "chat",
  f: "fullscreen",
  k: "play-pause",
  m: "mute",
  t: "theater",
}

export const shortcutFor = (
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey">,
  context: ShortcutContext,
): Shortcut | undefined => {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined
  if (event.key === "Escape") return "back"
  if (context.typing) return undefined
  if (context.onControl && (event.key === " " || event.key.startsWith("Arrow"))) return undefined
  return KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key]
}

export const contextOf = (target: EventTarget | null): ShortcutContext => {
  const element = target instanceof HTMLElement ? target : null
  const typing =
    element !== null &&
    (element.isContentEditable ||
      element.tagName === "TEXTAREA" ||
      (element.tagName === "INPUT" && (element as HTMLInputElement).type !== "range"))
  const onControl =
    element !== null && element.closest("button, a, input, select, [role='slider']") !== null
  return { onControl, typing }
}
