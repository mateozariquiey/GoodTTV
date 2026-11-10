import { EventEmitter } from "node:events"
import type { BrowserWindow, Input, WebContents } from "electron"
import { describe, expect, it, vi } from "vitest"
import { CHANNELS } from "../shared/channels"
import { createInputRouter } from "./input-router"
import { createPlayerInteraction, isPlayerFrameUrl } from "./player-interaction"

const PLAYER_URL = "https://player.twitch.tv/?channel=ibai&parent=localhost&autoplay=true"

const key = (name: string, overrides: Partial<Input> = {}): Input =>
  ({
    alt: false,
    code: name,
    control: false,
    isAutoRepeat: false,
    key: name,
    meta: false,
    type: "keyDown",
    ...overrides,
  }) as Input

const setup = () => {
  const mainFrame: Record<string, unknown> = { url: "https://localhost:1234/" }
  const frame = {
    detached: false,
    isDestroyed: () => false,
    parent: mainFrame,
    top: mainFrame,
    url: PLAYER_URL,
  }
  mainFrame["frames"] = [frame]
  let attached = false
  const debuggerApi = Object.assign(new EventEmitter(), {
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
    }),
    isAttached: vi.fn(() => attached),
    sendCommand: vi.fn(async (_method: string, _params?: unknown) => ({})),
  })
  const contents = Object.assign(new EventEmitter(), {
    debugger: debuggerApi,
    focusedFrame: frame as unknown,
    isDestroyed: () => false,
    mainFrame,
    send: vi.fn(),
  })
  let focused = true
  const window = { isFocused: () => focused, webContents: contents } as unknown as BrowserWindow
  const router = createInputRouter(contents as unknown as WebContents)
  const interaction = createPlayerInteraction(window, router)
  const press = async (input: Input) => {
    const event = { defaultPrevented: false, preventDefault: vi.fn() }
    contents.emit("before-input-event", event, input)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return event.preventDefault.mock.calls.length > 0
  }
  const dispatched = () =>
    debuggerApi.sendCommand.mock.calls
      .filter(([, params]) => (params as { type: string }).type === "keyDown")
      .map(([, params]) => {
        const { key: name, modifiers } = params as { key: string; modifiers: number }
        return modifiers === 8 ? `Shift+${name}` : name
      })
  const ended = () =>
    contents.send.mock.calls.filter(([channel]) => channel === CHANNELS.playerInteractionEnded)
  return {
    blur: () => {
      focused = false
    },
    contents,
    debuggerApi,
    dispatched,
    ended,
    frame,
    interaction,
    press,
  }
}

describe("isPlayerFrameUrl", () => {
  it("accepts only Twitch's player for this parent", () => {
    expect(isPlayerFrameUrl(PLAYER_URL)).toBe(true)
    expect(isPlayerFrameUrl("https://player.twitch.tv/?channel=x")).toBe(false)
    expect(isPlayerFrameUrl("https://www.twitch.tv/embed/x/chat?parent=localhost")).toBe(false)
    expect(isPlayerFrameUrl("https://player.twitch.tv.evil/?parent=localhost")).toBe(false)
  })
})

describe("createPlayerInteraction", () => {
  it("translates the remote into Tab, Shift+Tab and Enter for the focused player", async () => {
    const { dispatched, interaction, press } = setup()
    interaction.begin()
    expect(await press(key("ArrowDown"))).toBe(true)
    await press(key("ArrowRight"))
    await press(key("ArrowUp"))
    await press(key("Enter"))
    expect(dispatched()).toEqual(["Tab", "Tab", "Shift+Tab", "Enter"])
  })

  it("does not repeat Enter while held", async () => {
    const { dispatched, interaction, press } = setup()
    interaction.begin()
    await press(key("Enter"))
    await press(key("Enter", { isAutoRepeat: true }))
    expect(dispatched()).toEqual(["Enter"])
  })

  it("leaves on Back, swallows the rest of that press and returns control to the shell", async () => {
    const { contents, debuggerApi, ended, interaction, press } = setup()
    const id = interaction.begin()
    await press(key("ArrowDown"))
    await press(key("Escape"))
    expect(ended()).toEqual([[CHANNELS.playerInteractionEnded, id, "back"]])
    expect(debuggerApi.detach).toHaveBeenCalled()
    await press(key("Escape", { isAutoRepeat: true }))
    await press(key("Escape", { type: "keyUp" }))
    const shellActions = contents.send.mock.calls.filter(
      ([channel]) => channel === CHANNELS.inputAction,
    )
    expect(shellActions).toEqual([])
    await press(key("ArrowDown"))
    expect(contents.send).toHaveBeenLastCalledWith(CHANNELS.inputAction, "down")
  })

  it("keeps playback keys for the shell", async () => {
    const { contents, dispatched, interaction, press } = setup()
    interaction.begin()
    await press(key("MediaPlayPause"))
    expect(dispatched()).toEqual([])
    expect(contents.send).toHaveBeenLastCalledWith(CHANNELS.inputAction, "play-pause")
  })

  it("lets a physical Tab key go straight to the focused frame", async () => {
    const { interaction, press } = setup()
    interaction.begin()
    expect(await press(key("Tab"))).toBe(false)
  })

  it("sends nothing and ends when focus left the player frame", async () => {
    const { contents, dispatched, ended, interaction, press } = setup()
    const id = interaction.begin()
    contents.focusedFrame = contents.mainFrame
    await press(key("Enter"))
    expect(dispatched()).toEqual([])
    expect(ended()).toEqual([[CHANNELS.playerInteractionEnded, id, "failed"]])
  })

  it("sends nothing to a frame that navigated to another URL", async () => {
    const { dispatched, frame, interaction, press } = setup()
    interaction.begin()
    frame.url = "https://player.twitch.tv/?channel=other&parent=localhost"
    await press(key("Enter"))
    expect(dispatched()).toEqual([])
  })

  it("refuses to share a debugger someone else attached", async () => {
    const { debuggerApi, dispatched, ended, interaction, press } = setup()
    debuggerApi.isAttached.mockReturnValue(true)
    const id = interaction.begin()
    await press(key("ArrowDown"))
    expect(debuggerApi.attach).not.toHaveBeenCalled()
    expect(dispatched()).toEqual([])
    expect(ended()).toEqual([[CHANNELS.playerInteractionEnded, id, "failed"]])
  })

  it("ends silently when the renderer ends it before switching channel", async () => {
    const { dispatched, ended, interaction, press } = setup()
    const id = interaction.begin()
    interaction.end(id)
    await press(key("Enter"))
    expect(dispatched()).toEqual([])
    expect(ended()).toEqual([])
  })

  it("ends when the window loses system focus", () => {
    const { blur, ended, interaction } = setup()
    const id = interaction.begin()
    blur()
    interaction.windowBlurred()
    expect(ended()).toEqual([[CHANNELS.playerInteractionEnded, id, "cancelled"]])
  })

  it("requires a focused window and a mounted player", () => {
    const { blur, contents, interaction } = setup()
    contents.mainFrame["frames"] = []
    expect(() => interaction.begin()).toThrow("No Twitch player")
    blur()
    expect(() => interaction.begin()).toThrow("not focused")
  })
})
