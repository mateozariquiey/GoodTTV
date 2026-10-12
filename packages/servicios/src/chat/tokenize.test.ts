import type { ChatEmote } from "@goodttv/contratos"
import { describe, expect, it } from "vitest"
import { readableUserColor, tokenizeFragments, twitchEmote } from "./tokenize"

const emote = (name: string, zeroWidth = false): ChatEmote => ({
  name,
  provider: "7tv",
  url: `https://cdn.7tv.app/emote/${name}/2x.webp`,
  zeroWidth,
})

const lookup = new Map([
  ["catJAM", emote("catJAM")],
  ["PETPET", emote("PETPET", true)],
  ["EZ", emote("EZ")],
])

describe("tokenizeFragments", () => {
  it("keeps plain text in one token", () => {
    expect(tokenizeFragments([{ text: "hola a todos", type: "text" }], lookup)).toEqual([
      { kind: "text", text: "hola a todos" },
    ])
  })

  it("replaces whole words with third-party emotes and keeps spacing", () => {
    expect(tokenizeFragments([{ text: "gg EZ  clap", type: "text" }], lookup)).toEqual([
      { kind: "text", text: "gg " },
      { emote: emote("EZ"), kind: "emote", overlays: [] },
      { kind: "text", text: "  clap" },
    ])
  })

  it("does not match emote names inside words or with different case", () => {
    expect(tokenizeFragments([{ text: "EZY ez", type: "text" }], lookup)).toEqual([
      { kind: "text", text: "EZY ez" },
    ])
  })

  it("stacks a zero-width emote over the previous emote", () => {
    expect(tokenizeFragments([{ text: "catJAM PETPET hi", type: "text" }], lookup)).toEqual([
      { emote: emote("catJAM"), kind: "emote", overlays: [emote("PETPET", true)] },
      { kind: "text", text: " hi" },
    ])
  })

  it("renders a zero-width emote on its own when nothing precedes it", () => {
    expect(tokenizeFragments([{ text: "PETPET", type: "text" }], lookup)).toEqual([
      { emote: emote("PETPET", true), kind: "emote", overlays: [] },
    ])
  })

  it("stacks third-party zero-width emotes over Twitch emotes", () => {
    const tokens = tokenizeFragments(
      [
        { emote: { id: "25" }, text: "Kappa", type: "emote" },
        { text: " PETPET", type: "text" },
      ],
      lookup,
    )
    expect(tokens).toEqual([
      { emote: twitchEmote("25", "Kappa"), kind: "emote", overlays: [emote("PETPET", true)] },
    ])
  })

  it("keeps mentions as their own token and cheermotes as text", () => {
    expect(
      tokenizeFragments(
        [
          { text: "@Ibai", type: "mention" },
          { text: " Cheer100", type: "cheermote" },
        ],
        lookup,
      ),
    ).toEqual([
      { kind: "mention", text: "@Ibai" },
      { kind: "text", text: " Cheer100" },
    ])
  })

  it("falls back to text for a Twitch emote with an unexpected id", () => {
    expect(
      tokenizeFragments([{ emote: { id: "../x" }, text: "Kappa", type: "emote" }], lookup),
    ).toEqual([{ kind: "text", text: "Kappa" }])
  })
})

describe("readableUserColor", () => {
  it("keeps colours that already read on a dark surface", () => {
    expect(readableUserColor("#9ACD32", "1")).toBe("#9acd32")
  })

  it("lightens dark colours", () => {
    const lightened = readableUserColor("#0000ff", "1")
    expect(lightened).not.toBe("#0000ff")
    expect(lightened).toMatch(/^#[0-9a-f]{6}$/)
  })

  it("assigns a stable colour when the chatter has none", () => {
    expect(readableUserColor("", "12345")).toBe(readableUserColor("", "12345"))
    expect(readableUserColor("", "12345")).toMatch(/^#[0-9a-f]{6}$/)
  })
})
