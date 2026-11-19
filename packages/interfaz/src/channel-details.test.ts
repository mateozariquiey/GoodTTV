// @vitest-environment jsdom

import type { ChannelCard, StreamCard } from "@goodttv/contratos"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Channel } from "./channel"
import { useChannelDetails, useFollowing, useRecentChannel } from "./channel-details"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const card: ChannelCard = {
  category: "Just Chatting",
  displayName: "Ibai",
  id: "83232866",
  isLive: true,
  login: "ibai",
  thumbnailUrl: "https://static-cdn.jtvnw.net/foto-buscador.png",
  title: "Del buscador",
}
const stream: StreamCard = {
  category: "Just Chatting",
  id: "1",
  startedAt: "2026-11-19T10:00:00Z",
  thumbnailUrl: "https://static-cdn.jtvnw.net/miniatura.jpg",
  title: "Del directo",
  userId: "83232866",
  userLogin: "ibai",
  userName: "Ibai",
  viewerCount: 1200,
}

// Promesas que se resuelven cuando la prueba quiere, para elegir el orden en que llegan.
const later = <Value>() => {
  let resolve: (value: Value) => void = () => undefined
  const promise = new Promise<Value>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const channelOf = vi.fn<(login: string) => Promise<ChannelCard | null>>()
const streamsByLogin = vi.fn<(logins: readonly string[]) => Promise<readonly StreamCard[]>>()
const follows = vi.fn<(id: string) => Promise<boolean>>()
const add = vi.fn(async () => [])

let root: Root | undefined
let details: Channel | undefined
let following: boolean | null | undefined
const Probe = ({
  channel,
  signedIn,
}: {
  readonly channel: Channel
  readonly signedIn: boolean
}) => {
  details = useChannelDetails(channel, signedIn)
  following = useFollowing(details.userId, signedIn)
  useRecentChannel(details)
  return null
}
const render = async (channel: Channel, signedIn = true): Promise<void> => {
  await act(async () => root?.render(createElement(Probe, { channel, signedIn })))
}
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  follows.mockResolvedValue(false)
  vi.stubGlobal("api", {
    catalog: { channel: channelOf, follows, streamsByLogin },
    recents: { add },
  })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => {
  act(() => root?.unmount())
  details = undefined
  following = undefined
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("los datos del canal abierto por su nombre", () => {
  it("sin cuenta, los completa el buscador: nombre, foto e id", async () => {
    channelOf.mockResolvedValue(card)
    await render({ displayName: "ibai", login: "ibai" }, false)
    await settle()
    expect(details).toMatchObject({
      displayName: "Ibai",
      profileImageUrl: card.thumbnailUrl,
      userId: "83232866",
    })
    expect(streamsByLogin).not.toHaveBeenCalled()
  })

  it("con cuenta, si el directo llega antes, lo del buscador no lo pisa", async () => {
    const fromCard = later<ChannelCard | null>()
    channelOf.mockReturnValue(fromCard.promise)
    streamsByLogin.mockResolvedValue([stream])
    await render({ displayName: "ibai", login: "ibai" })
    await settle()
    expect(details?.title).toBe("Del directo")
    fromCard.resolve(card)
    await settle()
    // Del buscador, solo la foto que el directo no traía.
    expect(details).toMatchObject({
      profileImageUrl: card.thumbnailUrl,
      startedAt: stream.startedAt,
      title: "Del directo",
      viewerCount: 1200,
    })
  })

  it("si el buscador llega antes, el directo se queda con su foto", async () => {
    channelOf.mockResolvedValue(card)
    const fromStream = later<readonly StreamCard[]>()
    streamsByLogin.mockReturnValue(fromStream.promise)
    await render({ displayName: "ibai", login: "ibai" })
    await settle()
    fromStream.resolve([stream])
    await settle()
    expect(details).toMatchObject({ profileImageUrl: card.thumbnailUrl, title: "Del directo" })
  })

  it("con su id y su nombre, no pide nada", async () => {
    await render({ displayName: "Ibai", login: "ibai", userId: "83232866" })
    expect(channelOf).not.toHaveBeenCalled()
    expect(streamsByLogin).not.toHaveBeenCalled()
  })

  it("un reciente con el login por nombre se corrige, sin perder lo que ya se sabía", async () => {
    channelOf.mockResolvedValue({ ...card, thumbnailUrl: "https://static-cdn.jtvnw.net/otra.png" })
    streamsByLogin.mockResolvedValue([])
    await render({
      displayName: "ibai",
      login: "ibai",
      profileImageUrl: "https://static-cdn.jtvnw.net/guardada.png",
      userId: "83232866",
    })
    await settle()
    expect(details).toMatchObject({
      displayName: "Ibai",
      profileImageUrl: "https://static-cdn.jtvnw.net/guardada.png",
    })
  })

  it("lo que llega del canal de antes no se mezcla con el nuevo", async () => {
    const first = later<ChannelCard | null>()
    channelOf.mockReturnValueOnce(first.promise).mockResolvedValue(null)
    streamsByLogin.mockResolvedValue([])
    await render({ displayName: "ibai", login: "ibai" })
    await render({ displayName: "otro", login: "otro" })
    first.resolve(card)
    await settle()
    expect(details).toEqual({ displayName: "otro", login: "otro" })
  })

  it("va a recientes al abrirlo y otra vez al completarse", async () => {
    channelOf.mockResolvedValue(card)
    await render({ displayName: "ibai", login: "ibai" }, false)
    await settle()
    expect(add).toHaveBeenCalledTimes(2)
    expect(add).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayName: "Ibai", login: "ibai", userId: "83232866" }),
    )
  })
})

describe("si sigues el canal (SEG-1)", () => {
  const known = { displayName: "Ibai", login: "ibai", userId: "83232866" }

  it("sin cuenta no se sabe", async () => {
    await render(known, false)
    expect(follows).not.toHaveBeenCalled()
    expect(following).toBeNull()
  })

  it("con cuenta lo pregunta, y otra vez al volver a la página", async () => {
    follows.mockResolvedValue(false)
    await render(known)
    await settle()
    expect(follows).toHaveBeenCalledWith("83232866")
    expect(following).toBe(false)
    // Lo ha seguido en twitch.tv y vuelve.
    follows.mockResolvedValue(true)
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    await settle()
    expect(following).toBe(true)
  })
})
