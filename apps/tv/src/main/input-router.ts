import { actionForKey, type InputAction, type KeyProbe, repeats } from "@goodttv/contratos"
import type { Event, Input, WebContents } from "electron"
import { CHANNELS } from "../shared/channels"

// Every key from the remote passes through here before Chromium dispatches it, whichever frame
// holds DOM focus. Mapped keys never reach the page or Twitch's frames; the renderer receives a
// semantic action instead. Text entry and the player interaction mode are the two exceptions.

type KeyInput = Pick<Input, "alt" | "code" | "control" | "isAutoRepeat" | "key" | "meta" | "type">

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
