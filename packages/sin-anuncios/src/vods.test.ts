import { describe, expect, it, vi } from "vitest"
import { commentsFrom, storyboardOf, thumbnailAt, videosOf, vodMasterUrl } from "./vods"

// Una red falsa: a GQL contesta lo que se le dé; a lo demás, el texto de `files` por URL.
const fakeRed = (gql: unknown, files: Record<string, string> = {}) => {
  const bodies: unknown[] = []
  const red = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === "https://gql.twitch.tv/gql") {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json(gql)
    }
    return new Response(files[url] ?? "", { status: files[url] === undefined ? 404 : 200 })
  })
  return { bodies, red }
}

describe("videosOf", () => {
  it("lee el canal y sus vídeos, sin los que no tienen un id válido", async () => {
    const { bodies, red } = fakeRed({
      data: {
        user: {
          displayName: "Ibai",
          id: "83232866",
          login: "ibai",
          profileImageURL: "https://x/ibai.png",
          videos: {
            edges: [
              {
                node: {
                  broadcastType: "ARCHIVE",
                  createdAt: "2026-10-18T17:34:21Z",
                  game: { displayName: "League of Legends" },
                  id: "2904365699",
                  lengthSeconds: 11919,
                  previewThumbnailURL: "https://x/thumb0-320x180.jpg",
                  seekPreviewsURL: "https://x/storyboards/2904365699-info.json",
                  title: "Worlds",
                  viewCount: 388091,
                },
              },
              { node: { id: "no-es-un-id" } },
              { node: { id: "2", previewThumbnailURL: "https://x/404_processing_320x180.png" } },
            ],
          },
        },
      },
    })
    const result = await videosOf("Ibai", { red })
    expect(result?.owner).toEqual({
      avatar: "https://x/ibai.png",
      displayName: "Ibai",
      id: "83232866",
      login: "ibai",
    })
    expect(result?.videos.map((video) => video.id)).toEqual(["2904365699", "2"])
    expect(result?.videos[0]).toMatchObject({
      category: "League of Legends",
      kind: "archive",
      seconds: 11919,
    })
    expect(result?.videos[1]?.thumbnail).toBeNull()
    expect(bodies[0]).toMatchObject({ variables: { login: "ibai" } })
  })

  it("null si el canal no existe", async () => {
    expect(await videosOf("nadie", { red: fakeRed({ data: { user: null } }).red })).toBeNull()
  })
})

describe("vodMasterUrl", () => {
  it("la lista maestra de usher con el token del vídeo", async () => {
    const { red } = fakeRed({ data: { videoPlaybackAccessToken: { signature: "s", value: "{}" } } })
    const url = new URL(await vodMasterUrl("2904365699", red))
    expect(url.origin + url.pathname).toBe("https://usher.ttvnw.net/vod/2904365699.m3u8")
    expect(url.searchParams.get("sig")).toBe("s")
  })
})

describe("miniaturas de la barra", () => {
  const info = JSON.stringify([
    {
      cols: 5,
      count: 200,
      height: 90,
      images: ["v-low-0.jpg"],
      interval: 60,
      rows: 40,
      width: 160,
    },
    {
      cols: 5,
      count: 200,
      height: 124,
      images: ["v-high-0.jpg", "v-high-1.jpg", "v-high-2.jpg", "v-high-3.jpg"],
      interval: 60,
      rows: 10,
      width: 220,
    },
  ])

  it("elige la de más calidad, con las hojas junto a info.json", async () => {
    const board = await storyboardOf(
      "https://cdn/s/storyboards/v-info.json",
      fakeRed({}, { "https://cdn/s/storyboards/v-info.json": info }).red,
    )
    expect(board).toMatchObject({ cols: 5, rows: 10, width: 220 })
    expect(board?.sheets[1]).toBe("https://cdn/s/storyboards/v-high-1.jpg")
  })

  it("sitúa cada segundo en su hoja, fila y columna", async () => {
    const board = await storyboardOf(
      "https://cdn/s/storyboards/v-info.json",
      fakeRed({}, { "https://cdn/s/storyboards/v-info.json": info }).red,
    )
    if (board === null) throw new Error("sin miniaturas")
    expect(thumbnailAt(board, 0)).toEqual({ col: 0, row: 0, sheet: board.sheets[0] })
    // Minuto 57: la miniatura 57, en la segunda hoja (50 por hoja), la 7.ª: fila 1, columna 2.
    expect(thumbnailAt(board, 57 * 60 + 30)).toEqual({ col: 2, row: 1, sheet: board.sheets[1] })
    // Más allá del final, la última.
    expect(thumbnailAt(board, 10 ** 6)).toEqual({ col: 4, row: 9, sheet: board.sheets[3] })
  })
})

describe("commentsFrom", () => {
  it("lee los mensajes con su posición, sus insignias y sus emotes de Twitch", async () => {
    const { bodies, red } = fakeRed({
      data: {
        video: {
          comments: {
            edges: [
              {
                node: {
                  commenter: { displayName: "Pepe", id: "1", login: "pepe" },
                  contentOffsetSeconds: 583,
                  id: "c1",
                  message: {
                    fragments: [
                      { emote: null, text: "hola " },
                      { emote: { emoteID: "25", id: "x" }, text: "Kappa" },
                    ],
                    userBadges: [{ setID: "subscriber", version: "0" }],
                    userColor: "#FF0000",
                  },
                },
              },
              { node: { id: "sin-autor" } },
            ],
          },
        },
      },
    })
    const comments = await commentsFrom("2904365699", 600.7, red)
    expect(comments).toEqual([
      {
        badges: [{ setId: "subscriber", version: "0" }],
        color: "#FF0000",
        displayName: "Pepe",
        fragments: [
          { emoteId: null, text: "hola " },
          { emoteId: "25", text: "Kappa" },
        ],
        id: "c1",
        login: "pepe",
        offset: 583,
        userId: "1",
      },
    ])
    expect(bodies[0]).toMatchObject({
      variables: { contentOffsetSeconds: 600, videoID: "2904365699" },
    })
  })
})
