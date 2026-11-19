import { actionForKey, type InputAction, type KeyProbe, repeats } from "@goodttv/contratos"
import type { Event, Input, WebContents } from "electron"
import { CHANNELS } from "../shared/channels"

// Every key from the remote passes through here before Chromium dispatches it. Mapped keys never reach the page; the
// renderer receives a semantic action instead. Text entry is the exception.

export const createInputRouter = (contents: WebContents) => {
  let textEntry = false
  let probing = false

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
    const action = actionForKey(input, textEntry)
    if (action === undefined) return
    event.preventDefault()
    if (input.type !== "keyDown") return
    if (input.isAutoRepeat && !repeats(action)) return
    send(action)
  }

  contents.on("before-input-event", onInput)

  return {
    dispose: () => contents.removeListener("before-input-event", onInput),
    setProbing: (active: boolean) => {
      probing = active
    },
    setTextEntry: (active: boolean) => {
      textEntry = active
    },
  }
}

export type InputRouter = ReturnType<typeof createInputRouter>
