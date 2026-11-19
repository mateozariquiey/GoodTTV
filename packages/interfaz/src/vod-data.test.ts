// @vitest-environment jsdom

import type { Storyboard, VideoDetail, VideoList } from "@goodttv/contratos"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useChannelVods, useStoryboard, useVodDetail, type VodListLoad } from "./vod-data"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const video = (id: string, storyboard: string | null = null): VideoDetail => ({
  category: null,
  createdAt: "2026-10-18T17:34:21Z",
  id,
  owner: { avatar: null, displayName: "Ibai", id: "1", login: "ibai" },
  seconds: 3600,
  storyboard,
  thumbnail: null,
  title: `Vídeo ${id}`,
  views: 0,
})
const board: Storyboard = {
  cols: 5,
  count: 100,
  height: 90,
  interval: 10,
  rows: 5,
  sheets: ["https://static-cdn.jtvnw.net/cf_vods/hoja-0.jpg"],
  width: 160,
}

const get = vi.fn<(id: string) => Promise<VideoDetail | null>>()
const storyboard = vi.fn<(url: string) => Promise<Storyboard | null>>()
const list = vi.fn<(login: string) => Promise<VideoList | null>>()

let root: Root | undefined
const render = async (element: ReturnType<typeof createElement>): Promise<void> => {
  await act(async () => root?.render(element))
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.stubGlobal("api", { vods: { get, list, storyboard } })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => {
  act(() => root?.unmount())
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("los datos de un VOD", () => {
  let now: ReturnType<typeof useVodDetail> | undefined
  const Probe = ({ id }: { readonly id: string }) => {
    now = useVodDetail(id)
    return null
  }

  it("llegan, o dicen que ya no existe", async () => {
    get.mockImplementation(async (id) => (id === "1" ? video("1") : null))
    await render(createElement(Probe, { id: "1" }))
    expect(now?.load).toEqual({ kind: "ready", video: video("1") })
    await render(createElement(Probe, { id: "2" }))
    expect(now?.load).toEqual({ kind: "missing" })
  })

  it("si fallan, se pueden pedir otra vez", async () => {
    get.mockRejectedValueOnce(new Error("sin red")).mockResolvedValue(video("3"))
    await render(createElement(Probe, { id: "3" }))
    expect(now?.load.kind).toBe("error")
    await act(async () => now?.retry())
    await act(async () => {
      await Promise.resolve()
    })
    expect(now?.load.kind).toBe("ready")
  })

  it("sin VOD en esta versión, es un fallo", async () => {
    vi.stubGlobal("api", {})
    await render(createElement(Probe, { id: "4" }))
    expect(now?.load.kind).toBe("error")
  })
})

describe("las miniaturas de la barra", () => {
  let now: Storyboard | null | undefined
  const Probe = ({ of }: { readonly of: VideoDetail | null }) => {
    now = useStoryboard(of)
    return null
  }

  it("se piden con el vídeo, si tiene", async () => {
    storyboard.mockResolvedValue(board)
    await render(createElement(Probe, { of: null }))
    expect(now).toBeNull()
    await render(createElement(Probe, { of: video("5", "https://static-cdn.jtvnw.net/sb.json") }))
    expect(storyboard).toHaveBeenCalledWith("https://static-cdn.jtvnw.net/sb.json")
    expect(now).toEqual(board)
  })

  it("las del vídeo de antes no pasan al siguiente", async () => {
    let answer: (value: Storyboard | null) => void = () => undefined
    storyboard.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    await render(createElement(Probe, { of: video("6", "https://static-cdn.jtvnw.net/6.json") }))
    await render(createElement(Probe, { of: video("7") }))
    answer(board)
    await act(async () => {
      await Promise.resolve()
    })
    expect(now).toBeNull()
  })
})

describe("los vídeos de un canal", () => {
  let now: VodListLoad | undefined
  const Probe = ({ login }: { readonly login: string }) => {
    now = useChannelVods(login)
    return null
  }

  it("cargan, o dicen que no se pudieron cargar", async () => {
    const videos: VideoList = { owner: video("8").owner, videos: [] }
    list.mockResolvedValueOnce(videos).mockRejectedValueOnce(new Error("sin red"))
    await render(createElement(Probe, { login: "ibai" }))
    expect(now).toEqual({ kind: "ready", list: videos })
    await render(createElement(Probe, { login: "otro" }))
    expect(now?.kind).toBe("error")
  })
})
