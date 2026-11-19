// @vitest-environment jsdom

import type { RecentChannel, StreamCard } from "@goodttv/contratos"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Channel } from "./channel"
import type { HomeData, HomeSketch } from "./data"
import {
  channelToShow,
  type HomeChannels,
  lineupOf,
  useHomeChannels,
  useRefreshOnReturnHome,
} from "./home-channels"
import type { FollowedOrder } from "./watch-time"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const stream = (login: string, viewerCount: number): StreamCard => ({
  category: "Just Chatting",
  id: `s-${login}`,
  startedAt: "2026-11-19T10:00:00Z",
  thumbnailUrl: `https://t/${login}-{width}x{height}.jpg`,
  title: `Directo de ${login}`,
  userId: `u-${login}`,
  userLogin: login,
  userName: login.toUpperCase(),
  viewerCount,
})
const recent = (login: string): RecentChannel => ({
  displayName: login.toUpperCase(),
  login,
  watchedAt: 1,
})
const channel = (login: string, live: boolean): Channel => ({
  displayName: login.toUpperCase(),
  live,
  login,
})

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

// Pinta un componente que usa el hook y devuelve lo último que dio.
const render = <Props extends object, Result>(
  hook: (props: Props) => Result,
  props: Props,
): { readonly last: () => Result; readonly rerender: (next: Props) => void } => {
  let result: Result | undefined
  const Probe = (each: Props) => {
    result = hook(each)
    return null
  }
  root ??= createRoot(document.body.appendChild(document.createElement("div")))
  const draw = (each: Props): void => act(() => root?.render(createElement(Probe, each)))
  draw(props)
  return {
    last: () => {
      if (result === undefined) throw new Error("sin resultado")
      return result
    },
    rerender: draw,
  }
}

describe("useHomeChannels", () => {
  const data: HomeData = {
    following: [stream("poco", 10), stream("mucho", 900)],
    popular: [stream("ibai", 50_000)],
    recentLive: new Map([["poco", stream("poco", 10)]]),
    recents: [recent("poco"), recent("apagado")],
  }
  type Props = {
    readonly data: HomeData | undefined
    readonly order: FollowedOrder
    readonly sketch: HomeSketch | undefined
  }
  const use = ({ data, order, sketch }: Props) => useHomeChannels(data, sketch, order)

  it("da los seguidos en el orden elegido, los populares y los recientes, con si emiten", () => {
    const { last } = render(use, { data, order: "espectadores", sketch: undefined })
    expect(last().following.map((each) => each.login)).toEqual(["mucho", "poco"])
    expect(last().popular.map((each) => each.login)).toEqual(["ibai"])
    expect(last().recents.map((each) => [each.login, each.live])).toEqual([
      ["poco", true],
      ["apagado", false],
    ])
  })

  it("con lo guardado de hace rato (sketch), solo los recientes, sin su directo", () => {
    const sketch: HomeSketch = { following: 3, popular: 2, recents: [recent("poco")] }
    const { last } = render(use, { data: undefined, order: "espectadores", sketch })
    expect(last()).toEqual({
      following: [],
      popular: [],
      recents: [{ displayName: "POCO", live: false, login: "poco" }],
    })
  })

  it("cada lista cambia solo cuando cambia lo suyo", () => {
    const { last, rerender } = render(use, { data, order: "espectadores", sketch: undefined })
    const first = last()
    rerender({ data, order: "espectadores", sketch: undefined })
    expect(last()).toBe(first)
    rerender({ data, order: "recomendado", sketch: undefined })
    expect(last().following).not.toBe(first.following)
    expect(last().popular).toBe(first.popular)
    expect(last().recents).toBe(first.recents)
  })
})

describe("el canal abierto y su lista", () => {
  const lists: HomeChannels = {
    following: [channel("ana", true), channel("bea", true)],
    popular: [channel("ibai", true), channel("bea", true)],
    recents: [channel("apagado", false), channel("reciente", true)],
  }

  it("el último abierto, con lo que se sabía; si no, el de las listas, o solo su nombre", () => {
    const opened: Channel = { ...channel("ibai", true), title: "Abierto desde la búsqueda" }
    expect(channelToShow("ibai", opened, lists)).toBe(opened)
    expect(channelToShow("ana", opened, lists)).toBe(lists.following[0])
    expect(channelToShow("nadie", undefined, lists)).toEqual({
      displayName: "nadie",
      login: "nadie",
    })
  })

  it("recorre la primera lista que lo tiene: seguidos, populares y los recientes que emiten", () => {
    expect(lineupOf("bea", lists)).toBe(lists.following)
    expect(lineupOf("ibai", lists)).toBe(lists.popular)
    expect(lineupOf("reciente", lists).map((each) => each.login)).toEqual(["reciente"])
    expect(lineupOf("apagado", lists)).toEqual([])
    expect(lineupOf(undefined, lists)).toEqual([])
  })
})

describe("useRefreshOnReturnHome", () => {
  it("recarga al volver a Inicio, no al abrir ni al quedarse", () => {
    const refresh = vi.fn(async () => undefined)
    const use = ({ atHome }: { readonly atHome: boolean }) =>
      useRefreshOnReturnHome(atHome, refresh)
    const { rerender } = render(use, { atHome: true })
    rerender({ atHome: true })
    expect(refresh).not.toHaveBeenCalled()
    rerender({ atHome: false })
    expect(refresh).not.toHaveBeenCalled()
    rerender({ atHome: true })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
