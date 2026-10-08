import { useEffect, useRef } from "react"
import type { InputAction } from "../../shared/contracts"
import { chooseNextFocus, type FocusDirection } from "./navigation-geometry"

// Remote navigation. Main turns keys into actions; this module routes them to the top layer.
//
// A layer is a screen (Home, Search, Account, Player) or a submenu on top of one. Only the top
// layer receives actions, so hidden screens can never react. Focusable controls carry `data-nav`
// and a stable `data-nav-id`; each layer remembers its last focused id, which is what "Back keeps
// your place" relies on. Without a memory, focus starts on the first `data-nav-entry` control.
// Controls marked `data-nav-transient` (the section tabs) are never remembered. Moving into a
// `data-nav-group` from outside lands on the member marked aria-current. A control can force a neighbour with `data-nav-up/down/left/right`
// (an id, or "none" to block that direction).

export type Layer = {
  readonly entry?: () => string | undefined
  readonly id: string
  readonly onAction?: (action: InputAction) => boolean
  readonly onBack?: () => void
  readonly root: () => HTMLElement | null
}

const DIRECTIONS: Partial<Record<InputAction, FocusDirection>> = {
  down: "down",
  left: "left",
  right: "right",
  up: "up",
}

const OVERRIDE_KEYS: Readonly<Record<FocusDirection, string>> = {
  down: "navDown",
  left: "navLeft",
  right: "navRight",
  up: "navUp",
}

const isUsable = (element: HTMLElement): boolean =>
  !element.hasAttribute("disabled") &&
  element.getAttribute("aria-disabled") !== "true" &&
  element.getClientRects().length > 0

export const candidatesIn = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>("[data-nav]")].filter(isUsable)

const findById = (root: HTMLElement, id: string): HTMLElement | undefined =>
  candidatesIn(root).find((element) => element.dataset["navId"] === id)

// Entering a group from outside (the section tabs) lands on its current member, not on whichever
// member happens to be geometrically closest.
const groupEntry = (root: HTMLElement, from: HTMLElement, target: HTMLElement): HTMLElement => {
  const group = target.dataset["navGroup"]
  if (group === undefined || from.dataset["navGroup"] === group) return target
  return (
    candidatesIn(root).find(
      (element) =>
        element.dataset["navGroup"] === group &&
        element.hasAttribute("aria-current") &&
        element.getAttribute("aria-current") !== "false",
    ) ?? target
  )
}

export const focusElement = (element: HTMLElement): void => {
  element.focus({ preventScroll: true })
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
  element.scrollIntoView({
    behavior: reduced ? "instant" : "smooth",
    block: element.dataset["navScroll"] === "center" ? "center" : "nearest",
    inline: "nearest",
  })
}

