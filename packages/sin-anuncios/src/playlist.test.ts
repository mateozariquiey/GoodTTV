import { describe, expect, it } from "vitest"
import { AUDIO_ONLY_WANT, listVariants, pickVariant } from "./playlist"

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

describe("solo audio", () => {
  const withAudio = [
    at30,
    '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="audio_only",NAME="audio_only",AUTOSELECT=NO,DEFAULT=NO',
    '#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",VIDEO="audio_only"',
    "https://v.example/audio_only.m3u8",
  ].join("\n")

  it("la de solo audio, que no sale entre las de vídeo", () => {
    expect(pickVariant(withAudio, AUDIO_ONLY_WANT)).toMatchObject({
      fps: 0,
      resolution: "audio_only",
      url: "https://v.example/audio_only.m3u8",
    })
    expect(listVariants(withAudio).map((variant) => variant.name)).toEqual([
      "1080p",
      "720p",
      "480p",
    ])
  })

  it("si el canal no la da, el vídeo que menos gasta", () => {
    expect(pickVariant(at30, AUDIO_ONLY_WANT)?.name).toBe("480p")
  })
})
