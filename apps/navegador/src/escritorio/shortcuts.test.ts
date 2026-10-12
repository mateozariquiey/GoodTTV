import { describe, expect, it } from "vitest"
import { shortcutFor } from "./shortcuts"

const key = (name: string, extra: Partial<KeyboardEvent> = {}) => ({
  altKey: false,
  ctrlKey: false,
  key: name,
  metaKey: false,
  ...extra,
})
const free = { onControl: false, typing: false }

describe("shortcutFor", () => {
  it("cada tecla, su atajo, en mayúsculas o minúsculas", () => {
    expect(shortcutFor(key(" "), free)).toBe("play-pause")
    expect(shortcutFor(key("K"), free)).toBe("play-pause")
    expect(shortcutFor(key("m"), free)).toBe("mute")
    expect(shortcutFor(key("f"), free)).toBe("fullscreen")
    expect(shortcutFor(key("t"), free)).toBe("theater")
    expect(shortcutFor(key("c"), free)).toBe("chat")
    expect(shortcutFor(key("ArrowUp"), free)).toBe("previous")
    expect(shortcutFor(key("ArrowDown"), free)).toBe("next")
    expect(shortcutFor(key("/"), free)).toBe("search")
    expect(shortcutFor(key("Escape"), free)).toBe("back")
  })

  it("escribiendo, solo Esc", () => {
    const typing = { onControl: true, typing: true }
    expect(shortcutFor(key("m"), typing)).toBeUndefined()
    expect(shortcutFor(key(" "), typing)).toBeUndefined()
    expect(shortcutFor(key("Escape"), typing)).toBe("back")
  })

  it("Espacio y las flechas sobre un botón son del botón; las letras, no", () => {
    const control = { onControl: true, typing: false }
    expect(shortcutFor(key(" "), control)).toBeUndefined()
    expect(shortcutFor(key("ArrowDown"), control)).toBeUndefined()
    expect(shortcutFor(key("f"), control)).toBe("fullscreen")
  })

  it("con modificadores son atajos del navegador", () => {
    expect(shortcutFor(key("f", { ctrlKey: true }), free)).toBeUndefined()
    expect(shortcutFor(key("t", { metaKey: true }), free)).toBeUndefined()
  })
})
