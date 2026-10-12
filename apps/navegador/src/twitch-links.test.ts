import { describe, expect, it } from "vitest"
import { channelFromTwitchUrl } from "./twitch-links"

describe("channelFromTwitchUrl", () => {
  it("saca el canal de sus páginas", () => {
    expect(channelFromTwitchUrl("https://www.twitch.tv/Papaplatte")).toBe("papaplatte")
    expect(channelFromTwitchUrl("https://www.twitch.tv/trymacs/videos?filter=all")).toBe("trymacs")
    expect(channelFromTwitchUrl("https://m.twitch.tv/ibai")).toBe("ibai")
  })

  it("nada para otras páginas de Twitch u otras webs", () => {
    expect(
      channelFromTwitchUrl("https://www.twitch.tv/directory/category/minecraft"),
    ).toBeUndefined()
    expect(channelFromTwitchUrl("https://www.twitch.tv/")).toBeUndefined()
    expect(channelFromTwitchUrl("https://www.twitch.tv/settings/profile")).toBeUndefined()
    expect(channelFromTwitchUrl("https://example.com/papaplatte")).toBeUndefined()
    expect(channelFromTwitchUrl("no es una dirección")).toBeUndefined()
    expect(channelFromTwitchUrl(undefined)).toBeUndefined()
  })
})
