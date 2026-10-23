import { afterEach, describe, expect, it, vi } from "vitest"
import { openVariant, sessionKind, Vod, vodHour } from "./twitch-source"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("sessionKind", () => {
  it("separa el tipo de reproductor y la plataforma; sin plataforma, la web", () => {
    expect(sessionKind("site")).toEqual({ platform: "web", playerType: "site" })
    expect(sessionKind("mobile_feed@android")).toEqual({
      platform: "android",
      playerType: "mobile_feed",
    })
  })
})

// Una red falsa que contesta a gql con un token, a usher con una lista maestra y a su variante con la lista del VOD
// (`vod`); anota a dónde se pidió.
const fakeRed = (vod = "#EXTM3U\n") => {
  const hosts: string[] = []
  const red = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    hosts.push(url.hostname)
    if (url.hostname === "gql.twitch.tv") {
      const token = { signature: "s", value: JSON.stringify({ expires: 1 }) }
      return Response.json({
        data: {
          streamPlaybackAccessToken: token,
          user: { stream: { archiveVideo: { id: "9", recordedAt: "2026-10-16T10:00:00Z" } } },
          videoPlaybackAccessToken: token,
        },
      })
    }
    if (url.hostname === "v.example") return new Response(vod)
    return new Response(
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x1080,FRAME-RATE=60.000\nhttps://v.example/a.m3u8\n",
    )
  })
  return { hosts, red }
}

describe("red inyectada", () => {
  it("openVariant y el VOD piden token y listas por el fetch que se les da, no por el global", async () => {
    const global = vi.fn(async () => new Response(null, { status: 599 }))
    vi.stubGlobal("fetch", global)
    const { hosts, red } = fakeRed()
    const opened = await openVariant("canal", "site", "d", null, red)
    expect(opened.url).toBe("https://v.example/a.m3u8")
    await new Vod("canal", null, red).open()
    expect(hosts).toEqual([
      "gql.twitch.tv",
      "usher.ttvnw.net",
      "gql.twitch.tv",
      "gql.twitch.tv",
      "usher.ttvnw.net",
    ])
    expect(global).not.toHaveBeenCalled()
  })
})

describe("Vod", () => {
  it("si el VOD no tiene la calidad del directo, usa la más parecida (REP-4)", async () => {
    const pedidas: string[] = []
    const red = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      pedidas.push(url.pathname)
      if (url.hostname === "gql.twitch.tv") {
        const token = { signature: "s", value: JSON.stringify({ expires: 1 }) }
        return Response.json({
          data: {
            user: { stream: { archiveVideo: { id: "9", recordedAt: "2026-10-16T10:00:00Z" } } },
            videoPlaybackAccessToken: token,
          },
        })
      }
      if (url.hostname === "v.example") return new Response("#EXTM3U\n")
      return new Response(
        [
          "#EXTM3U",
          "#EXT-X-STREAM-INF:BANDWIDTH=3000,RESOLUTION=1280x720,FRAME-RATE=60.000",
          "https://v.example/720p60.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=1500,RESOLUTION=852x480,FRAME-RATE=30.000",
          "https://v.example/480p.m3u8",
        ].join("\n"),
      )
    })
    const vod = new Vod("canal", { fps: 60, resolution: "1920x1080" }, red)
    await vod.open()
    await vod.refresh()
    expect(pedidas.at(-1)).toBe("/720p60.m3u8")
  })

  const vodCon = async (lista: string[]) => {
    const vod = new Vod("canal", null, fakeRed(["#EXTM3U", ...lista].join("\n")).red)
    await vod.open()
    await vod.refresh()
    return vod
  }

  it("lee la hora de cada trozo y, al que no la trae, le da la del anterior más su duración", async () => {
    const vod = await vodCon([
      "#EXT-X-PROGRAM-DATE-TIME:2026-10-16T10:00:02.500Z",
      "#EXTINF:10.000,",
      "0.ts",
      "#EXTINF:10.000,",
      "1.ts",
      "#EXT-X-DISCONTINUITY",
      "#EXTINF:10.000,",
      "2.ts",
    ])
    const [primero, segundo, tercero] = vod.segments
    if (primero === undefined || segundo === undefined || tercero === undefined)
      throw new Error("sin trozos")
    expect(vodHour(vod, primero)).toBe(Date.parse("2026-10-16T10:00:02.500Z"))
    expect(vodHour(vod, segundo)).toBe(Date.parse("2026-10-16T10:00:12.500Z"))
    // Tras una discontinuidad no se sigue contando: cuándo empezó a grabarse (10:00:00) más su posición.
    expect(tercero.pdt).toBeNull()
    expect(vodHour(vod, tercero)).toBe(Date.parse("2026-10-16T10:00:20Z"))
  })

  it("sin hora en la lista, o con una que no se entiende, cuándo empezó a grabarse más su posición", async () => {
    const vod = await vodCon([
      "#EXTINF:10.000,",
      "0.ts",
      "#EXT-X-PROGRAM-DATE-TIME:no-es-una-fecha",
      "#EXTINF:10.000,",
      "1.ts",
    ])
    expect(vod.segments.map((s) => vodHour(vod, s))).toEqual([
      Date.parse("2026-10-16T10:00:00Z"),
      Date.parse("2026-10-16T10:00:10Z"),
    ])
  })
})
