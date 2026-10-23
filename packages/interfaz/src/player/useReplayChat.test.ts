// @vitest-environment jsdom

import type { ReplayInput, ReplayMessage } from "@goodttv/contratos"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatView } from "./useChat"
import { useReplayChat } from "./useReplayChat"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const at = (offset: number): ReplayMessage => ({
  action: false,
  badges: [],
  color: "#bf94ff",
  displayName: "Viewer",
  id: `m${offset}`,
  offset,
  tokens: [{ kind: "text", text: String(offset) }],
  userId: "1",
})

// Twitch da unos 50 mensajes desde un segundo: aquí, uno cada 2 s durante 100 s, empezando algo antes.
const everyTwoSeconds = async ({ offset }: ReplayInput) =>
  Array.from({ length: 50 }, (_, index) => at(Math.max(0, offset - 4) + index * 2))
const comments = vi.fn(everyTwoSeconds)

let root: Root | undefined
let view: ChatView | undefined
const Chat = ({ time }: { readonly time: number }) => {
  view = useReplayChat("2904365699", "83232866", time, true)
  return null
}
const render = async (time: number): Promise<void> => {
  await act(async () => root?.render(createElement(Chat, { time })))
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  comments.mockImplementation(everyTwoSeconds)
  vi.stubGlobal("api", { vods: { comments } })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => {
  act(() => root?.unmount())
  comments.mockClear()
  vi.unstubAllGlobals()
})

describe("el chat de un VOD", () => {
  it("enseña los mensajes que ya han pasado, a la par de la imagen", async () => {
    await render(600)
    expect(comments).toHaveBeenCalledWith({
      channelId: "83232866",
      offset: 580,
      videoId: "2904365699",
    })
    await render(601)
    expect(view?.status).toBe("connected")
    const shown = (view?.messages ?? []) as readonly ReplayMessage[]
    expect(shown.at(-1)?.offset).toBe(600)
    expect(shown.every((message) => message.offset <= 601)).toBe(true)
  })

  it("pide más por delante cuando quedan menos de 60 s pedidos", async () => {
    await render(600)
    await render(601)
    const calls = comments.mock.calls.length
    await render(620)
    expect(comments.mock.calls.length).toBe(calls + 1)
    expect(comments.mock.calls.at(-1)?.[0].offset).toBe(675)
  })

  it("con un chat muy activo, sigue desde lo recibido y no repite la misma petición", async () => {
    // 50 mensajes en 5 s: desde 580 solo llegan hasta 584,9, y se está viendo el 600.
    comments.mockImplementation(async ({ offset }: ReplayInput) =>
      Array.from({ length: 50 }, (_, index) => at(offset + index / 10)),
    )
    await render(600)
    for (let step = 0; step < 4; step++) await render(600)
    const offsets = comments.mock.calls.map(([input]) => input.offset)
    expect(new Set(offsets).size).toBe(offsets.length)
    expect(offsets.slice(0, 3)).toEqual([580, 585, 590])
  })

  it("al saltar lejos, empieza desde el sitio nuevo", async () => {
    await render(600)
    await render(601)
    await render(3600)
    expect(comments.mock.calls.at(-1)?.[0].offset).toBe(3580)
    await render(3601)
    expect(((view?.messages ?? []) as readonly ReplayMessage[])[0]?.offset).toBeGreaterThanOrEqual(
      3576,
    )
  })
})
