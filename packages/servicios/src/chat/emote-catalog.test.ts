import { describe, expect, it, vi } from "vitest"
import { EmoteCatalog } from "./emote-catalog"

const sevenTv = (name: string, id: string, flags = 0, dataFlags = 0) => ({
  data: {
    flags: dataFlags,
    host: {
      files: [{ format: "WEBP", height: 32, name: "1x.webp", width: 64 }],
      url: `//cdn.7tv.app/emote/${id}`,
    },
  },
  flags,
  name,
})

const responses: Record<string, unknown> = {
  "https://7tv.io/v3/emote-sets/global": {
    emotes: [sevenTv("EZ", "g1"), sevenTv("RainTime", "g2", 1), sevenTv("Shared", "g3")],
  },
  "https://api.betterttv.net/3/cached/emotes/global": [
    { code: "catJAM", id: "5f1b0186cf6d2144653d2970", modifier: false },
    { code: "h!", id: "5f1b0186cf6d2144653d2971", modifier: true },
    { code: "TopHat", id: "5f1b0186cf6d2144653d2972" },
  ],
  "https://api.frankerfacez.com/v1/set/global": {
    default_sets: [3],
    sets: {
      "3": {
        emoticons: [
          {
            height: 28,
            name: "ZreknarF",
            urls: {
              "1": "https://cdn.frankerfacez.com/emote/1/1",
              "2": "https://cdn.frankerfacez.com/emote/1/2",
            },
            width: 40,
          },
        ],
      },
      "99": { emoticons: [{ height: 1, name: "NotDefault", urls: {}, width: 1 }] },
    },
  },
  "https://7tv.io/v3/users/twitch/123": {
    emote_set: {
      emotes: [sevenTv("Shared", "c1"), sevenTv("PETPET", "c2", 0, 256), { bad: true }],
    },
  },
  "https://api.betterttv.net/3/cached/users/twitch/123": {
    channelEmotes: [{ code: "OnlyBttv", id: "5f1b0186cf6d2144653d2973" }],
    sharedEmotes: [],
  },
}

const fetchJson = vi.fn(async (url: string) => {
  if (!(url in responses)) throw new Error("404")
  return responses[url]
})

describe("EmoteCatalog", () => {
  it("merges providers, prefers channel emotes, and skips modifiers", async () => {
    const lookup = await new EmoteCatalog({ fetchJson }).forChannel("123")
    expect(lookup.get("Shared")?.url).toBe("https://cdn.7tv.app/emote/c1/2x.webp")
    expect(lookup.get("EZ")).toMatchObject({
      height: 32,
      provider: "7tv",
      width: 64,
      zeroWidth: false,
    })
    expect(lookup.get("catJAM")?.url).toBe(
      "https://cdn.betterttv.net/emote/5f1b0186cf6d2144653d2970/2x.webp",
    )
    expect(lookup.has("h!")).toBe(false)
    expect(lookup.get("ZreknarF")?.url).toBe("https://cdn.frankerfacez.com/emote/1/2")
    expect(lookup.has("NotDefault")).toBe(false)
    expect(lookup.get("OnlyBttv")?.provider).toBe("bttv")
  })

  it("reads zero-width flags from 7TV sets, 7TV emotes and BTTV's known list", async () => {
    const lookup = await new EmoteCatalog({ fetchJson }).forChannel("123")
    expect(lookup.get("RainTime")?.zeroWidth).toBe(true)
    expect(lookup.get("PETPET")?.zeroWidth).toBe(true)
    expect(lookup.get("TopHat")?.zeroWidth).toBe(true)
  })

  it("keeps working when a provider fails", async () => {
    // The FFZ room for 123 is missing (404) and must not hide the other providers.
    const lookup = await new EmoteCatalog({ fetchJson }).forChannel("123")
    expect(lookup.size).toBeGreaterThan(0)
  })

  it("caches globals and channels", async () => {
    fetchJson.mockClear()
    const catalog = new EmoteCatalog({ fetchJson, now: () => 1_000 })
    await catalog.forChannel("123")
    await catalog.forChannel("123")
    expect(fetchJson).toHaveBeenCalledTimes(6)
  })

  it("ignores ids that are not Twitch user ids", async () => {
    fetchJson.mockClear()
    await new EmoteCatalog({ fetchJson }).forChannel("../123")
    expect(fetchJson.mock.calls.map(([url]) => url)).not.toContain(
      "https://7tv.io/v3/users/twitch/../123",
    )
  })
})
