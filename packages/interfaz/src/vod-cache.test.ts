import { afterEach, describe, expect, it, vi } from "vitest"
import {
  prefetchedVodMaster,
  prefetchVod,
  prefetchVodMaster,
  renewVod,
  VOD_WARM_MS,
  vodDetail,
  vodPlayback,
} from "./vod-cache"

const detail = { id: "1", title: "Un vídeo" }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("los VOD pedidos de antemano (vod-cache.ts)", () => {
  it("prefetchVod pide la lista y los datos una vez, y al abrir ya están", async () => {
    const api = {
      vods: { get: vi.fn(async () => detail), playback: vi.fn(async () => "https://usher/1.m3u8") },
    }
    vi.stubGlobal("window", { api })
    prefetchVod("10")
    expect(await vodDetail("10")).toEqual(detail)
    expect(await vodPlayback("10")).toBe("https://usher/1.m3u8")
    expect(api.vods.get).toHaveBeenCalledTimes(1)
    expect(api.vods.playback).toHaveBeenCalledTimes(1)
  })

  it("lo que falla no se guarda: se vuelve a pedir", async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error("gql")).mockResolvedValueOnce(detail)
    vi.stubGlobal("window", { api: { vods: { get, playback: vi.fn() } } })
    await expect(vodDetail("11")).rejects.toThrow("gql")
    expect(await vodDetail("11")).toEqual(detail)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("renovados cada VOD_WARM_MS, nunca caducan mientras se ve el canal", async () => {
    vi.useFakeTimers()
    const get = vi.fn(async () => detail)
    vi.stubGlobal("window", {
      api: { vods: { get, playback: vi.fn(async () => "https://usher/2.m3u8") } },
    })
    prefetchVod("13")
    for (let minute = 1; minute <= 3; minute++) {
      await vi.advanceTimersByTimeAsync(VOD_WARM_MS)
      renewVod("13")
      await vi.advanceTimersByTimeAsync(0)
    }
    // A los 13 min (más que lo que vale uno: 5), sigue sin tener que esperar a pedirlo.
    await vi.advanceTimersByTimeAsync(60_000)
    const calls = get.mock.calls.length
    await vodDetail("13")
    expect(get.mock.calls.length).toBe(calls)
  })

  it("la lista maestra, descargada solo si se pide antes, con la URL de la que salió", async () => {
    const fetch = vi.fn(async () => new Response("#EXTM3U\nhttps://cdn/1080p60/index-dvr.m3u8\n"))
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("window", {
      api: { vods: { get: vi.fn(), playback: vi.fn(async () => "https://usher/20.m3u8") } },
    })
    expect(await prefetchedVodMaster("20")).toBeUndefined() // sin pedirla antes, no la pide
    expect(fetch).not.toHaveBeenCalled()
    prefetchVodMaster("20")
    expect(await prefetchedVodMaster("20")).toEqual({
      text: "#EXTM3U\nhttps://cdn/1080p60/index-dvr.m3u8\n",
      url: "https://usher/20.m3u8",
    })
    expect(fetch).toHaveBeenCalledWith("https://usher/20.m3u8")
  })

  it("una lista maestra que falla (un VOD solo para suscriptores) no se da: la pide hls.js", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    )
    vi.stubGlobal("window", {
      api: { vods: { get: vi.fn(), playback: vi.fn(async () => "https://usher/21.m3u8") } },
    })
    prefetchVodMaster("21")
    expect(await prefetchedVodMaster("21")).toBeUndefined()
  })

  it("sin VOD en la plataforma (la tele), falla", async () => {
    vi.stubGlobal("window", { api: {} })
    await expect(vodDetail("12")).rejects.toThrow("sin VOD")
  })
})
