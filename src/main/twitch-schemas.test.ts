import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  mergeStreamProfiles,
  parseBadgesResponse,
  parseStreamsResponse,
  parseSubscriptionResponse,
  parseUsersResponse,
} from "./twitch-schemas"

describe("Twitch response parsing", () => {
  it("maps a Helix stream response into renderer-safe cards", () => {
    // Given a valid Helix response with a replaceable thumbnail template
    const response = {
      data: [
        {
          game_id: "509658",
          game_name: "Just Chatting",
          id: "123",
          is_mature: false,
          language: "en",
          started_at: "2026-09-05T12:00:00Z",
          tags: ["English"],
          thumbnail_url:
            "https://static-cdn.jtvnw.net/previews-ttv/live_user_name-{width}x{height}.jpg",
          title: "A live stream",
          type: "live",
          user_id: "456",
          user_login: "streamer",
          user_name: "Streamer",
          viewer_count: 4200,
        },
      ],
      pagination: { cursor: "next-page" },
    }

    // When the untrusted payload crosses the parser boundary
    const page = parseStreamsResponse(response)

    // Then renderer data is camel-cased and receives a concrete 16:9 image URL
    expect(page).toEqual({
      cursor: "next-page",
      items: [
        {
          category: "Just Chatting",
          id: "123",
          startedAt: "2026-09-05T12:00:00Z",
          tags: ["English"],
          thumbnailUrl: "https://static-cdn.jtvnw.net/previews-ttv/live_user_name-640x360.jpg",
          title: "A live stream",
          userId: "456",
          userLogin: "streamer",
          userName: "Streamer",
          viewerCount: 4200,
        },
      ],
    })
  })

  it("accepts streams whose tags Twitch reports as null", () => {
    // Given a live page where Twitch sends null tags, as observed on a second category page
    const stream = {
      game_name: "Just Chatting",
      id: "123",
      started_at: "2026-09-05T12:00:00Z",
      tags: null,
      thumbnail_url:
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_name-{width}x{height}.jpg",
      title: "A live stream",
      user_id: "456",
      user_login: "streamer",
      user_name: "Streamer",
      viewer_count: 4200,
    }

    // When the payload crosses the parser boundary, with and without the field present
    const nullTags = parseStreamsResponse({ data: [stream], pagination: {} })
    const { tags: _omitted, ...withoutTags } = stream
    const missingTags = parseStreamsResponse({ data: [withoutTags], pagination: {} })

    // Then the page parses and the renderer receives an empty tag list either way
    expect(nullTags.items[0]?.tags).toEqual([])
    expect(missingTags.items[0]?.tags).toEqual([])
  })

  it("rejects malformed Helix response data", () => {
    // Given an untrusted payload with an invalid viewer count
    const response = { data: [{ viewer_count: -1 }], pagination: {} }

    // When the payload crosses the parser boundary
    const parse = (): unknown => parseStreamsResponse(response)

    // Then malformed data cannot enter the application
    expect(parse).toThrow()
  })

  it("adds broadcaster profile images to live stream cards", () => {
    // Given independently parsed stream and user payloads from Helix
    const streams = parseStreamsResponse({
      data: [
        {
          game_name: "Just Chatting",
          id: "123",
          started_at: "2026-09-05T12:00:00Z",
          tags: [],
          thumbnail_url: "https://static-cdn.jtvnw.net/previews/{width}x{height}.jpg",
          title: "A live stream",
          user_id: "456",
          user_login: "streamer",
          user_name: "Streamer",
          viewer_count: 4200,
        },
      ],
      pagination: {},
    })
    const profiles = parseUsersResponse({
      data: [
        {
          id: "456",
          profile_image_url: "https://static-cdn.jtvnw.net/jtv_user_pictures/streamer.png",
        },
      ],
    })

    // When profile data is joined to the stream page
    const enriched = mergeStreamProfiles(streams, profiles)

    // Then the home card receives the broadcaster's actual profile image
    expect(enriched.items[0]?.profileImageUrl).toBe(
      "https://static-cdn.jtvnw.net/jtv_user_pictures/streamer.png",
    )
  })
})

describe("chat support parsing", () => {
  it("keys badges by set and version and keeps only Twitch's CDN", () => {
    const badges = parseBadgesResponse({
      data: [
        {
          set_id: "subscriber",
          versions: [
            { id: "0", image_url_2x: "https://static-cdn.jtvnw.net/badges/v1/a/2", title: "Sub" },
            { id: "3", image_url_2x: "https://evil.example/b/2", title: "Bad" },
          ],
        },
      ],
    })
    expect(badges.get("subscriber/0")).toEqual({
      title: "Sub",
      url: "https://static-cdn.jtvnw.net/badges/v1/a/2",
    })
    expect(badges.has("subscriber/3")).toBe(false)
  })

  it("reads the id of a created subscription and rejects empty answers", () => {
    expect(parseSubscriptionResponse({ data: [{ id: "abc", status: "enabled" }] })).toBe("abc")
    expect(() => parseSubscriptionResponse({ data: [] })).toThrow(z.ZodError)
  })
})
