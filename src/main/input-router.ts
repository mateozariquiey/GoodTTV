import type { Event, Input, WebContents } from "electron"
import { CHANNELS } from "../shared/channels"
import type { InputAction, KeyProbe } from "../shared/contracts"

// Every key from the remote passes through here before Chromium dispatches it, whichever frame
// holds DOM focus. Mapped keys never reach the page or Twitch's frames; the renderer receives a
// semantic action instead. Text entry and the player interaction mode are the two exceptions.

type KeyInput = Pick<Input, "alt" | "code" | "control" | "isAutoRepeat" | "key" | "meta" | "type">

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

export type InteractionHandler = {
  // Returns true when the key was consumed by the interaction mode.
  readonly handle: (action: InputAction | undefined, input: KeyInput) => boolean
}

export const createInputRouter = (contents: WebContents) => {
  let textEntry = false
  let probing = false
  let interaction: InteractionHandler | undefined
  // A key that changed mode keeps being swallowed until it is released.
  const swallowed = new Set<string>()

  const send = (action: InputAction): void => {
    if (!contents.isDestroyed()) contents.send(CHANNELS.inputAction, action)
  }

  const onInput = (event: Event, input: Input): void => {
    if (input.type !== "keyDown" && input.type !== "keyUp") return
    if (probing && input.type === "keyDown" && !contents.isDestroyed()) {
      const probe: KeyProbe = {
        action: actionForKey(input, false) ?? null,
        code: input.code.slice(0, 40),
        key: input.key.slice(0, 40),
      }
      contents.send(CHANNELS.inputProbe, probe)
    }
    if (swallowed.has(input.code)) {
      event.preventDefault()
      if (input.type === "keyUp") swallowed.delete(input.code)
      return
    }
    const action = actionForKey(input, textEntry && interaction === undefined)
    if (interaction !== undefined) {
      if (interaction.handle(action, input)) {
        event.preventDefault()
        return
      }
    }
    if (action === undefined) return
    event.preventDefault()
    if (input.type !== "keyDown") return
    if (input.isAutoRepeat && !repeats(action)) return
    send(action)
  }

  contents.on("before-input-event", onInput)

  return {
    dispose: () => contents.removeListener("before-input-event", onInput),
    setInteraction: (handler: InteractionHandler | undefined) => {
      interaction = handler
    },
    setProbing: (active: boolean) => {
      probing = active
    },
    setTextEntry: (active: boolean) => {
      textEntry = active
    },
    swallowUntilRelease: (code: string) => {
      swallowed.add(code)
    },
  }
}

export type InputRouter = ReturnType<typeof createInputRouter>
