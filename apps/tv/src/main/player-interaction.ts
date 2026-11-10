import type { InputAction, PlayerInteractionEnd } from "@goodttv/contratos"
import type {
  BrowserWindow,
  Event,
  WebContentsDidStartNavigationEventParams,
  WebFrameMain,
} from "electron"
import { CHANNELS } from "../shared/channels"
import type { InputRouter } from "./input-router"

// "Controles de Twitch": lets the viewer operate Twitch's own player UI (for example the
// content-classification gate) with a remote that has no Tab key. Adapted from VacuumStream's
// chat-input.ts. Only fixed Tab, Shift+Tab and Enter pairs are ever dispatched, only through an
// app-owned debugger attachment, and only while the captured player frame still has focus.

export const isPlayerFrameUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (
    url.origin === "https://player.twitch.tv" &&
    url.pathname === "/" &&
    url.searchParams.getAll("parent").includes("localhost")
  )
}

type Session = {
  readonly frame: WebFrameMain
  readonly id: number
  readonly url: string
}

type Key = "Enter" | "Tab" | "ShiftTab"

const KEY_FOR_ACTION: Partial<Record<InputAction, Key>> = {
  down: "Tab",
  left: "ShiftTab",
  ok: "Enter",
  right: "Tab",
  up: "ShiftTab",
}

export const createPlayerInteraction = (window: BrowserWindow, router: InputRouter) => {
  const contents = window.webContents
  let session: Session | undefined
  let sessions = 0
  let ownsDebugger = false
  let queue = Promise.resolve()

  const notify = (id: number, reason: PlayerInteractionEnd): void => {
    if (!contents.isDestroyed()) contents.send(CHANNELS.playerInteractionEnded, id, reason)
  }

  const end = (reason: PlayerInteractionEnd | undefined): void => {
    const current = session
    if (current === undefined) return
    session = undefined
    router.setInteraction(undefined)
    contents.removeListener("did-start-navigation", navigating)
    contents.removeListener("render-process-gone", cancel)
    if (ownsDebugger) {
      ownsDebugger = false
      contents.debugger.removeListener("detach", debuggerLost)
      if (contents.debugger.isAttached()) contents.debugger.detach()
    }
    if (reason !== undefined) notify(current.id, reason)
  }

  const cancel = (): void => end("cancelled")

  const debuggerLost = (): void => {
    ownsDebugger = false
    contents.debugger.removeListener("detach", debuggerLost)
    end("failed")
  }

  const navigating = (details: Event<WebContentsDidStartNavigationEventParams>): void => {
    if (details.isMainFrame || details.frame === session?.frame) cancel()
  }

  const stillFocused = (current: Session): boolean => {
    const { frame } = current
    return (
      session === current &&
      window.isFocused() &&
      !frame.isDestroyed() &&
      !frame.detached &&
      contents.focusedFrame === frame &&
      frame.parent === contents.mainFrame &&
      contents.mainFrame.frames.includes(frame) &&
      frame.url === current.url &&
      isPlayerFrameUrl(frame.url)
    )
  }

  const dispatch = (current: Session, key: Key): void => {
    const work = queue.then(async () => {
      // Revalidate right before sending; queued work never outlives its session.
      if (!stillFocused(current)) {
        if (session === current) end("failed")
        return
      }
      if (!ownsDebugger) {
        if (contents.debugger.isAttached()) throw new Error("The debugger is busy")
        contents.debugger.attach("1.3")
        ownsDebugger = true
        contents.debugger.on("detach", debuggerLost)
      }
      const enter = key === "Enter"
      const base = {
        code: enter ? "Enter" : "Tab",
        key: enter ? "Enter" : "Tab",
        modifiers: key === "ShiftTab" ? 8 : 0,
        windowsVirtualKeyCode: enter ? 13 : 9,
      }
      // Submit the balanced pair together so a later exit cannot strand a keyDown.
      await Promise.all([
        contents.debugger.sendCommand("Input.dispatchKeyEvent", {
          ...base,
          ...(enter ? { text: "\r" } : {}),
          type: "keyDown",
        }),
        contents.debugger.sendCommand("Input.dispatchKeyEvent", { ...base, type: "keyUp" }),
      ])
    })
    queue = work.catch(() => {
      if (session === current) end("failed")
    })
  }

  const begin = (): number => {
    end("cancelled")
    if (!window.isFocused()) throw new Error("The window is not focused")
    // Capture the app's current direct player child, never a renderer-supplied target.
    const frame = contents.mainFrame.frames.find((candidate) => isPlayerFrameUrl(candidate.url))
    if (frame === undefined) throw new Error("No Twitch player is mounted")
    sessions += 1
    const current: Session = { frame, id: sessions, url: frame.url }
    session = current
    contents.on("did-start-navigation", navigating)
    contents.on("render-process-gone", cancel)
    router.setInteraction({
      handle: (action, input) => {
        if (session !== current || action === undefined) return false
        if (action === "back") {
          if (input.type === "keyDown") {
            router.swallowUntilRelease(input.code)
            end("back")
          }
          return true
        }
        // Playback keys keep working through the official API in the renderer.
        if (action === "play-pause" || action === "play" || action === "pause") return false
        const key = KEY_FOR_ACTION[action]
        if (key === undefined || input.type !== "keyDown") return true
        if (key === "Enter" && input.isAutoRepeat) return true
        dispatch(current, key)
        return true
      },
    })
    return current.id
  }

  return {
    begin,
    // The renderer ends the mode itself before switching channel or leaving playback.
    end: (id: number) => {
      if (session?.id === id) end(undefined)
    },
    // BrowserWindow blur is authoritative; DOM blur also fires when the iframe takes focus.
    windowBlurred: cancel,
  }
}

export type PlayerInteraction = ReturnType<typeof createPlayerInteraction>
