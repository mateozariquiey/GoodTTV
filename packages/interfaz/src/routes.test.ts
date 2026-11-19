import { describe, expect, it } from "vitest"
import { commonRouteHash, parseCommonRoute, routeParts } from "./routes"

describe("parseCommonRoute", () => {
  it("lee el canal, el VOD, las categorías o Inicio", () => {
    expect(parseCommonRoute("#/canal/Papaplatte")).toEqual({ login: "papaplatte", view: "channel" })
    expect(parseCommonRoute("")).toEqual({ view: "home" })
    expect(parseCommonRoute("#/")).toEqual({ view: "home" })
    expect(parseCommonRoute("#/vod/2904365699")).toEqual({ id: "2904365699", view: "vod" })
    expect(parseCommonRoute("#/vod/2904365699?t=3600&directo=Ibai")).toEqual({
      at: 3600,
      id: "2904365699",
      live: "ibai",
      view: "vod",
    })
    expect(parseCommonRoute("#/categorias")).toEqual({ view: "categories" })
    expect(parseCommonRoute("#/categoria/Just-Chatting")).toEqual({
      slug: "just-chatting",
      view: "category",
    })
  })

  it("lo que no puede existir lleva a Inicio, y en un VOD se ignora lo que no vale", () => {
    expect(parseCommonRoute("#/canal/")).toEqual({ view: "home" })
    expect(parseCommonRoute("#/canal/no-vale")).toEqual({ view: "home" })
    expect(parseCommonRoute("#/vod/abc")).toEqual({ view: "home" })
    expect(parseCommonRoute("#/categoria/con espacio")).toEqual({ view: "home" })
    expect(parseCommonRoute("#/ajustes")).toEqual({ view: "home" }) // las de cada app las lee cada app
    expect(parseCommonRoute("#/vod/1?t=-5&directo=no vale")).toEqual({ id: "1", view: "vod" })
  })

  it("commonRouteHash es la inversa", () => {
    for (const hash of [
      "#/canal/trymacs",
      "#/vod/2904365699",
      "#/vod/2904365699?t=3600&directo=ibai",
      "#/categorias",
      "#/categoria/just-chatting",
      "#/",
    ]) {
      expect(commonRouteHash(parseCommonRoute(hash))).toBe(hash)
    }
    expect(commonRouteHash({ at: 61.8, id: "1", view: "vod" })).toBe("#/vod/1?t=61")
  })
})

describe("routeParts", () => {
  it("separa la vista, lo que sigue y la consulta", () => {
    expect(routeParts("#/cuadricula/ibai,xqc")).toEqual({
      query: "",
      segment: "ibai,xqc",
      view: "cuadricula",
    })
    expect(routeParts("#/vod/1?t=5")).toEqual({ query: "t=5", segment: "1", view: "vod" })
    expect(routeParts("")).toEqual({ query: "", segment: "", view: "" })
  })
})
