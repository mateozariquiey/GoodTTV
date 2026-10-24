// Atajos de teclado del escritorio (Ajustes los enumera). Con un campo de texto activo solo vale Esc, Espacio sobre un
// botón o un enlace al que se ha llegado con el teclado es suyo (lo pulsa), y las flechas, de los controles que las usan
// (el volumen, un menú).
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
  readonly onControl: boolean // el foco está en un botón, enlace o control, y se llegó a él con el teclado
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
  // Solo si se llegó con el teclado. Lo que se toca con el ratón se queda con el foco, y Espacio, en un vídeo, es pausar:
  // tras abrir un canal en la columna o tocar el volumen no hacía nada, y tras el botón del modo teatro, lo quitaba.
  const onControl =
    element !== null &&
    element !== pointerFocused &&
    element.closest("button, a, input, select, [role='slider']") !== null
  const onArrows =
    element !== null &&
    element.closest("input, select, [role='slider'], [role='menu'], [role='radiogroup']") !== null
  return { onArrows, onControl, typing }
}

// El elemento que recibió el foco al tocarlo con el puntero (null si llegó con el teclado o de otra forma). No sirve
// :focus-visible: Chrome lo da en cuanto se pulsa una tecla, antes de que la vea el atajo.
let pointerFocused: Element | null = null

// Apunta cómo llega el foco: tras un pointerdown, del puntero (el foco llega antes del pointerup). Si se toca lo que ya
// tenía el foco (se llegó con Tab y luego se pulsa con el ratón), no llega otro focusin: también cuenta. Una vez, en
// Desktop.
export const watchPointerFocus = (target: Document = document): (() => void) => {
  let pressing = false
  const onDown = (event: PointerEvent): void => {
    pressing = true
    const active = target.activeElement
    if (active !== null && event.target instanceof Node && active.contains(event.target))
      pointerFocused = active
  }
  const onUp = (): void => {
    pressing = false
  }
  const onFocus = (event: FocusEvent): void => {
    pointerFocused = pressing && event.target instanceof Element ? event.target : null
  }
  target.addEventListener("pointerdown", onDown, true)
  target.addEventListener("pointerup", onUp, true)
  target.addEventListener("pointercancel", onUp, true)
  target.addEventListener("keydown", onUp, true) // por si el pointerup se perdió (soltado fuera de la ventana)
  target.addEventListener("focusin", onFocus, true)
  return () => {
    target.removeEventListener("pointerdown", onDown, true)
    target.removeEventListener("pointerup", onUp, true)
    target.removeEventListener("pointercancel", onUp, true)
    target.removeEventListener("keydown", onUp, true)
    target.removeEventListener("focusin", onFocus, true)
    pointerFocused = null
  }
}
