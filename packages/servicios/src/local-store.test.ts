import { describe, expect, it } from "vitest"
import { LocalStore, type TextStorage } from "./local-store"

// Un almacén compartido por dos páginas (pestañas de la extensión), con lecturas y escrituras que tardan.
const sharedText = (exclusive: boolean): TextStorage => {
  let text: string | undefined
  let tail: Promise<unknown> = Promise.resolve()
  const later = (): Promise<void> => new Promise((done) => setTimeout(done, 1))
  return {
    read: async () => {
      await later()
      return text
    },
    write: async (next) => {
      await later()
      text = next
    },
    ...(exclusive
      ? {
          exclusive: <Result>(operation: () => Promise<Result>): Promise<Result> => {
            const result = tail.then(operation, operation)
            tail = result.catch(() => undefined)
            return result
          },
        }
      : {}),
  }
}

const recent = (login: string) => ({ displayName: login, login, watchedAt: 1 })

describe("LocalStore en varias pestañas", () => {
  it("con el almacén exclusivo, no pierde un reciente añadido a la vez desde otra", async () => {
    const storage = sharedText(true)
    const [a, b] = [new LocalStore(storage), new LocalStore(storage)]
    await Promise.all([a.addRecent(recent("uno")), b.addRecent(recent("dos"))])
    expect((await a.recents()).map((each) => each.login).sort()).toEqual(["dos", "uno"])
  })

  it("sin él, una de las dos escrituras pisa a la otra (lo que se evita)", async () => {
    const storage = sharedText(false)
    const [a, b] = [new LocalStore(storage), new LocalStore(storage)]
    await Promise.all([a.addRecent(recent("uno")), b.addRecent(recent("dos"))])
    expect(await a.recents()).toHaveLength(1)
  })
})
