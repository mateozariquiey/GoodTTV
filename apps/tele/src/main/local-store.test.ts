import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RECENTS_LIMIT } from "@goodttv/contratos"
import { DEFAULT_PREFERENCES, LocalStore } from "@goodttv/servicios"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { localDataFile } from "./local-store"

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "local-store-"))
})
afterEach(async () => {
  await rm(directory, { force: true, recursive: true })
})

const recent = (login: string, watchedAt: number) => ({
  displayName: login.toUpperCase(),
  login,
  watchedAt,
})

describe("LocalStore", () => {
  it("starts empty with default preferences", async () => {
    const store = new LocalStore(localDataFile(directory))
    expect(await store.recents()).toEqual([])
    expect(await store.preferences()).toEqual(DEFAULT_PREFERENCES)
  })

  it("gives preferences added later their default without losing a file saved before", async () => {
    await writeFile(
      join(directory, "local-data.json"),
      JSON.stringify({
        preferences: { chatScale: "large", chatVisible: false },
        recents: [recent("ibai", 1)],
        version: 1,
      }),
    )
    const store = new LocalStore(localDataFile(directory))
    expect(await store.preferences()).toEqual({
      chatScale: "large",
      chatVisible: false,
      latencyMode: "adaptativo",
    })
    expect((await store.recents()).map((entry) => entry.login)).toEqual(["ibai"])
    expect(await store.updatePreferences({ latencyMode: "directo" })).toMatchObject({
      chatScale: "large",
      latencyMode: "directo",
    })
  })

  it("keeps the most recent channel first without duplicates", async () => {
    const store = new LocalStore(localDataFile(directory))
    await store.addRecent({ ...recent("ibai", 1), userId: "83232866" })
    await store.addRecent(recent("xqc", 2))
    const recents = await store.addRecent(recent("ibai", 3))
    expect(recents.map((entry) => entry.login)).toEqual(["ibai", "xqc"])
    // An entry without a user id keeps the one already known.
    expect(recents[0]).toMatchObject({ userId: "83232866", watchedAt: 3 })
  })

  it("normalizes logins and caps the list", async () => {
    const store = new LocalStore(localDataFile(directory))
    for (let index = 0; index < RECENTS_LIMIT + 5; index += 1) {
      await store.addRecent(recent(`Channel_${index}`, index))
    }
    const recents = await store.recents()
    expect(recents).toHaveLength(RECENTS_LIMIT)
    expect(recents[0]?.login).toBe(`channel_${RECENTS_LIMIT + 4}`)
  })

  it("rejects invalid channels", async () => {
    const store = new LocalStore(localDataFile(directory))
    await expect(store.addRecent(recent("../etc", 1))).rejects.toThrow()
  })

  it("persists preferences with owner-only permissions", async () => {
    await new LocalStore(localDataFile(directory)).updatePreferences({ chatVisible: false })
    const reopened = new LocalStore(localDataFile(directory))
    expect(await reopened.preferences()).toEqual({ ...DEFAULT_PREFERENCES, chatVisible: false })
    const info = await stat(join(directory, "local-data.json"))
    expect(info.mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(join(directory, "local-data.json"), "utf8")).version).toBe(1)
  })

  it("recovers from an incompatible file", async () => {
    await writeFile(join(directory, "local-data.json"), JSON.stringify({ version: 9 }))
    expect(await new LocalStore(localDataFile(directory)).recents()).toEqual([])
  })

  it("recovers from a truncated file and can save again", async () => {
    await writeFile(join(directory, "local-data.json"), '{"preferences":{"chatSc')
    const store = new LocalStore(localDataFile(directory))
    expect(await store.preferences()).toEqual(DEFAULT_PREFERENCES)
    await store.addRecent(recent("ibai", 1))
    expect(
      (await new LocalStore(localDataFile(directory)).recents()).map((entry) => entry.login),
    ).toEqual(["ibai"])
  })

  it("serializes concurrent writes", async () => {
    const store = new LocalStore(localDataFile(directory))
    await Promise.all([
      store.addRecent(recent("a", 1)),
      store.addRecent(recent("b", 2)),
      store.updatePreferences({ chatScale: "large" }),
    ])
    expect((await store.recents()).map((entry) => entry.login)).toEqual(["b", "a"])
    expect((await store.preferences()).chatScale).toBe("large")
  })
})
