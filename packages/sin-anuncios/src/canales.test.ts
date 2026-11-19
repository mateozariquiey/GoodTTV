import { describe, expect, it, vi } from "vitest"
import {
  categoryStreams,
  channelByLogin,
  popularStreams,
  searchChannels,
  topCategories,
} from "./canales"

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

describe("popularStreams", () => {
  const node = {
    broadcaster: {
      displayName: "Rubius",
      id: "39276140",
      login: "rubius",
      profileImageURL: "https://static-cdn.jtvnw.net/rubius-70x70.png",
    },
    createdAt: "2026-11-04T18:09:17Z",
    game: { name: "Minecraft" },
    title: "Directo",
    viewersCount: 29605,
  }

  it("pide el idioma como lo quiere Twitch y descarta lo que no sea un directo válido", async () => {
    const { bodies, red } = fakeRed({
      data: {
        streams: { edges: [{ node }, { node: { ...node, viewersCount: "x" } }, { node: null }] },
      },
    })
    expect(await popularStreams({ first: 3, language: "es" }, red)).toEqual([
      {
        avatar: node.broadcaster.profileImageURL,
        category: "Minecraft",
        displayName: "Rubius",
        id: "39276140",
        login: "rubius",
        startedAt: node.createdAt,
        title: "Directo",
        viewers: 29605,
      },
    ])
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ variables: { first: 3, languages: ["ES"] } })
  })

  it("sin directos en ese idioma, los de todos", async () => {
    const empty = { data: { streams: { edges: [] } } }
    const full = { data: { streams: { edges: [{ node }] } } }
    const red = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json(empty))
      .mockResolvedValueOnce(Response.json(full))
    expect((await popularStreams({ language: "xx" }, red))[0]?.login).toBe("rubius")
    expect(red).toHaveBeenCalledTimes(2)
  })

  it("un idioma raro no llega a Twitch", async () => {
    const { bodies, red } = fakeRed({ data: { streams: { edges: [{ node }] } } })
    await popularStreams({ language: "es-ES" }, red)
    expect(bodies[0]).toMatchObject({ variables: { first: 24 } })
    expect(JSON.stringify(bodies[0])).not.toContain("es-ES")
  })
})

const gta = {
  boxArtURL: "https://static-cdn.jtvnw.net/ttv-boxart/1867279146_IGDB-144x192.jpg",
  broadcastersCount: 21185,
  id: "1867279146",
  name: "Grand Theft Auto VI",
  slug: "grand-theft-auto-vi",
  viewersCount: 2833465,
}
const chatting = {
  boxArtURL: "https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg",
  broadcastersCount: 5842,
  id: "509658",
  name: "Just Chatting",
  slug: "just-chatting",
  viewersCount: 429632,
}

describe("topCategories", () => {
  it("de más a menos espectadores, con su carátula y sus canales; sin las que no son válidas", async () => {
    const { bodies, red } = fakeRed({
      data: {
        games: {
          edges: [
            { node: chatting },
            { node: gta },
            { node: { ...gta, slug: null } },
            { node: { ...gta, id: "x" } },
            {
              node: {
                ...chatting,
                boxArtURL: null,
                id: "7",
                slug: "sin-nadie",
                viewersCount: null,
              },
            },
          ],
        },
      },
    })
    expect(await topCategories({ first: 500 }, red)).toEqual([
      {
        boxArt: gta.boxArtURL,
        channels: 21185,
        id: "1867279146",
        name: "Grand Theft Auto VI",
        slug: "grand-theft-auto-vi",
        viewers: 2833465,
      },
      {
        boxArt: chatting.boxArtURL,
        channels: 5842,
        id: "509658",
        name: "Just Chatting",
        slug: "just-chatting",
        viewers: 429632,
      },
      {
        boxArt: null,
        channels: 5842,
        id: "7",
        name: "Just Chatting",
        slug: "sin-nadie",
        viewers: 0,
      },
    ])
    expect(bodies).toMatchObject([{ variables: { first: 100 } }])
  })

  it("si Twitch no las da, ninguna", async () => {
    expect(await topCategories({}, fakeRed({ data: { games: null } }).red)).toEqual([])
  })
})

describe("categoryStreams", () => {
  const stream = (login: string, viewersCount: number) => ({
    broadcaster: { displayName: login, id: "90075649", login, profileImageURL: null },
    createdAt: "2026-11-18T18:00:00Z",
    game: { name: "Grand Theft Auto VI" },
    title: "GTA VI",
    viewersCount,
  })

  it("la categoría y sus directos, de más a menos espectadores", async () => {
    const { bodies, red } = fakeRed({
      data: {
        game: {
          ...gta,
          streams: {
            edges: [
              { node: stream("illojuan", 162355) },
              { node: stream("rubius", 262293) },
              { node: { ...stream("sin_canal", 5), broadcaster: null } },
            ],
          },
        },
      },
    })
    const found = await categoryStreams("Grand-Theft-Auto-VI", {}, red)
    expect(found?.category).toMatchObject({ name: "Grand Theft Auto VI", viewers: 2833465 })
    expect(found?.streams.map((each) => [each.login, each.viewers])).toEqual([
      ["rubius", 262293],
      ["illojuan", 162355],
    ])
    expect(bodies).toMatchObject([{ variables: { first: 60, slug: "grand-theft-auto-vi" } }])
  })

  it("null si no existe, y un nombre que no puede serlo no llega a Twitch", async () => {
    const missing = fakeRed({ data: { game: null } })
    expect(await categoryStreams("no-existe", {}, missing.red)).toBeNull()
    expect(await categoryStreams("../ajustes", {}, missing.red)).toBeNull()
    expect(missing.red).toHaveBeenCalledTimes(1)
  })
})
