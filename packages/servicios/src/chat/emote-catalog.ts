import type { ChatEmote } from "@goodttv/contratos"
import ky from "ky"
import { z } from "zod"

// Third-party emote providers publish public, unauthenticated JSON. Each one is optional:
// a provider that fails or changes shape only removes its emotes, never the chat.
type FetchJson = (url: string) => Promise<unknown>

const defaultFetchJson: FetchJson = (url) => ky.get(url, { retry: 1, timeout: 10_000 }).json()

const lenientArray = <Schema extends z.ZodType>(schema: Schema) =>
  z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = schema.safeParse(item)
      return parsed.success ? [parsed.data as z.infer<Schema>] : []
    }),
  )

const SevenTvFileSchema = z.object({
  format: z.string(),
  height: z.number().positive(),
  name: z.string(),
  width: z.number().positive(),
})
const SevenTvEmoteSchema = z.object({
  data: z.object({
    flags: z.number().int().default(0),
    host: z.object({ files: z.array(SevenTvFileSchema), url: z.string() }),
  }),
  flags: z.number().int().default(0),
  name: z.string().min(1).max(100),
})
const SevenTvSetSchema = z.object({
  emotes: lenientArray(SevenTvEmoteSchema).nullable().default([]),
})
const SevenTvUserSchema = z.object({ emote_set: SevenTvSetSchema.nullable().default(null) })

// 7TV marks zero-width either on the set entry (bit 0) or on the emote itself (bit 8).
const SEVEN_TV_SET_ZERO_WIDTH = 1
const SEVEN_TV_EMOTE_ZERO_WIDTH = 1 << 8

const fromSevenTv = (emotes: readonly z.infer<typeof SevenTvEmoteSchema>[]): ChatEmote[] =>
  emotes.flatMap((emote) => {
    const base = emote.data.host.files.find((file) => file.name === "1x.webp")
    const url = `https:${emote.data.host.url}/2x.webp`
    if (!emote.data.host.url.startsWith("//cdn.7tv.app/")) return []
    return [
      {
        ...(base === undefined ? {} : { height: base.height, width: base.width }),
        name: emote.name,
        provider: "7tv",
        url,
        zeroWidth:
          (emote.flags & SEVEN_TV_SET_ZERO_WIDTH) !== 0 ||
          (emote.data.flags & SEVEN_TV_EMOTE_ZERO_WIDTH) !== 0,
      } satisfies ChatEmote,
    ]
  })

const BttvEmoteSchema = z.object({
  code: z.string().min(1).max(100),
  id: z.string().regex(/^[a-f0-9]{24}$/),
  modifier: z.boolean().default(false),
})
const BttvUserSchema = z.object({
  channelEmotes: lenientArray(BttvEmoteSchema).default([]),
  sharedEmotes: lenientArray(BttvEmoteSchema).default([]),
})

// BTTV's documented zero-width set; their API does not flag them.
const BTTV_ZERO_WIDTH = new Set([
  "SoSnowy",
  "IceCold",
  "SantaHat",
  "TopHat",
  "ReinDeer",
  "CandyCane",
  "cvMask",
  "cvHazmat",
])

const fromBttv = (emotes: readonly z.infer<typeof BttvEmoteSchema>[]): ChatEmote[] =>
  emotes
    // Modifiers such as "h!" alter the next emote; rendering them as images would mislead.
    .filter((emote) => !emote.modifier)
    .map((emote) => ({
      name: emote.code,
      provider: "bttv",
      url: `https://cdn.betterttv.net/emote/${emote.id}/2x.webp`,
      zeroWidth: BTTV_ZERO_WIDTH.has(emote.code),
    }))

const FfzUrlsSchema = z.record(z.string(), z.string())
const FfzEmoteSchema = z.object({
  animated: FfzUrlsSchema.nullable().optional(),
  height: z.number().positive(),
  modifier: z.boolean().default(false),
  name: z.string().min(1).max(100),
  urls: FfzUrlsSchema,
  width: z.number().positive(),
})
const FfzSetsSchema = z.record(
  z.string(),
  z.object({ emoticons: lenientArray(FfzEmoteSchema).default([]) }),
)
const FfzGlobalSchema = z.object({ default_sets: z.array(z.number()), sets: FfzSetsSchema })
const FfzRoomSchema = z.object({ sets: FfzSetsSchema })

