import { describe, expect, it, vi } from "vitest"
import * as canales from "./canales"
import { guestChannels, guestVods } from "./invitado"
import * as vods from "./vods"

vi.mock("./canales", () => ({
  categoryStreams: vi.fn(async () => null),
  channelByLogin: vi.fn(async () => null),
  popularStreams: vi.fn(async () => []),
  searchChannels: vi.fn(async () => []),
  topCategories: vi.fn(async () => []),
}))
vi.mock("./vods", () => ({
  commentsFrom: vi.fn(async () => []),
  liveArchive: vi.fn(async () => null),
  storyboardOf: vi.fn(async () => null),
  videoById: vi.fn(async () => null),
  videosOf: vi.fn(async () => null),
  vodMasterUrl: vi.fn(async () => "https://usher/1.m3u8"),
}))

// Lo que importa es cómo se pasa lo que piden los servicios (ChannelSource, VodSource) a cada función: con sus
// opciones por defecto y sin argumentos de más, que se tomarían por la red (red) de cada una.
describe("guestChannels", () => {
  it("pasa a cada función lo suyo, con la forma que esperan", async () => {
    await guestChannels.byLogin("ibai")
    await guestChannels.categories()
    await guestChannels.category("just-chatting")
    await guestChannels.popular("es")
    await guestChannels.search("ibai", 20)
    expect(vi.mocked(canales.channelByLogin).mock.calls).toEqual([["ibai"]])
    expect(vi.mocked(canales.topCategories).mock.calls).toEqual([[]])
    expect(vi.mocked(canales.categoryStreams).mock.calls).toEqual([["just-chatting"]])
    expect(vi.mocked(canales.popularStreams).mock.calls).toEqual([[{ language: "es" }]])
    expect(vi.mocked(canales.searchChannels).mock.calls).toEqual([["ibai", { first: 20 }]])
  })
})

describe("guestVods", () => {
  it("pasa a cada función lo suyo, con la forma que esperan", async () => {
    await guestVods.archive("ibai")
    await guestVods.comments("1", 30)
    await guestVods.get("1")
    await guestVods.list("ibai")
    expect(await guestVods.playback("1")).toBe("https://usher/1.m3u8")
    await guestVods.storyboard("https://s/1.json")
    expect(vi.mocked(vods.liveArchive).mock.calls).toEqual([["ibai"]])
    expect(vi.mocked(vods.commentsFrom).mock.calls).toEqual([["1", 30]])
    expect(vi.mocked(vods.videoById).mock.calls).toEqual([["1"]])
    expect(vi.mocked(vods.videosOf).mock.calls).toEqual([["ibai"]])
    expect(vi.mocked(vods.vodMasterUrl).mock.calls).toEqual([["1"]])
    expect(vi.mocked(vods.storyboardOf).mock.calls).toEqual([["https://s/1.json"]])
  })
})
