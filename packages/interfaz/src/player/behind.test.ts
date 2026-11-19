import { describe, expect, it } from "vitest"
import { chatDelayOf, TWITCH_VIEWER_LATENCY } from "./behind"

describe("el retraso del chat", () => {
  it("lo que la imagen va por detrás de un espectador normal de Twitch", () => {
    expect(chatDelayOf(TWITCH_VIEWER_LATENCY + 12.5, true)).toBe(12.5)
    expect(chatDelayOf(TWITCH_VIEWER_LATENCY + 12.5, false)).toBe(12.5)
  })

  it("nunca por delante de la imagen", () => {
    expect(chatDelayOf(1, true)).toBe(0)
  })

  it("sin la latencia, espera si la imagen está por llegar, y si no, va sin retraso", () => {
    expect(chatDelayOf(null, true)).toBeNull()
    expect(chatDelayOf(null, false)).toBe(0)
  })
})
