import { describe, expect, it } from "vitest"
import { sessionKind } from "./twitch-source"

describe("sessionKind", () => {
  it("separa el tipo de reproductor y la plataforma; sin plataforma, la web", () => {
    expect(sessionKind("site")).toEqual({ platform: "web", playerType: "site" })
    expect(sessionKind("mobile_feed@android")).toEqual({
      platform: "android",
      playerType: "mobile_feed",
    })
  })
})
