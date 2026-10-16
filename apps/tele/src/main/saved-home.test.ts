import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SavedHome, StreamCard } from "@goodttv/contratos"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SAVED_HOME_MAX_CHARS, savedHomeStore } from "./saved-home"

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "saved-home-"))
})
afterEach(async () => {
  await rm(directory, { force: true, recursive: true })
})

const stream = (login: string): StreamCard => ({
  category: "Just Chatting",
  id: `s-${login}`,
  startedAt: "2026-10-16T14:00:00Z",
  tags: [],
  thumbnailUrl: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-{width}x{height}.jpg`,
  title: `Directo de ${login}`,
  userId: "123",
  userLogin: login,
  userName: login,
  viewerCount: 1000,
})

const SAVED: SavedHome = {
  account: { displayName: "Mateo", kind: "authenticated", login: "mateo" },
  following: [stream("illojuan")],
  popular: [stream("caedrel")],
  recentLive: [stream("illojuan")],
  recents: [{ displayName: "illojuan", login: "illojuan", watchedAt: 1 }],
  savedAt: 1_760_000_000_000,
}

describe("Inicio guardado en la tele", () => {
  it("sin nada guardado, null; después, lo guardado, también tras volver a abrir", async () => {
    expect(await savedHomeStore(directory).saved()).toBeNull()
    await savedHomeStore(directory).save(SAVED)
    expect(await savedHomeStore(directory).saved()).toEqual(SAVED)
  })

  it("solo lo puede leer el usuario", async () => {
    await savedHomeStore(directory).save(SAVED)
    const mode = (await stat(join(directory, "saved-home.json"))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it("se olvida, aunque no hubiera nada", async () => {
    const store = savedHomeStore(directory)
    await store.forget()
    await store.save(SAVED)
    await store.forget()
    expect(await store.saved()).toBeNull()
  })

  it("un «olvidar» justo después de «guardar» gana", async () => {
    const store = savedHomeStore(directory)
    void store.save(SAVED)
    await store.forget()
    expect(await store.saved()).toBeNull()
  })

  it("un archivo roto o de otra forma cuenta como nada guardado", async () => {
    const store = savedHomeStore(directory)
    await writeFile(join(directory, "saved-home.json"), "{")
    expect(await store.saved()).toBeNull()
    await writeFile(
      join(directory, "saved-home.json"),
      JSON.stringify({ ...SAVED, account: { kind: "guest" } }),
    )
    expect(await store.saved()).toBeNull()
  })

  it("no guarda algo desmesurado", async () => {
    const store = savedHomeStore(directory)
    const huge = { ...stream("x"), title: "a".repeat(SAVED_HOME_MAX_CHARS) }
    await expect(store.save({ ...SAVED, following: [huge] })).rejects.toThrow(RangeError)
    expect(await store.saved()).toBeNull()
  })

  it("no guarda lo que no cuadra", async () => {
    const store = savedHomeStore(directory)
    await expect(
      store.save({ ...SAVED, following: [{ ...stream("x"), viewerCount: -1 }] }),
    ).rejects.toThrow()
    await expect(readFile(join(directory, "saved-home.json"), "utf8")).rejects.toThrow()
  })
})
