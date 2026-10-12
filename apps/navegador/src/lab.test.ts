import type { AppApi, RecentChannel } from "@goodttv/contratos"
import { afterEach, describe, expect, it, vi } from "vitest"
import { labApi } from "./lab"

// Solo lo que usa labApi de la API real.
const realApi = () => {
  const saved: RecentChannel[] = []
  const api = {
    auth: {},
    catalog: { streamsByLogin: async () => [] },
    chat: {},
    recents: {
      add: async (channel: RecentChannel) => {
        saved.push(channel)
        return saved
      },
      list: async () => saved,
    },
  } as unknown as AppApi
  return { api, saved }
}

// IRC de Twitch falso: guarda lo que se le envía.
const sent: string[] = []
class FakeSocket extends EventTarget {
  constructor(_url: string) {
    super()
    setTimeout(() => this.dispatchEvent(new Event("open")), 0)
  }
  send(line: string): void {
    sent.push(line)
  }
  close(): void {}
}

afterEach(() => {
  sent.length = 0
  vi.unstubAllGlobals()
})

describe("chat del laboratorio", () => {
  it("con ?chatreal se une al chat del canal abierto, no al último pedido por su nombre", async () => {
    vi.stubGlobal("WebSocket", FakeSocket)
    vi.stubGlobal("location", { hash: "#/canal/abierto" })
    const api = labApi(realApi().api, "?chatreal")
    await api.catalog.streamsByLogin(["reciente"]) // Inicio completa los recientes
    await api.chat.open({ broadcasterId: "123" }) // el canal abierto ya traía su id
    await new Promise((done) => setTimeout(done, 5))
    await api.chat.close()
    expect(sent.filter((line) => line.startsWith("JOIN"))).toEqual(["JOIN #abierto"])
  })

  it("no guarda en recientes los datos ficticios del canal (su id)", async () => {
    const { api: real, saved } = realApi()
    const api = labApi(real, "?chatsintetico=40")
    const [stream] = await api.catalog.streamsByLogin(["x"])
    await api.recents.add({
      displayName: "x",
      login: "x",
      userId: stream?.userId ?? "",
      watchedAt: 0,
    })
    expect(saved).toEqual([])
  })

  it("sin parámetros del laboratorio, la API es la real", () => {
    const { api } = realApi()
    expect(labApi(api, "")).toBe(api)
  })
})
