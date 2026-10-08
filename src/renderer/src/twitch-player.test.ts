import { describe, expect, it } from "vitest"
import { createTwitchPlayerOptions, normalizeTwitchQualities } from "./twitch-player"

describe("Twitch quality normalization", () => {
  it("preserves exact string quality ids without inventing a resolution ladder", () => {
    expect(normalizeTwitchQualities(["auto", "experimental:517p59", "audio_only"])).toEqual([
      { id: "auto", label: "auto" },
      { id: "experimental:517p59", label: "experimental:517p59" },
      { id: "audio_only", label: "audio_only" },
    ])
    expect(normalizeTwitchQualities([])).toEqual([])
  })

  it("normalizes group/name objects alongside strings without rewriting ids or labels", () => {
    expect(
      normalizeTwitchQualities([
        { group: "chunked", name: "Source", size: 999 },
        "auto",
        { group: " unusual-id ", name: "Custom quality" },
      ]),
    ).toEqual([
      { id: "chunked", label: "Source" },
      { id: "auto", label: "auto" },
      { id: " unusual-id ", label: "Custom quality" },
    ])
  })

  it("discards malformed entries and non-array responses", () => {
    expect(
      normalizeTwitchQualities([
        null,
        undefined,
        1080,
        false,
        [],
        "",
        "  ",
        {},
        { group: "chunked" },
        { name: "Source" },
        { group: 1, name: "Source" },
        { group: "chunked", name: 1 },
        { group: " ", name: "Source" },
        { group: "chunked", name: "" },
        { id: "invented", label: "Unsupported shape" },
        "only-valid-entry",
      ]),
    ).toEqual([{ id: "only-valid-entry", label: "only-valid-entry" }])
    for (const invalid of [undefined, null, "auto", {}, { group: "chunked", name: "Source" }]) {
      expect(normalizeTwitchQualities(invalid)).toEqual([])
    }
  })
})

describe("interactive Twitch player options", () => {
  it("requests a live channel with sound for the local HTTPS parent", () => {
    expect(createTwitchPlayerOptions("ibai")).toEqual({
      autoplay: true,
      channel: "ibai",
      height: "100%",
      muted: false,
      parent: ["localhost"],
      width: "100%",
    })
  })
})
