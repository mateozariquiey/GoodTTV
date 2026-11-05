import { describe, expect, it, vi } from "vitest"
import { createConexiones, FRESH_MS } from "./conexiones"

const memory = (saved?: unknown) => {
  const values = new Map<string, string>()
  if (saved !== undefined) values.set("goodttv-hosts-listas", JSON.stringify(saved))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}
const fakeRed = () => vi.fn((_url: string, _init: RequestInit) => Promise.resolve())
const list = (host: string) => `https://${host}/v1/playlist/abc.m3u8?sig=x`
const A = "eus21.playlist.ttvnw.net"
const B = "eus22.playlist.ttvnw.net"
const C = "eus23.playlist.ttvnw.net"
const D = "eus24.playlist.ttvnw.net"

describe("createConexiones", () => {
  it("abre usher y los hosts de otras veces, con HEAD", () => {
    const red = fakeRed()
    createConexiones(red, memory([A, B])).abrir()
    expect(red.mock.calls.map(([url]) => url)).toEqual([
      "https://usher.ttvnw.net/",
      `https://${A}/`,
      `https://${B}/`,
    ])
    expect(red.mock.calls[0]?.[1]).toMatchObject({ method: "HEAD", redirect: "error" })
  })

  it("gql, solo si se pide: al abrir un canal ya sale su petición de verdad", () => {
    const red = fakeRed()
    createConexiones(red, memory()).abrir({ gql: true })
    expect(red.mock.calls.map(([url]) => url)).toEqual([
      "https://gql.twitch.tv/",
      "https://usher.ttvnw.net/",
    ])
  })

  it("no repite mientras la conexión sigue abierta, y sí cuando ya se habrá cerrado", () => {
    const red = fakeRed()
    let time = 1000
    const conexiones = createConexiones(red, memory(), () => time)
    conexiones.abrir()
    time += FRESH_MS - 1
    conexiones.abrir()
    expect(red).toHaveBeenCalledTimes(1)
    time += 1
    conexiones.abrir()
    expect(red).toHaveBeenCalledTimes(2)
  })

  it("recuerda los últimos hosts de listas, y no pide el que se acaba de usar", () => {
    const red = fakeRed()
    const store = memory()
    const conexiones = createConexiones(red, store)
    for (const host of [A, B, C, D, B]) conexiones.listaAbierta(list(host))
    expect(JSON.parse(store.getItem("goodttv-hosts-listas") ?? "")).toEqual([B, D, C])
    conexiones.abrir()
    expect(red.mock.calls.map(([url]) => url)).toEqual(["https://usher.ttvnw.net/"])
    red.mockClear()
    createConexiones(red, store).abrir()
    expect(red).toHaveBeenCalledTimes(4)
  })

  it("solo guarda y abre hosts de listas de Twitch", () => {
    const red = fakeRed()
    const store = memory(["https://malo.example/", "malo.example", 3, A])
    const conexiones = createConexiones(red, store)
    conexiones.listaAbierta("https://otro.example/lista.m3u8")
    conexiones.listaAbierta("no es una url")
    conexiones.abrir()
    expect(red.mock.calls.map(([url]) => url)).toEqual([
      "https://usher.ttvnw.net/",
      `https://${A}/`,
    ])
  })

  it("no le afectan una respuesta fallida ni un almacén roto", async () => {
    const red = vi.fn((_url: string, _init: RequestInit) => Promise.reject(new Error("sin red")))
    const broken = {
      getItem: () => "{no es json",
      setItem: () => {
        throw new Error("sin espacio")
      },
    }
    const conexiones = createConexiones(red, broken)
    conexiones.abrir()
    expect(() => conexiones.listaAbierta(list(A))).not.toThrow()
    await Promise.resolve()
  })
})
