import { describe, expect, it } from "vitest"
import { storageText, storageTokens } from "./storage"

// chrome.storage.local en memoria.
const memoryArea = () => {
  const items = new Map<string, unknown>()
  return {
    get: async (key: string) => (items.has(key) ? { [key]: items.get(key) } : {}),
    items,
    remove: async (key: string) => {
      items.delete(key)
    },
    set: async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) items.set(key, value)
    },
  }
}

const TOKEN = { accessToken: "a", expiresAt: "2026-10-12T00:00:00.000Z", refreshToken: "r" }

describe("storageText", () => {
  it("lee lo guardado, y nada si no hay o no es texto", async () => {
    const area = memoryArea()
    const text = storageText(area as never, "local-data")
    expect(await text.read()).toBeUndefined()
    await text.write("{}\n")
    expect(await text.read()).toBe("{}\n")
    area.items.set("local-data", 42)
    expect(await text.read()).toBeUndefined()
  })
})

describe("storageTokens", () => {
  it("guarda, lee y borra la sesión, sin cifrar", async () => {
    const area = memoryArea()
    const tokens = storageTokens(area as never, "twitch-token")
    expect(tokens.isSecure).toBe(false)
    expect(await tokens.load()).toBeUndefined()
    await tokens.save(TOKEN)
    expect(await tokens.load()).toEqual(TOKEN)
    await tokens.clear()
    expect(await tokens.load()).toBeUndefined()
  })

  it("no guarda una sesión incompleta", async () => {
    const tokens = storageTokens(memoryArea() as never, "twitch-token")
    await expect(tokens.save({ ...TOKEN, accessToken: "" })).rejects.toThrow()
  })
})
