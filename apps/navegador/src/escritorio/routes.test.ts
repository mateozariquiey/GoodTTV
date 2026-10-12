import { describe, expect, it } from "vitest"
import { parseRoute, routeHash } from "./routes"

describe("parseRoute", () => {
  it("lee el canal, los ajustes o Inicio", () => {
    expect(parseRoute("#/canal/Papaplatte")).toEqual({ login: "papaplatte", view: "channel" })
    expect(parseRoute("#/ajustes")).toEqual({ view: "settings" })
    expect(parseRoute("")).toEqual({ view: "home" })
    expect(parseRoute("#/")).toEqual({ view: "home" })
  })

  it("un canal que no puede existir lleva a Inicio", () => {
    expect(parseRoute("#/canal/")).toEqual({ view: "home" })
    expect(parseRoute("#/canal/no-vale")).toEqual({ view: "home" })
  })

  it("routeHash es la inversa", () => {
    for (const hash of ["#/canal/trymacs", "#/ajustes", "#/"]) {
      expect(routeHash(parseRoute(hash))).toBe(hash)
    }
  })
})
