import { describe, expect, it } from "vitest"
import { levelFor } from "./useVodPlayer"

// Los niveles de un VOD de Twitch, como los da hls.js (sin el de solo audio, de alto 0).
const levels = [
  { bitrate: 9_000_000, frameRate: 60, height: 1080 },
  { bitrate: 3_400_000, frameRate: 60, height: 720 },
  { bitrate: 2_000_000, frameRate: 30, height: 720 },
  { bitrate: 1_400_000, frameRate: 30, height: 480 },
  { bitrate: 160_000, frameRate: 0, height: 0 },
]

describe("levelFor: la calidad del directo en un VOD", () => {
  it("la misma, si la tiene", () => {
    expect(levelFor(levels, "1280x720@30")).toBe(2)
    expect(levelFor(levels, "1280x720@60")).toBe(1)
  })

  it("si no, la de la misma altura y, si tampoco, la mejor que no pase de ella", () => {
    expect(levelFor(levels, "1920x1080@30")).toBe(0)
    expect(levelFor(levels, "640x360@30")).toBe(-1)
    expect(levelFor(levels, "1600x900@60")).toBe(1)
  })
})
