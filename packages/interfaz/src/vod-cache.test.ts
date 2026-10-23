import { afterEach, describe, expect, it, vi } from "vitest"
import { prefetchVod, renewVod, VOD_WARM_MS, vodDetail, vodPlayback } from "./vod-cache"

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

  it("sin VOD en la plataforma (la tele), falla", async () => {
    vi.stubGlobal("window", { api: {} })
    await expect(vodDetail("12")).rejects.toThrow("sin VOD")
  })
})
