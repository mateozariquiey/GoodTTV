import { describe, expect, it } from "vitest"
import { parseRoute, routeHash } from "./routes"

// Las direcciones comunes con Android (el canal, el VOD, las categorías) se prueban en @goodttv/interfaz (routes.test.ts).
describe("parseRoute", () => {
  it("lee la cuadrícula: hasta 4 canales válidos y sin repetir", () => {
    expect(parseRoute("#/cuadricula/Ibai,xqc,ibai,no valido,a,b,c")).toEqual({
      logins: ["ibai", "xqc", "a", "b"],
      view: "grid",
    })
    expect(parseRoute("#/cuadricula/")).toEqual({ logins: [], view: "grid" })
    expect(routeHash({ logins: ["ibai", "xqc"], view: "grid" })).toBe("#/cuadricula/ibai,xqc")
  })
  it("lee el canal, los ajustes o Inicio", () => {
    expect(parseRoute("#/canal/Papaplatte")).toEqual({ login: "papaplatte", view: "channel" })
    expect(parseRoute("#/ajustes")).toEqual({ view: "settings" })
    expect(parseRoute("")).toEqual({ view: "home" })
    expect(parseRoute("#/vod/2904365699?t=3600&directo=Ibai")).toEqual({
      at: 3600,
      id: "2904365699",
      live: "ibai",
      view: "vod",
    })
  })

  it("routeHash es la inversa", () => {
    for (const hash of [
      "#/canal/trymacs",
      "#/ajustes",
      "#/cuadricula/ibai,xqc",
      "#/vod/2904365699?t=3600&directo=ibai",
      "#/categorias",
      "#/",
    ]) {
      expect(routeHash(parseRoute(hash))).toBe(hash)
    }
  })
})
