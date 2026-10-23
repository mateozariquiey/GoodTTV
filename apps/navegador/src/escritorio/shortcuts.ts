// Atajos de teclado del escritorio (Ajustes los enumera). Con un campo de texto activo solo vale Esc, Espacio sobre un
// botón o un enlace es suyo (lo pulsa), y las flechas, de los controles que las usan (el volumen, un menú).
export type Shortcut =
  | "back"
  | "chat"
  | "forward"
  | "fullscreen"
  | "live"
  | "mute"
  | "next"
  | "play-pause"
  | "previous"
  | "rewind"
  | "search"
  | "theater"

export type ShortcutContext = {
  readonly onArrows: boolean // el foco está en un control que usa las flechas
  readonly onControl: boolean // el foco está en un botón, enlace o control
  readonly typing: boolean // el foco está en un campo de texto
}

const KEYS: Readonly<Record<string, Shortcut>> = {
  " ": "play-pause",
  "/": "search",
  ArrowDown: "next",
  ArrowLeft: "rewind",
  ArrowRight: "forward",
  ArrowUp: "previous",
  End: "live",
  c: "chat",
  f: "fullscreen",
  j: "rewind",
  k: "play-pause",
  l: "forward",
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
  if (context.onControl && event.key === " ") return undefined
  if (context.onArrows && event.key.startsWith("Arrow")) return undefined
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
  const onArrows =
    element !== null &&
    element.closest("input, select, [role='slider'], [role='menu'], [role='radiogroup']") !== null
  return { onArrows, onControl, typing }
}