export const createNavigation = () => {
  const layers: Layer[] = []
  const memory = new Map<string, string>()

  const top = (): Layer | undefined => layers.at(-1)

  const restore = (layer: Layer): boolean => {
    const root = layer.root()
    if (root === null) return false
    const remembered = memory.get(layer.id)
    const entry = layer.entry?.()
    const target =
      (remembered === undefined ? undefined : findById(root, remembered)) ??
      (entry === undefined ? undefined : findById(root, entry)) ??
      candidatesIn(root).find((element) => element.hasAttribute("data-nav-entry")) ??
      candidatesIn(root)[0]
    if (target === undefined) return false
    focusElement(target)
    return true
  }

  // The focused control, if it belongs to the active layer. Anything else (body, the player
  // iframe after a stray click, a removed card) counts as "focus lost".
  const activeIn = (layer: Layer): HTMLElement | undefined => {
    const root = layer.root()
    const active = document.activeElement
    if (root === null || !(active instanceof HTMLElement)) return undefined
    return candidatesIn(root).includes(active) ? active : undefined
  }

  const move = (layer: Layer, direction: FocusDirection): void => {
    const root = layer.root()
    const current = activeIn(layer)
    if (root === null || current === undefined) {
      restore(layer)
      return
    }
    const override = current.dataset[OVERRIDE_KEYS[direction]]
    if (override === "none") return
    if (override !== undefined) {
      // Several ids may be listed: the first one present wins.
      const target = override
        .split(" ")
        .map((id) => findById(root, id))
        .find((element) => element !== undefined)
      if (target !== undefined) {
        focusElement(target)
        return
      }
    }
    const elements = candidatesIn(root)
    const candidates = elements.map((element, index) => {
      const bounds = element.getBoundingClientRect()
      return {
        bottom: bounds.bottom,
        id: String(index),
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
      }
    })
    const currentIndex = elements.indexOf(current)
    const next = chooseNextFocus(candidates[currentIndex], candidates, direction)
    const target = next === undefined ? undefined : elements[Number(next.id)]
    if (target !== undefined) focusElement(groupEntry(root, current, target))
  }

  const dispatch = (action: InputAction): void => {
    const layer = top()
    if (layer === undefined) return
    if (layer.onAction?.(action) === true) return
    const direction = DIRECTIONS[action]
    if (direction !== undefined) {
      move(layer, direction)
      return
    }
    if (action === "ok") {
      const current = activeIn(layer)
      if (current === undefined) restore(layer)
      else current.click()
      return
    }
    if (action === "back") layer.onBack?.()
  }

  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const id = target.dataset["navId"]
    // Section tabs are a way through, not a place: Back should not return to them.
    if (id === undefined || target.hasAttribute("data-nav-transient")) return
    // Only the innermost layer remembers it: a submenu inside a screen must not overwrite the
    // screen's own memory (closing the quality chooser returns to «Calidad»).
    const owner = [...layers].reverse().find((layer) => layer.root()?.contains(target) === true)
    if (owner !== undefined) memory.set(owner.id, id)
  }

  return {
    dispatch,
    // Re-focus the active layer if focus was lost, for example after a list refresh.
    ensureFocus: () => {
      const layer = top()
      if (layer !== undefined && activeIn(layer) === undefined) restore(layer)
    },
    focus: (layerId: string, navId: string) => {
      memory.set(layerId, navId)
      const layer = layers.find((candidate) => candidate.id === layerId)
      const root = layer?.root() ?? null
      const target = root === null ? undefined : findById(root, navId)
      if (target !== undefined && layer === top()) focusElement(target)
    },
    forget: (layerId: string) => memory.delete(layerId),
    install: () => {
      document.addEventListener("focusin", onFocusIn)
      return () => document.removeEventListener("focusin", onFocusIn)
    },
    push: (layer: Layer): (() => void) => {
      layers.push(layer)
      requestAnimationFrame(() => {
        if (top() === layer) restore(layer)
      })
      return () => {
        const index = layers.lastIndexOf(layer)
        if (index < 0) return
        const wasTop = index === layers.length - 1
        layers.splice(index, 1)
        const next = top()
        if (wasTop && next !== undefined) requestAnimationFrame(() => restore(next))
      }
    },
    remembered: (layerId: string) => memory.get(layerId),
    top,
  }
}

export type Navigation = ReturnType<typeof createNavigation>

export const navigation = createNavigation()

// Registers a layer while `active` is true. Callbacks are read through a ref, so they can change
// on every render without re-registering the layer (which would move focus).
export const useLayer = (
  layer: Omit<Layer, "root"> & { readonly root: React.RefObject<HTMLElement | null> },
  active = true,
): void => {
  const latest = useRef(layer)
  latest.current = layer
  const { id } = layer
  useEffect(() => {
    if (!active) return undefined
    return navigation.push({
      entry: () => latest.current.entry?.(),
      id,
      onAction: (action) => latest.current.onAction?.(action) ?? false,
      onBack: () => latest.current.onBack?.(),
      root: () => latest.current.root.current,
    })
  }, [active, id])
}

export const useRemoteInput = (): void => {
  useEffect(() => {
    const uninstall = navigation.install()
    const unsubscribe = window.api.input.onAction(navigation.dispatch)
    return () => {
      unsubscribe()
      uninstall()
    }
  }, [])
}
