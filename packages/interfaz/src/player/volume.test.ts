import { beforeEach, describe, expect, it, vi } from "vitest"

const memory = (): Storage => {
  const items = new Map<string, string>()
  return {
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: () => null,
    get length() {
      return items.size
    },
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    },
  }
}

// Cada prueba, una pestaña recién abierta: el módulo, sin lo elegido en ella.
const tab = async () => {
  vi.resetModules()
  return await import("./volume")
}

describe("volumen elegido", () => {
  let storage: Storage
  beforeEach(() => {
    storage = memory()
  })

  it("sin nada guardado, al máximo y con sonido", async () => {
    const { chosenVolume } = await tab()
    expect(chosenVolume(storage)).toEqual({ muted: false, volume: 1 })
  })

  it("una pestaña nueva empieza con lo último que se eligió", async () => {
    const first = await tab()
    first.chooseVolume({ muted: true, volume: 0.3 }, storage)
    const second = await tab()
    expect(second.chosenVolume(storage)).toEqual({ muted: true, volume: 0.3 })
  })

  it("una pestaña abierta sigue con lo suyo aunque otra elija otro", async () => {
    const { chooseVolume, chosenVolume } = await tab()
    chooseVolume({ muted: false, volume: 0.3 }, storage)
    storage.setItem("volumen", JSON.stringify({ muted: false, volume: 0.8 })) // otra pestaña
    expect(chosenVolume(storage)).toEqual({ muted: false, volume: 0.3 })
  })

  it("lo que no se entiende no cuenta", async () => {
    for (const saved of ["{", "[]", '{"muted":false,"volume":2}', '{"muted":"no","volume":0.5}']) {
      storage.setItem("volumen", saved)
      const { chosenVolume } = await tab()
      expect(chosenVolume(storage)).toEqual({ muted: false, volume: 1 })
    }
  })
})
