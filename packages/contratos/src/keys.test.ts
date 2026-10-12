import { describe, expect, it } from "vitest"
import { actionForKey, type KeyInput } from "./keys"

const key = (keyName: string, overrides: Partial<KeyInput> = {}): KeyInput => ({
  alt: false,
  control: false,
  key: keyName,
  meta: false,
  ...overrides,
})

describe("actionForKey", () => {
  it.each([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
    ["Enter", "ok"],
    ["Select", "ok"],
    ["Escape", "back"],
    ["BrowserBack", "back"],
    ["GoBack", "back"],
    ["Backspace", "back"],
    [" ", "play-pause"],
    ["MediaPlayPause", "play-pause"],
    ["MediaPlay", "play"],
    ["MediaPause", "pause"],
    ["MediaStop", "pause"],
  ])("maps %s to %s", (name, action) => {
    expect(actionForKey(key(name), false)).toBe(action)
  })

  it("lets text entry keep Backspace and Space", () => {
    expect(actionForKey(key("Backspace"), true)).toBeUndefined()
    expect(actionForKey(key(" "), true)).toBeUndefined()
    expect(actionForKey(key("Enter"), true)).toBe("ok")
    expect(actionForKey(key("ArrowDown"), true)).toBe("down")
  })

  it("ignores letters and shortcuts with modifiers", () => {
    expect(actionForKey(key("a"), false)).toBeUndefined()
    expect(actionForKey(key("ArrowUp", { control: true }), false)).toBeUndefined()
    expect(actionForKey(key("Escape", { alt: true }), false)).toBeUndefined()
  })
})
