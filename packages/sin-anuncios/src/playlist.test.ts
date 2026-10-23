import { describe, expect, it } from "vitest"
import { pickVariant } from "./playlist"

// Una lista maestra como las de Twitch: cada variante con su grupo de vídeo y su nombre.
const master = (...variants: readonly (readonly [string, number, number])[]): string =>
  [
    "#EXTM3U",
    ...variants.flatMap(([resolution, fps, bandwidth]) => {
      const name = `${resolution.split("x")[1]}p${fps === 30 ? "" : fps}`
      return [
        `#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="${name}",NAME="${name}"`,
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},VIDEO="${name}",FRAME-RATE=${fps}.000`,
        `https://v.example/${name}.m3u8`,
      ]
    }),
  ].join("\n")

const at30 = master(["1920x1080", 30, 6000], ["1280x720", 30, 3000], ["852x480", 30, 1500])

describe("pickVariant", () => {
  it("sin calidad pedida, la de más ancho de banda", () => {
    expect(pickVariant(at30, null)?.name).toBe("1080p")
  })

  it("la pedida, si el canal la tiene", () => {
    expect(pickVariant(at30, { fps: 30, resolution: "1280x720" })?.name).toBe("720p")
  })

  it("si no la tiene, la misma resolución con otros fotogramas por segundo", () => {
    expect(pickVariant(at30, { fps: 60, resolution: "1280x720" })?.name).toBe("720p")
  })

  it("si tampoco, la mejor que no pase de esa resolución", () => {
    expect(pickVariant(at30, { fps: 60, resolution: "1664x936" })?.name).toBe("720p")
  })

  it("y si todas pasan de ella, la de más ancho de banda", () => {
    expect(pickVariant(at30, { fps: 30, resolution: "284x160" })?.name).toBe("1080p")
  })
})
