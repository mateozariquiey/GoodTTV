// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest"
import { contextOf, shortcutFor, watchPointerFocus } from "./shortcuts"

const key = (name: string, extra: Partial<KeyboardEvent> = {}) => ({
  altKey: false,
  ctrlKey: false,
  key: name,
  metaKey: false,
  ...extra,
})
const free = { onArrows: false, onControl: false, typing: false }

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
    expect(shortcutFor(key("ArrowLeft"), free)).toBe("rewind")
    expect(shortcutFor(key("L"), free)).toBe("forward")
    expect(shortcutFor(key("End"), free)).toBe("live")
    expect(shortcutFor(key("/"), free)).toBe("search")
    expect(shortcutFor(key("Escape"), free)).toBe("back")
  })

  it("escribiendo, solo Esc", () => {
    const typing = { onArrows: true, onControl: true, typing: true }
    expect(shortcutFor(key("m"), typing)).toBeUndefined()
    expect(shortcutFor(key(" "), typing)).toBeUndefined()
    expect(shortcutFor(key("Escape"), typing)).toBe("back")
  })

  it("Espacio sobre un botón es del botón; las flechas y las letras, no", () => {
    const control = { onArrows: false, onControl: true, typing: false }
    expect(shortcutFor(key(" "), control)).toBeUndefined()
    expect(shortcutFor(key("ArrowLeft"), control)).toBe("rewind")
    expect(shortcutFor(key("f"), control)).toBe("fullscreen")
  })

  it("las flechas sobre el volumen o un menú son suyas", () => {
    const arrows = { onArrows: true, onControl: true, typing: false }
    expect(shortcutFor(key("ArrowDown"), arrows)).toBeUndefined()
    expect(shortcutFor(key("ArrowRight"), arrows)).toBeUndefined()
    expect(shortcutFor(key("m"), arrows)).toBe("mute")
  })

  it("con modificadores son atajos del navegador", () => {
    expect(shortcutFor(key("f", { ctrlKey: true }), free)).toBeUndefined()
    expect(shortcutFor(key("t", { metaKey: true }), free)).toBeUndefined()
  })
})

describe("contextOf: Espacio sobre un control", () => {
  let stop: (() => void) | undefined
  afterEach(() => {
    stop?.()
    document.body.replaceChildren()
  })
  const button = (): HTMLButtonElement =>
    document.body.appendChild(document.createElement("button"))
  const pointer = (type: string, target: Element): void => {
    target.dispatchEvent(new Event(type, { bubbles: true }))
  }

  it("con el teclado, es del control", () => {
    stop = watchPointerFocus()
    const element = button()
    element.focus()
    expect(contextOf(element).onControl).toBe(true)
    expect(shortcutFor(key(" "), contextOf(element))).toBeUndefined()
  })

  it("tocado con el ratón, es pausar: el control se queda con el foco sin haberlo pedido", () => {
    stop = watchPointerFocus()
    const element = button()
    pointer("pointerdown", element)
    element.focus()
    pointer("pointerup", element)
    expect(contextOf(element).onControl).toBe(false)
    expect(shortcutFor(key(" "), contextOf(element))).toBe("play-pause")
    // Tab a otro: ese sí es del teclado.
    const next = button()
    next.focus()
    expect(contextOf(next).onControl).toBe(true)
    // Y si después se pulsa con el ratón (ya tenía el foco: no llega otro focusin), ya no.
    pointer("pointerdown", next)
    pointer("pointerup", next)
    expect(contextOf(next).onControl).toBe(false)
  })
})
