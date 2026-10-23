import { describe, expect, it } from "vitest"
import { ProfilePictures } from "./profile-pictures"

const memory = () => {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    items,
    removeItem: (key: string) => void items.delete(key),
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

const DAY = 24 * 3_600_000

describe("las fotos de los canales (profile-pictures.ts)", () => {
  it("las guardadas por una página las tiene la siguiente", () => {
    const storage = memory()
    new ProfilePictures(storage).add(new Map([["1", "https://example.com/1.png"]]), 0)
    expect(new ProfilePictures(storage).known(["1", "2"], DAY)).toEqual(
      new Map([["1", "https://example.com/1.png"]]),
    )
  })

  it("valen una semana", () => {
    const pictures = new ProfilePictures(memory())
    pictures.add(new Map([["1", "https://example.com/1.png"]]), 0)
    expect(pictures.known(["1"], 7 * DAY - 1).size).toBe(1)
    expect(pictures.known(["1"], 7 * DAY).size).toBe(0)
  })

  it("al guardar, no pierde lo que otra pestaña guardó mientras tanto", () => {
    const storage = memory()
    const one = new ProfilePictures(storage)
    const other = new ProfilePictures(storage)
    one.known(["x"], 0) // ya leído
    other.add(new Map([["2", "https://example.com/2.png"]]), 0)
    one.add(new Map([["1", "https://example.com/1.png"]]), 0)
    expect(new ProfilePictures(storage).known(["1", "2"], 0).size).toBe(2)
  })

  it("se queda con las 500 más recientes", () => {
    const pictures = new ProfilePictures(memory())
    for (let i = 0; i < 510; i++)
      pictures.add(new Map([[String(i), `https://example.com/${i}.png`]]), i)
    const known = pictures.known(
      Array.from({ length: 510 }, (_, i) => String(i)),
      600,
    )
    expect(known.size).toBe(500)
    expect(known.has("9")).toBe(false)
    expect(known.has("10")).toBe(true)
  })

  it("algo roto, otra versión o sin localStorage: como si no hubiera nada", () => {
    const storage = memory()
    storage.setItem("fotos", "{roto")
    expect(new ProfilePictures(storage).known(["1"]).size).toBe(0)
    storage.setItem("fotos", JSON.stringify({ fotos: {}, version: 2 }))
    expect(new ProfilePictures(storage).known(["1"]).size).toBe(0)
    const none = new ProfilePictures()
    none.add(new Map([["1", "https://example.com/1.png"]]))
    expect(none.known(["1"]).size).toBe(1)
  })

  it("sin almacén (la tele), en memoria: conserva todas, no solo las últimas", () => {
    const pictures = new ProfilePictures()
    pictures.add(new Map([["1", "https://example.com/1.png"]]), 0)
    pictures.add(new Map([["2", "https://example.com/2.png"]]), 0)
    expect(pictures.known(["1", "2"], 0).size).toBe(2)
  })

  it("si no se puede guardar, siguen en memoria", () => {
    const storage = {
      ...memory(),
      setItem: () => {
        throw new Error("sin sitio")
      },
    }
    const pictures = new ProfilePictures(storage)
    pictures.add(new Map([["1", "https://example.com/1.png"]]), 0)
    pictures.add(new Map([["2", "https://example.com/2.png"]]), 0)
    expect(pictures.known(["1", "2"], 0).size).toBe(2)
  })

  it("se olvidan al cerrar sesión", () => {
    const storage = memory()
    const pictures = new ProfilePictures(storage)
    pictures.add(new Map([["1", "https://example.com/1.png"]]))
    pictures.clear()
    expect(pictures.known(["1"]).size).toBe(0)
    expect(storage.items.has("fotos")).toBe(false)
  })
})
