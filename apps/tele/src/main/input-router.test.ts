import { EventEmitter } from "node:events"
import type { Input, WebContents } from "electron"
import { describe, expect, it, vi } from "vitest"
import { CHANNELS } from "../shared/channels"
import { createInputRouter } from "./input-router"

const key = (keyName: string, overrides: Partial<Input> = {}): Input =>
  ({
    alt: false,
    code: keyName,
    control: false,
    isAutoRepeat: false,
    key: keyName,
    meta: false,
    shift: false,
    type: "keyDown",
    ...overrides,
  }) as Input

const setup = () => {
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: vi.fn(),
  })
  const router = createInputRouter(contents as unknown as WebContents)
  const press = (input: Input) => {
    const event = { defaultPrevented: false, preventDefault: vi.fn() }
    contents.emit("before-input-event", event, input)
    return event.preventDefault.mock.calls.length > 0
  }
  const sent = () =>
    contents.send.mock.calls
      .filter(([channel]) => channel === CHANNELS.inputAction)
      .map(([, action]) => action)
  return { contents, press, router, sent }
}

describe("createInputRouter", () => {
  it("prevents mapped keys from reaching the page and sends one action per press", () => {
    const { press, sent } = setup()
    expect(press(key("ArrowDown"))).toBe(true)
    expect(press(key("ArrowDown", { type: "keyUp" }))).toBe(true)
    expect(press(key("a"))).toBe(false)
    expect(sent()).toEqual(["down"])
  })

  it("repeats directions but not OK, Back or playback", () => {
    const { press, sent } = setup()
    press(key("ArrowRight"))
    press(key("ArrowRight", { isAutoRepeat: true }))
    press(key("Enter"))
    press(key("Enter", { isAutoRepeat: true }))
    press(key("Escape", { isAutoRepeat: true }))
    press(key("MediaPlayPause", { isAutoRepeat: true }))
    expect(sent()).toEqual(["right", "right", "ok"])
  })

  it("passes Backspace and Space to a focused text field", () => {
    const { press, router, sent } = setup()
    router.setTextEntry(true)
    expect(press(key("Backspace"))).toBe(false)
    expect(press(key(" "))).toBe(false)
    expect(press(key("Enter"))).toBe(true)
    expect(sent()).toEqual(["ok"])
  })

  it("swallows the rest of a press that changed mode", () => {
    const { press, router, sent } = setup()
    router.swallowUntilRelease("Escape")
    expect(press(key("Escape", { isAutoRepeat: true }))).toBe(true)
    expect(press(key("Escape", { type: "keyUp" }))).toBe(true)
    expect(sent()).toEqual([])
    press(key("Escape"))
    expect(sent()).toEqual(["back"])
  })

  it("gives an interaction mode the first chance to consume a key", () => {
    const { press, router, sent } = setup()
    const handle = vi.fn((action: string | undefined) => action === "down")
    router.setInteraction({ handle })
    expect(press(key("ArrowDown"))).toBe(true)
    expect(press(key("ArrowUp"))).toBe(true)
    expect(sent()).toEqual(["up"])
    router.setInteraction(undefined)
    press(key("ArrowDown"))
    expect(sent()).toEqual(["up", "down"])
  })

  it("reports raw keys only while the remote test is open", () => {
    const { contents, press, router } = setup()
    press(key("BrowserBack"))
    router.setProbing(true)
    press(key("BrowserBack", { code: "BrowserBack" }))
    const probes = contents.send.mock.calls.filter(([channel]) => channel === CHANNELS.inputProbe)
    expect(probes).toEqual([
      [CHANNELS.inputProbe, { action: "back", code: "BrowserBack", key: "BrowserBack" }],
    ])
  })

  it("stops listening when disposed", () => {
    const { press, router, sent } = setup()
    router.dispose()
    expect(press(key("ArrowDown"))).toBe(false)
    expect(sent()).toEqual([])
  })
})
