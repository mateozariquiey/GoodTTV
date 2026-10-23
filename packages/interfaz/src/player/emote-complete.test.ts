import type { ChatEmote } from "@goodttv/contratos"
import { describe, expect, it } from "vitest"
import { emoteThumb, insertAt, replaceWord, suggestEmotes, wordAt } from "./emote-complete"

const emote = (name: string, provider: ChatEmote["provider"] = "7tv"): ChatEmote => ({
  name,
  provider,
  url: `https://cdn.7tv.app/emote/${name}/2x.webp`,
  zeroWidth: false,
})

describe("wordAt", () => {
  it("la palabra que acaba en el cursor", () => {
    expect(wordAt("hola KEK", 8)).toEqual({ end: 8, start: 5, text: "KEK" })
    expect(wordAt("hola ", 5)).toEqual({ end: 5, start: 5, text: "" })
    expect(wordAt(":ka", 3)).toEqual({ end: 3, start: 0, text: ":ka" })
  })
})

describe("suggestEmotes", () => {
  const groups = {
    channel: [emote("KEKWait"), emote("KEKW"), emote("catJAM")],
    global: [emote("KEKW", "bttv"), emote("Kappa", "ffz")],
    twitch: [emote("Kappa", "twitch"), emote("KEKHeim", "twitch")],
  }

  it("primero los del canal, los cortos antes; sin repetir nombres", () => {
    expect(suggestEmotes(groups, "kek").map((each) => each.name)).toEqual([
      "KEKW",
      "KEKWait",
      "KEKHeim",
    ])
    expect(suggestEmotes(groups, "KEK")[0]?.provider).toBe("7tv")
  })

  it("con «:» delante, igual; con menos de dos letras, nada", () => {
    expect(suggestEmotes(groups, ":ka").map((each) => each.name)).toEqual(["Kappa"])
    expect(suggestEmotes(groups, ":ka")[0]?.provider).toBe("twitch")
    expect(suggestEmotes(groups, "k")).toEqual([])
    expect(suggestEmotes(groups, ":")).toEqual([])
  })

  it("como mucho «max»", () => {
    expect(suggestEmotes(groups, "kek", 2)).toHaveLength(2)
  })
})

describe("replaceWord e insertAt", () => {
  it("cambia la palabra por el emote y deja el cursor tras el espacio", () => {
    expect(replaceWord("jaja kek", wordAt("jaja kek", 8), "KEKW")).toEqual({
      caret: 10,
      text: "jaja KEKW ",
    })
    expect(replaceWord("kek hola", { end: 3, start: 0, text: "kek" }, "KEKW")).toEqual({
      caret: 5,
      text: "KEKW hola",
    })
  })

  it("inserta en el cursor, separado de lo anterior", () => {
    expect(insertAt("", 0, "KEKW")).toEqual({ caret: 5, text: "KEKW " })
    expect(insertAt("hola", 4, "KEKW")).toEqual({ caret: 10, text: "hola KEKW " })
    expect(insertAt("hola ", 5, "KEKW")).toEqual({ caret: 10, text: "hola KEKW " })
  })
})

describe("emoteThumb", () => {
  it("la imagen 1x de cada proveedor", () => {
    expect(emoteThumb(emote("KEKW"))).toBe("https://cdn.7tv.app/emote/KEKW/1x.webp")
    expect(
      emoteThumb({
        ...emote("catJAM", "bttv"),
        url: "https://cdn.betterttv.net/emote/abc/2x.webp",
      }),
    ).toBe("https://cdn.betterttv.net/emote/abc/1x.webp")
    expect(
      emoteThumb({ ...emote("Z", "ffz"), url: "https://cdn.frankerfacez.com/emote/1/2" }),
    ).toBe("https://cdn.frankerfacez.com/emote/1/1")
    expect(
      emoteThumb({
        ...emote("Kappa", "twitch"),
        url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0",
      }),
    ).toBe("https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0")
  })
})
