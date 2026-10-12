// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createNavigation } from "./navigation"

// jsdom has no layout: give each control a fixed box so spatial navigation can run.
const place = (element: HTMLElement, left: number, top: number, width = 100, height = 40): void => {
  const rect = {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
  }
  element.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect })
  element.getClientRects = () => [rect] as unknown as DOMRectList
}

const button = (root: HTMLElement, id: string, left: number, top: number): HTMLButtonElement => {
  const element = document.createElement("button")
  element.dataset["nav"] = ""
  element.dataset["navId"] = id
  element.textContent = id
  place(element, left, top)
  root.append(element)
  return element
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

let navigation: ReturnType<typeof createNavigation>
let uninstall: () => void

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  Element.prototype.scrollIntoView = vi.fn()
  navigation = createNavigation()
  uninstall = navigation.install()
})

afterEach(() => {
  uninstall()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const grid = () => {
  const root = document.createElement("div")
  document.body.append(root)
  const a = button(root, "a", 0, 0)
  const b = button(root, "b", 200, 0)
  const c = button(root, "c", 0, 100)
  return { a, b, c, root }
}

describe("navigation", () => {
  it("focuses the entry control when a layer opens and moves spatially", async () => {
    const { b, c, root } = grid()
    c.dataset["navEntry"] = ""
    navigation.push({ id: "home", root: () => root })
    await frame()
    expect(document.activeElement).toBe(c)
    navigation.dispatch("up")
    expect(document.activeElement?.textContent).toBe("a")
    navigation.dispatch("right")
    expect(document.activeElement).toBe(b)
  })

  it("follows explicit neighbours and blocked directions", async () => {
    const { a, c, root } = grid()
    a.dataset["navRight"] = "c"
    c.dataset["navLeft"] = "none"
    navigation.push({ id: "home", root: () => root })
    await frame()
    a.focus()
    navigation.dispatch("right")
    expect(document.activeElement).toBe(c)
    navigation.dispatch("left")
    expect(document.activeElement).toBe(c)
  })

  it("skips disabled and hidden controls", async () => {
    const { a, b, root } = grid()
    b.disabled = true
    const hidden = button(root, "hidden", 400, 0)
    hidden.getClientRects = () => [] as unknown as DOMRectList
    navigation.push({ id: "home", root: () => root })
    await frame()
    a.focus()
    navigation.dispatch("right")
    expect(document.activeElement).toBe(a)
  })

  it("recovers lost focus on the first key instead of moving", async () => {
    const { a, b, root } = grid()
    navigation.push({ id: "home", root: () => root })
    await frame()
    b.focus()
    b.blur()
    expect(document.activeElement).toBe(document.body)
    navigation.dispatch("down")
    expect(document.activeElement).toBe(b)
    a.remove()
  })

  it("treats focus inside another document (the player iframe) as lost", async () => {
    const { b, root } = grid()
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    navigation.push({ id: "player", root: () => root })
    await frame()
    b.focus()
    iframe.focus()
    navigation.dispatch("ok")
    expect(document.activeElement).toBe(b)
  })

  it("clicks on OK and asks the layer on Back", async () => {
    const { a, root } = grid()
    const onBack = vi.fn()
    const click = vi.fn()
    a.addEventListener("click", click)
    navigation.push({ id: "home", onBack, root: () => root })
    await frame()
    a.focus()
    navigation.dispatch("ok")
    navigation.dispatch("back")
    expect(click).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it("lets a layer consume actions first", async () => {
    const { a, root } = grid()
    const onAction = vi.fn((action: string) => action === "up" || action === "play-pause")
    navigation.push({ id: "player", onAction, root: () => root })
    await frame()
    a.focus()
    navigation.dispatch("play-pause")
    navigation.dispatch("down")
    expect(onAction).toHaveBeenCalledWith("play-pause")
    expect(document.activeElement?.textContent).toBe("c")
  })

  it("only the top layer reacts, and closing it returns to the remembered control", async () => {
    const { b, root } = grid()
    const homeBack = vi.fn()
    navigation.push({ id: "home", onBack: homeBack, root: () => root })
    await frame()
    b.focus()
    const playerRoot = document.createElement("div")
    document.body.append(playerRoot)
    const pause = button(playerRoot, "pause", 0, 500)
    const pop = navigation.push({ id: "player", root: () => playerRoot })
    await frame()
    expect(document.activeElement).toBe(pause)
    navigation.dispatch("back")
    expect(homeBack).not.toHaveBeenCalled()
    pop()
    playerRoot.remove()
    await frame()
    expect(document.activeElement).toBe(b)
  })

  it("forgets a layer's memory on request", async () => {
    const { a, b, root } = grid()
    navigation.push({ id: "player", root: () => root })
    await frame()
    b.focus()
    navigation.forget("player")
    b.blur()
    navigation.dispatch("down")
    expect(document.activeElement).toBe(a)
  })

  it("ensureFocus only acts when focus is lost", async () => {
    const { b, c, root } = grid()
    navigation.push({ id: "home", root: () => root })
    await frame()
    c.focus()
    navigation.ensureFocus()
    expect(document.activeElement).toBe(c)
    c.remove()
    navigation.ensureFocus()
    expect([b.textContent, "a"]).toContain(document.activeElement?.textContent)
  })
})

it("never remembers transient controls such as section tabs", async () => {
  const { a, b, root } = grid()
  b.dataset["navTransient"] = ""
  navigation.push({ id: "home", root: () => root })
  await frame()
  a.focus()
  b.focus()
  b.blur()
  navigation.dispatch("down")
  expect(document.activeElement).toBe(a)
})

it("enters a group on its current member", async () => {
  const root = document.createElement("div")
  document.body.append(root)
  const first = button(root, "tab-home", 0, 0)
  const second = button(root, "tab-search", 200, 0)
  for (const tab of [first, second]) tab.dataset["navGroup"] = "tabs"
  first.setAttribute("aria-current", "page")
  const row = button(root, "row", 180, 100)
  navigation.push({ id: "home", root: () => root })
  await frame()
  row.focus()
  navigation.dispatch("up")
  expect(document.activeElement).toBe(first)
  // Inside the group, movement stays geometric.
  navigation.dispatch("right")
  expect(document.activeElement).toBe(second)
})

it("a submenu inside a screen does not overwrite the screen's memory", async () => {
  const root = document.createElement("div")
  document.body.append(root)
  const quality = button(root, "quality", 0, 0)
  button(root, "pause", 200, 0)
  navigation.push({ id: "player", root: () => root })
  await frame()
  quality.focus()
  const chooser = document.createElement("div")
  root.append(chooser)
  const auto = button(chooser, "auto", 0, 100)
  const pop = navigation.push({ id: "chooser", root: () => chooser })
  await frame()
  expect(document.activeElement).toBe(auto)
  pop()
  chooser.remove()
  await frame()
  expect(document.activeElement).toBe(quality)
})

it("follows the first present id when an override lists several", async () => {
  const { a, c, root } = grid()
  c.dataset["navUp"] = "missing a"
  navigation.push({ id: "home", root: () => root })
  await frame()
  c.focus()
  navigation.dispatch("up")
  expect(document.activeElement).toBe(a)
})
