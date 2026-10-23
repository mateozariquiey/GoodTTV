import { describe, expect, it } from "vitest"
import { addWatchMinute, sortFollowed } from "./watch-time"

const memory = (): Storage => {
  const values = new Map<string, string>()
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

const DAY = 24 * 3_600_000
const channels = [
  { login: "poco", viewerCount: 100 },
  { login: "mucho", viewerCount: 50_000 },
  { login: "visto", viewerCount: 2_000 },
  { login: "reciente", viewerCount: 500 },
]

describe("sortFollowed", () => {
  it("por espectadores, como Twitch", () => {
    expect(sortFollowed(channels, "espectadores", [], memory()).map((each) => each.login)).toEqual([
      "mucho",
      "visto",
      "reciente",
      "poco",
    ])
  })

  it("recomendado: primero los que más ves, luego los abiertos hace poco, luego por espectadores", () => {
    const storage = memory()
    const now = 100 * DAY
    for (let minute = 0; minute < 30; minute++) addWatchMinute("visto", storage, now)
    addWatchMinute("poco", storage, now)
    expect(
      sortFollowed(channels, "recomendado", ["reciente"], storage, now).map((each) => each.login),
    ).toEqual(["visto", "poco", "reciente", "mucho"])
  })

  it("lo visto hace mucho pesa menos: la mitad cada 14 días", () => {
    const storage = memory()
    for (let minute = 0; minute < 10; minute++) addWatchMinute("visto", storage, 0)
    for (let minute = 0; minute < 3; minute++) addWatchMinute("poco", storage, 28 * DAY)
    // 10 minutos hace 4 semanas valen 2,5: menos que 3 de hoy.
    expect(
      sortFollowed(channels, "recomendado", [], storage, 28 * DAY).map((each) => each.login),
    ).toEqual(["poco", "visto", "mucho", "reciente"])
  })
})
