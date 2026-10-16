import type { SavedHome, StreamCard } from "@goodttv/contratos"
import { describe, expect, it } from "vitest"
import { forgetHome, readSavedHome, saveHome } from "./home-cache"

// localStorage en memoria.
const memoryStorage = () => {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    items,
    removeItem: (key: string) => {
      items.delete(key)
    },
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

const ACCOUNT = {
  displayName: "Mateo",
  kind: "authenticated" as const,
  login: "mateo",
  profileImageUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/mateo-300x300.png",
}

const stream = (login: string): StreamCard => ({
  category: "Just Chatting",
  id: `s-${login}`,
  startedAt: "2026-10-15T14:00:00Z",
  tags: [],
  thumbnailUrl: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-{width}x{height}.jpg`,
  title: `Directo de ${login}`,
  userId: "123",
  userLogin: login,
  userName: login,
  viewerCount: 1000,
})

const SAVED: SavedHome = {
  account: ACCOUNT,
  following: [stream("ibai")],
  popular: [stream("caedrel")],
  recentLive: [stream("ibai")],
  recents: [{ displayName: "ibai", login: "ibai", watchedAt: 1 }],
  savedAt: 1_760_000_000_000,
}

describe("Inicio guardado", () => {
  it("devuelve lo guardado, con la cuenta y los directos de «Seguir viendo»", () => {
    const storage = memoryStorage()
    expect(readSavedHome(storage)).toBeNull()
    saveHome(storage, SAVED)
    expect(readSavedHome(storage)).toEqual(SAVED)
  })

  it("lee lo que guardaba la versión anterior (el mismo formato)", () => {
    const storage = memoryStorage()
    storage.setItem("inicio", JSON.stringify({ ...SAVED, version: 1 }))
    expect(readSavedHome(storage)).toEqual(SAVED)
  })

  it("no guarda tokens: solo lo que se ve", () => {
    const storage = memoryStorage()
    saveHome(storage, SAVED)
    expect([...storage.items.values()].join()).not.toMatch(/token/i)
  })

  it("ignora otra versión, lo que no cuadra y lo que no es JSON", () => {
    const storage = memoryStorage()
    saveHome(storage, SAVED)
    const text = storage.items.get("inicio") ?? ""
    storage.items.set("inicio", text.replace('"version":1', '"version":2'))
    expect(readSavedHome(storage)).toBeNull()
    storage.items.set("inicio", text.replace('"viewerCount":1000', '"viewerCount":"mil"'))
    expect(readSavedHome(storage)).toBeNull()
    storage.items.set("inicio", text.replace('"kind":"authenticated"', '"kind":"guest"'))
    expect(readSavedHome(storage)).toBeNull()
    storage.items.set("inicio", "{")
    expect(readSavedHome(storage)).toBeNull()
  })

  it("se olvida al cerrar sesión", () => {
    const storage = memoryStorage()
    saveHome(storage, SAVED)
    forgetHome(storage)
    expect(readSavedHome(storage)).toBeNull()
  })

  it("si el navegador no deja usar localStorage, sigue sin él", () => {
    const failing = {
      getItem: () => {
        throw new DOMException("bloqueado", "SecurityError")
      },
      removeItem: () => {
        throw new DOMException("bloqueado", "SecurityError")
      },
      setItem: () => {
        throw new DOMException("lleno", "QuotaExceededError")
      },
    }
    expect(readSavedHome(undefined)).toBeNull()
    expect(() => saveHome(undefined, SAVED)).not.toThrow()
    expect(readSavedHome(failing)).toBeNull()
    expect(() => saveHome(failing, SAVED)).not.toThrow()
    expect(() => forgetHome(failing)).not.toThrow()
  })
})
