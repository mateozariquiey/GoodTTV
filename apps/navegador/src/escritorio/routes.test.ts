import { describe, expect, it } from "vitest"
import { parseRoute, routeHash } from "./routes"

describe("parseRoute", () => {
  it("lee el canal, los ajustes o Inicio", () => {
    expect(parseRoute("#/canal/Papaplatte")).toEqual({ login: "papaplatte", view: "channel" })
    expect(parseRoute("#/ajustes")).toEqual({ view: "settings" })
    expect(parseRoute("")).toEqual({ view: "home" })
    expect(parseRoute("#/")).toEqual({ view: "home" })
    expect(parseRoute("#/vod/2904365699")).toEqual({ id: "2904365699", view: "vod" })
    expect(parseRoute("#/vod/2904365699?t=3600&directo=Ibai")).toEqual({
      at: 3600,
      id: "2904365699",
      live: "ibai",
      view: "vod",
    })
  })

  it("un canal que no puede existir lleva a Inicio", () => {
    expect(parseRoute("#/canal/")).toEqual({ view: "home" })
    expect(parseRoute("#/canal/no-vale")).toEqual({ view: "home" })
    expect(parseRoute("#/vod/abc")).toEqual({ view: "home" })
  })

  it("routeHash es la inversa", () => {
    for (const hash of [
      "#/canal/trymacs",
      "#/ajustes",
      "#/vod/2904365699",
      "#/vod/2904365699?t=3600&directo=ibai",
      "#/",
    ]) {
      expect(routeHash(parseRoute(hash))).toBe(hash)
    }
  })
})
