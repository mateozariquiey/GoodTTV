import { describe, expect, it } from "vitest"
import { chooseNextFocus, type FocusCandidate } from "./navigation-geometry"

const box = (
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
): FocusCandidate => ({
  bottom: top + height,
  id,
  left,
  right: left + width,
  top,
})

describe("chooseNextFocus", () => {
  it("prefers the control beside over one that is diagonally closer", () => {
    // The Settings screen: a narrow button on the left, wide settings far to the right, and the
    // section tabs up and to the right.
    const link = box("account-link", 44, 283, 227, 62)
    const tab = box("tab-account", 459, 48, 143, 60)
    const scale = box("setting-chat-scale", 992, 273, 880, 72)
    expect(chooseNextFocus(link, [link, tab, scale], "right")?.id).toBe("setting-chat-scale")
  })

  it("moves along a row and down a grid column", () => {
    const keys = ["a", "b", "c"].map((id, index) => box(id, index * 50, 0, 40, 40))
    const below = ["k", "l", "m"].map((id, index) => box(id, index * 50, 50, 40, 40))
    const all = [...keys, ...below]
    expect(chooseNextFocus(keys[0], all, "right")?.id).toBe("b")
    expect(chooseNextFocus(keys[1], all, "down")?.id).toBe("l")
    expect(chooseNextFocus(below[2], all, "up")?.id).toBe("c")
  })

  it("picks the best centred control when several are equally near", () => {
    const wide = box("clear", 200, 100, 120, 40)
    const keys = ["7", "8", "9", "0"].map((id, index) => box(id, 150 + index * 50, 50, 40, 40))
    expect(chooseNextFocus(wide, [wide, ...keys], "up")?.id).toBe("9")
  })

  it("falls back to the nearest control when nothing is aligned", () => {
    const row = box("row", 0, 200, 300, 60)
    const tab = box("tab", 400, 50, 100, 40)
    expect(chooseNextFocus(row, [row, tab], "up")?.id).toBe("tab")
  })

  it("never moves backwards or to itself", () => {
    const a = box("a", 0, 0, 40, 40)
    const b = box("b", 100, 0, 40, 40)
    expect(chooseNextFocus(a, [a, b], "left")).toBeUndefined()
    expect(chooseNextFocus(b, [a, b], "right")).toBeUndefined()
  })

  it("starts on the first candidate when nothing is focused", () => {
    const a = box("a", 0, 0, 40, 40)
    expect(chooseNextFocus(undefined, [a], "down")).toBe(a)
  })
})
