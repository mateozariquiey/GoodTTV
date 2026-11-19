// @vitest-environment jsdom

import type { ChannelCard } from "@goodttv/contratos"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Channel } from "./channel"
import {
  type ChannelSearch,
  channelSearchDetail,
  typedChannel,
  useChannelSearch,
} from "./channel-search"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const card = (login: string): ChannelCard => ({
  category: "",
  displayName: login.toUpperCase(),
  id: `u-${login}`,
  isLive: false,
  login,
  thumbnailUrl: `https://f/${login}.png`,
  title: "",
})

let root: Root | undefined
let search: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  search = vi.fn(async ({ query }: { query: string }) => [card(query)])
  vi.stubGlobal("api", { catalog: { search } })
})
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

type Props = { readonly minLength?: number; readonly text: string }
let last: { readonly results: ChannelSearch; readonly retry: () => void } | undefined
const Probe = ({ minLength, text }: Props) => {
  last = useChannelSearch(
    text,
    minLength === undefined ? { delayMs: 150 } : { delayMs: 150, minLength },
  )
  return null
}
const draw = (props: Props): void => {
  root ??= createRoot(document.body.appendChild(document.createElement("div")))
  act(() => root?.render(createElement(Probe, props)))
}
const results = (): ChannelSearch => {
  if (last === undefined) throw new Error("sin resultado")
  return last.results
}
// Pasa el tiempo y deja que lleguen las respuestas.
const wait = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe("useChannelSearch", () => {
  it("sin nada escrito, nada; al escribir, busca tras un momento sin escribir", async () => {
    draw({ text: "" })
    expect(results()).toEqual({ kind: "idle" })
    draw({ text: "ibai" })
    expect(results()).toEqual({ kind: "loading", text: "ibai" })
    await wait(149)
    expect(search).not.toHaveBeenCalled()
    await wait(1)
    expect(search).toHaveBeenCalledWith({ first: 20, query: "ibai" })
    expect(results()).toEqual({
      channels: [expect.objectContaining({ login: "ibai" })],
      kind: "ready",
      text: "ibai",
    })
  })

  it("al seguir escribiendo, solo busca lo último, y una respuesta que llega tarde se descarta", async () => {
    let answer: ((value: ChannelCard[]) => void) | undefined
    search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    draw({ text: "ib" })
    await wait(100)
    draw({ text: "iba" })
    await wait(150)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenLastCalledWith({ first: 20, query: "iba" })
    draw({ text: "ibai" })
    await act(async () => answer?.([card("iba")]))
    expect(results()).toEqual({ kind: "loading", text: "ibai" })
    await wait(150)
    expect(results()).toMatchObject({ kind: "ready", text: "ibai" })
  })

  it("si falla, lo dice; retry vuelve a buscar lo mismo", async () => {
    search.mockRejectedValueOnce(new Error("sin red"))
    draw({ text: "ibai" })
    await wait(150)
    expect(results()).toEqual({ kind: "error", text: "ibai" })
    act(() => last?.retry())
    expect(results()).toEqual({ kind: "loading", text: "ibai" })
    await wait(150)
    expect(search).toHaveBeenCalledTimes(2)
    expect(results()).toMatchObject({ kind: "ready", text: "ibai" })
  })

  it("con menos letras de las pedidas (la TV pide dos), no busca", async () => {
    draw({ minLength: 2, text: "i" })
    await wait(500)
    expect(results()).toEqual({ kind: "idle" })
    expect(search).not.toHaveBeenCalled()
  })
})

describe("typedChannel", () => {
  it("lo escrito, si puede ser un nombre de usuario de Twitch, en minúsculas", () => {
    expect(typedChannel("Ibai_2")).toEqual({ displayName: "Ibai_2", login: "ibai_2" })
    expect(typedChannel("con espacio")).toBeUndefined()
    expect(typedChannel("")).toBeUndefined()
    expect(typedChannel("a".repeat(26))).toBeUndefined()
  })
})

describe("channelSearchDetail", () => {
  const channel = (extra: Partial<Channel>): Channel => ({ displayName: "X", login: "x", ...extra })

  it("los seguidores, abreviados con un decimal, y la categoría", () => {
    // Intl separa la cifra de «mil» con un espacio duro.
    expect(channelSearchDetail(channel({ category: "Just Chatting", followers: 12_345 }))).toBe(
      "12,3\u00a0mil seguidores · Just Chatting",
    )
    expect(channelSearchDetail(channel({ followers: 950 }))).toBe("950 seguidores")
  })

  it("lo que no se sabe no sale", () => {
    expect(channelSearchDetail(channel({ category: "" }))).toBe("")
    expect(channelSearchDetail(channel({ category: "Fortnite" }))).toBe("Fortnite")
  })
})
