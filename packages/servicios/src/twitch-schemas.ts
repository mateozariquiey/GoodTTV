import type {
  ChannelCard,
  ChatBadge,
  ChatEmote,
  DeviceChallenge,
  Page,
  StreamCard,
} from "@goodttv/contratos"
import { z } from "zod"
import { twitchEmote } from "./chat/tokenize"

const PaginationSchema = z.object({ cursor: z.string().optional() })

// Twitch sends `tags: null` for channels without tags, which `.default([])` does not cover.
const HelixTagsSchema = z
  .array(z.string())
  .nullish()
  .transform((tags) => tags ?? [])

const HelixStreamSchema = z.object({
  game_name: z.string(),
  id: z.string(),
  started_at: z.string(),
  tags: HelixTagsSchema,
  thumbnail_url: z.url(),
  title: z.string(),
  user_id: z.string(),
  user_login: z.string(),
  user_name: z.string(),
  viewer_count: z.number().int().nonnegative(),
})

const HelixChannelSchema = z.object({
  broadcaster_language: z.string(),
  broadcaster_login: z.string(),
  display_name: z.string(),
  game_name: z.string(),
  id: z.string(),
  is_live: z.boolean(),
  tags: HelixTagsSchema,
  thumbnail_url: z.url(),
  title: z.string(),
})

const HelixUserSchema = z.object({
  id: z.string(),
  profile_image_url: z.url(),
})

const DeviceCodeResponseSchema = z.object({
  device_code: z.string(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
  user_code: z.string(),
  verification_uri: z.url(),
})

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive(),
  refresh_token: z.string(),
  scope: z.array(z.string()),
  token_type: z.string(),
})

export const TokenErrorSchema = z.object({
  message: z.string(),
  status: z.number().int(),
})

export const ValidationResponseSchema = z.object({
  client_id: z.string(),
  expires_in: z.number().int().nonnegative(),
  login: z.string(),
  scopes: z.array(z.string()),
  user_id: z.string(),
})

export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponseSchema>
export type TokenResponse = z.infer<typeof TokenResponseSchema>
export type ValidationResponse = z.infer<typeof ValidationResponseSchema>

const mapPage = <ApiItem, Item>(
  data: readonly ApiItem[],
  cursor: string | undefined,
  mapItem: (item: ApiItem) => Item,
): Page<Item> => {
  const items = data.map(mapItem)
  return { cursor, items }
}

export const parseStreamsResponse = (input: unknown): Page<StreamCard> => {
  const response = z
    .object({ data: z.array(HelixStreamSchema), pagination: PaginationSchema })
    .parse(input)
  return mapPage(response.data, response.pagination.cursor, (stream) => ({
    category: stream.game_name,
    id: stream.id,
    startedAt: stream.started_at,
    tags: stream.tags,
    thumbnailUrl: stream.thumbnail_url.replace("{width}", "640").replace("{height}", "360"),
    title: stream.title,
    userId: stream.user_id,
    userLogin: stream.user_login,
    userName: stream.user_name,
    viewerCount: stream.viewer_count,
  }))
}

// The signed-in viewer (GET users without parameters): name as shown on Twitch and profile picture.
export const parseOwnUserResponse = (
  input: unknown,
):
  | { readonly displayName: string; readonly login: string; readonly profileImageUrl: string }
  | undefined => {
  const response = z
    .object({
      data: z.array(
        HelixUserSchema.extend({ display_name: z.string().min(1), login: z.string().min(1) }),
      ),
    })
    .parse(input)
  const [user] = response.data
  return user === undefined
    ? undefined
    : {
        displayName: user.display_name,
        login: user.login,
        profileImageUrl: user.profile_image_url,
      }
}

export const parseUsersResponse = (input: unknown): ReadonlyMap<string, string> => {
  const response = z.object({ data: z.array(HelixUserSchema) }).parse(input)
  return new Map(response.data.map((user) => [user.id, user.profile_image_url]))
}

export const mergeStreamProfiles = (
  page: Page<StreamCard>,
  profiles: ReadonlyMap<string, string>,
): Page<StreamCard> => ({
  cursor: page.cursor,
  items: page.items.map((stream) => {
    const profileImageUrl = profiles.get(stream.userId)
    return profileImageUrl === undefined ? stream : { ...stream, profileImageUrl }
  }),
})

