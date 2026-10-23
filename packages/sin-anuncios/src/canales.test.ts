import { describe, expect, it, vi } from "vitest"
import { channelByLogin, searchChannels } from "./canales"

const fakeRed = (gql: unknown) => {
  const bodies: unknown[] = []
  const red = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json(gql)
  })
  return { bodies, red }
}

const illojuan = {
  broadcastSettings: { game: { displayName: "Just Chatting" }, title: "Devotion" },
  displayName: "IlloJuan",
  followers: { totalCount: 4684962 },
  id: "90075649",
  login: "illojuan",
  profileImageURL: "https://static-cdn.jtvnw.net/illojuan-150x150.png",
  stream: null,
}
const cine = {
  ...illojuan,
  displayName: "CineIlloJuan",
  followers: { totalCount: 239944 },
  id: "123",
  login: "cineillojuan",
  stream: { game: { displayName: "Watch Party" }, viewersCount: 1378 },
}

describe("searchChannels", () => {
  it("en el orden de Twitch, con la foto, los seguidores y el directo; sin los que no son válidos", async () => {
    const { bodies, red } = fakeRed({
      data: {
        searchFor: {
          channels: {
            edges: [{ item: illojuan }, { item: cine }, { item: { id: "x", login: "no vale" } }],
          },
        },
      },
    })
    const results = await searchChannels("  ilojuan ", { red })
    expect(results).toEqual([
      {
        avatar: "https://static-cdn.jtvnw.net/illojuan-150x150.png",
        category: "Just Chatting",
        displayName: "IlloJuan",
        followers: 4684962,
        id: "90075649",
        login: "illojuan",
        title: "Devotion",
        viewers: null,
      },
      expect.objectContaining({ category: "Watch Party", login: "cineillojuan", viewers: 1378 }),
    ])
    expect(bodies[0]).toMatchObject({ variables: { query: "ilojuan" } })
  })

  it("sin texto, no pregunta", async () => {
    const { red } = fakeRed({})
    expect(await searchChannels("   ", { red })).toEqual([])
    expect(red).not.toHaveBeenCalled()
  })
})

describe("channelByLogin", () => {
  it("lee el canal; null si no existe o el nombre no puede serlo", async () => {
    expect(
      await channelByLogin("IlloJuan", fakeRed({ data: { user: illojuan } }).red),
    ).toMatchObject({ displayName: "IlloJuan", id: "90075649", viewers: null })
    expect(await channelByLogin("nadie", fakeRed({ data: { user: null } }).red)).toBeNull()
    const { red } = fakeRed({})
    expect(await channelByLogin("no-vale", red)).toBeNull()
    expect(red).not.toHaveBeenCalled()
  })
})