const fromFfz = (emotes: readonly z.infer<typeof FfzEmoteSchema>[]): ChatEmote[] =>
  emotes.flatMap((emote) => {
    const urls = emote.animated ?? emote.urls
    const url = urls["2"] ?? urls["1"]
    if (url === undefined || !url.startsWith("https://cdn.frankerfacez.com/")) return []
    return [
      {
        height: emote.height,
        name: emote.name,
        provider: "ffz",
        url,
        width: emote.width,
        zeroWidth: emote.modifier,
      } satisfies ChatEmote,
    ]
  })

export type EmoteCatalogOptions = {
  readonly fetchJson?: FetchJson
  readonly now?: () => number
}

const CHANNEL_TTL_MS = 10 * 60_000
const GLOBAL_TTL_MS = 6 * 60 * 60_000

export class EmoteCatalog {
  readonly #fetchJson: FetchJson
  readonly #now: () => number
  #global: { readonly at: number; readonly emotes: Promise<ChatEmote[]> } | undefined
  readonly #channels = new Map<
    string,
    { readonly at: number; readonly emotes: Promise<ChatEmote[]> }
  >()

  public constructor(options: EmoteCatalogOptions = {}) {
    this.#fetchJson = options.fetchJson ?? defaultFetchJson
    this.#now = options.now ?? Date.now
  }

  // Channel emotes win over globals; within each scope 7TV, then BTTV, then FFZ.
  public async forChannel(twitchUserId: string): Promise<ReadonlyMap<string, ChatEmote>> {
    const [globalEmotes, channelEmotes] = await Promise.all([
      this.#globalEmotes(),
      this.#channelEmotes(twitchUserId),
    ])
    const lookup = new Map<string, ChatEmote>()
    for (const emote of [...globalEmotes, ...channelEmotes].reverse()) {
      if (!lookup.has(emote.name)) lookup.set(emote.name, emote)
    }
    return lookup
  }

  #globalEmotes(): Promise<ChatEmote[]> {
    const cached = this.#global
    if (cached !== undefined && this.#now() - cached.at < GLOBAL_TTL_MS) return cached.emotes
    const emotes = this.#collect([
      this.#load("https://7tv.io/v3/emote-sets/global", (value) =>
        fromSevenTv(SevenTvSetSchema.parse(value).emotes ?? []),
      ),
      this.#load("https://api.betterttv.net/3/cached/emotes/global", (value) =>
        fromBttv(lenientArray(BttvEmoteSchema).parse(value)),
      ),
      this.#load("https://api.frankerfacez.com/v1/set/global", (value) => {
        const parsed = FfzGlobalSchema.parse(value)
        return fromFfz(
          parsed.default_sets.flatMap((id) => parsed.sets[String(id)]?.emoticons ?? []),
        )
      }),
    ])
    this.#global = { at: this.#now(), emotes }
    return emotes
  }

  #channelEmotes(twitchUserId: string): Promise<ChatEmote[]> {
    if (!/^[0-9]{1,20}$/.test(twitchUserId)) return Promise.resolve([])
    const cached = this.#channels.get(twitchUserId)
    if (cached !== undefined && this.#now() - cached.at < CHANNEL_TTL_MS) return cached.emotes
    const emotes = this.#collect([
      this.#load(`https://7tv.io/v3/users/twitch/${twitchUserId}`, (value) =>
        fromSevenTv(SevenTvUserSchema.parse(value).emote_set?.emotes ?? []),
      ),
      this.#load(`https://api.betterttv.net/3/cached/users/twitch/${twitchUserId}`, (value) => {
        const parsed = BttvUserSchema.parse(value)
        return fromBttv([...parsed.sharedEmotes, ...parsed.channelEmotes])
      }),
      this.#load(`https://api.frankerfacez.com/v1/room/id/${twitchUserId}`, (value) =>
        fromFfz(Object.values(FfzRoomSchema.parse(value).sets).flatMap((set) => set.emoticons)),
      ),
    ])
    this.#channels.set(twitchUserId, { at: this.#now(), emotes })
    return emotes
  }

  // Lowest priority first, so later providers in the list override earlier ones.
  async #collect(sources: readonly Promise<ChatEmote[]>[]): Promise<ChatEmote[]> {
    const results = await Promise.all(sources)
    return [...results].reverse().flat()
  }

  async #load(url: string, parse: (value: unknown) => ChatEmote[]): Promise<ChatEmote[]> {
    try {
      return parse(await this.#fetchJson(url))
    } catch {
      // Missing channel (404), outage or schema drift: carry on without this provider.
      return []
    }
  }
}