export const parseChannelsResponse = (input: unknown): Page<ChannelCard> => {
  const response = z
    .object({ data: z.array(HelixChannelSchema), pagination: PaginationSchema })
    .parse(input)
  return mapPage(response.data, response.pagination.cursor, (channel) => ({
    category: channel.game_name,
    displayName: channel.display_name,
    id: channel.id,
    isLive: channel.is_live,
    login: channel.broadcaster_login,
    thumbnailUrl: channel.thumbnail_url,
    title: channel.title,
  }))
}

export const parseDeviceCodeResponse = (input: unknown): DeviceCodeResponse =>
  DeviceCodeResponseSchema.parse(input)

export const toDeviceChallenge = (
  response: DeviceCodeResponse,
  flowId: string,
  now: Date,
): DeviceChallenge => ({
  expiresAt: new Date(now.getTime() + response.expires_in * 1000).toISOString(),
  flowId,
  intervalSeconds: response.interval,
  userCode: response.user_code,
  verificationUri: response.verification_uri,
})

const HelixBadgeSetSchema = z.object({
  set_id: z.string(),
  versions: z.array(
    z.object({
      id: z.string(),
      image_url_2x: z.url(),
      title: z.string(),
    }),
  ),
})

// Keyed by "set_id/id", the shape EventSub chat messages reference.
export const parseBadgesResponse = (input: unknown): Map<string, ChatBadge> => {
  const response = z.object({ data: z.array(HelixBadgeSetSchema) }).parse(input)
  const badges = new Map<string, ChatBadge>()
  for (const set of response.data) {
    for (const version of set.versions) {
      if (!version.image_url_2x.startsWith("https://static-cdn.jtvnw.net/")) continue
      badges.set(`${set.set_id}/${version.id}`, {
        title: version.title.slice(0, 100),
        url: version.image_url_2x,
      })
    }
  }
  return badges
}

// Send Chat Message: enviado con su id, o el motivo por el que Twitch no lo envió.
export const parseSentChatMessage = (
  input: unknown,
):
  | { readonly id: string; readonly sent: true }
  | { readonly reason: string; readonly sent: false } => {
  const [first] = z
    .object({
      data: z
        .array(
          z.object({
            drop_reason: z.object({ code: z.string(), message: z.string() }).nullish(),
            is_sent: z.boolean(),
            message_id: z.string(),
          }),
        )
        .min(1),
    })
    .parse(input).data
  if (first?.is_sent === true && first.message_id !== "")
    return { id: first.message_id, sent: true }
  const reason =
    first?.drop_reason?.message || first?.drop_reason?.code || "Twitch no lo ha enviado."
  return { reason: reason.slice(0, 300), sent: false }
}

// Los emotes de Twitch de la cuenta (GET chat/emotes/user), sin los «smilies» (:) y compañía, que se escriben solos.
export const parseUserEmotesResponse = (
  input: unknown,
): { readonly cursor: string | undefined; readonly emotes: ChatEmote[] } => {
  const parsed = z
    .object({
      data: z.array(
        z.object({ emote_type: z.string().default(""), id: z.string(), name: z.string() }),
      ),
      pagination: PaginationSchema.optional(),
    })
    .parse(input)
  const emotes = parsed.data.flatMap((emote) => {
    const parsedEmote =
      emote.emote_type === "smilies" || emote.name === "" || emote.name.length > 100
        ? undefined
        : twitchEmote(emote.id, emote.name)
    return parsedEmote === undefined ? [] : [parsedEmote]
  })
  return { cursor: parsed.pagination?.cursor || undefined, emotes }
}

export const parseChatColorResponse = (input: unknown): string =>
  z
    .object({ data: z.array(z.object({ color: z.string() })) })
    .parse(input)
    .data.at(0)?.color ?? ""

export const parseSubscriptionResponse = (input: unknown): string =>
  z.object({ data: z.array(z.object({ id: z.string().min(1) })).min(1) }).parse(input).data[0]
    ?.id ?? ""
