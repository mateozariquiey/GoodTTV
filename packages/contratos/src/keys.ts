import type { InputAction } from "./contracts"

// Teclas → acciones de la interfaz (arriba, OK, atrás, play/pausa…). La tele las traduce antes de que lleguen a
// Chromium (apps/tele/src/main/input-router.ts); la versión de navegador, en la propia página.

// Lo que hace falta saber de una pulsación: la tele lo saca de las Input de Electron; la página, de un KeyboardEvent.
export type KeyInput = {
  readonly alt: boolean
  readonly control: boolean
  readonly key: string
  readonly meta: boolean
}

const DIRECTIONS: Readonly<Record<string, InputAction>> = {
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
}

export const actionForKey = (input: KeyInput, textEntry: boolean): InputAction | undefined => {
  // Leave shortcuts with modifiers (for example DevTools in development) to Chromium.
  if (input.control || input.alt || input.meta) return undefined
  const direction = DIRECTIONS[input.key]
  if (direction !== undefined) return direction
  switch (input.key) {
    case "Enter":
    case "Select":
      return "ok"
    case "Escape":
    case "BrowserBack":
    case "GoBack":
      return "back"
    case "Backspace":
      return textEntry ? undefined : "back"
    case " ":
      return textEntry ? undefined : "play-pause"
    case "MediaPlayPause":
      return "play-pause"
    case "MediaPlay":
      return "play"
    case "MediaPause":
    case "MediaStop":
      return "pause"
    default:
      return undefined
  }
}

// Only directions repeat while held; OK, Back and playback act once per physical press.
export const repeats = (action: InputAction): boolean =>
  action === "up" || action === "down" || action === "left" || action === "right"
