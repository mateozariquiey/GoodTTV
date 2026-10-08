import { z } from "zod"

// Chat crosses the bridge already tokenized: the renderer only lays out text and images.
export const EmoteProviderSchema = z.enum(["twitch", "7tv", "bttv", "ffz"])
export type EmoteProvider = z.infer<typeof EmoteProviderSchema>

const ImageUrlSchema = z
  .url({ protocol: /^https$/ })
  .max(512)
  .refine(
    (value) =>
      ["static-cdn.jtvnw.net", "cdn.7tv.app", "cdn.betterttv.net", "cdn.frankerfacez.com"].includes(
        new URL(value).hostname,
      ),
    { message: "Unexpected image host" },
  )

export const ChatEmoteSchema = z.strictObject({
  height: z.number().positive().max(512).optional(),
  name: z.string().min(1).max(100),
  provider: EmoteProviderSchema,
  url: ImageUrlSchema,
  width: z.number().positive().max(1024).optional(),
  zeroWidth: z.boolean(),
})
export type ChatEmote = z.infer<typeof ChatEmoteSchema>

export const ChatTokenSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string().max(1000) }),
  z.strictObject({ kind: z.literal("mention"), text: z.string().max(100) }),
  z.strictObject({
    emote: ChatEmoteSchema,
    kind: z.literal("emote"),
    overlays: z.array(ChatEmoteSchema).max(8),
  }),
])
export type ChatToken = z.infer<typeof ChatTokenSchema>

export const ChatBadgeSchema = z.strictObject({
  title: z.string().max(100),
  url: ImageUrlSchema,
})
export type ChatBadge = z.infer<typeof ChatBadgeSchema>

export const ChatMessageSchema = z.strictObject({
  action: z.boolean(),
  badges: z.array(ChatBadgeSchema).max(8),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  displayName: z.string().min(1).max(60),
  id: z.string().min(1).max(64),
  replyTo: z.string().max(60).optional(),
  tokens: z.array(ChatTokenSchema).max(600),
  userId: z.string().min(1).max(64),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatStatusSchema = z.enum([
  "connecting",
  "connected",
  "reconnecting",
  "unauthenticated",
  "missing-scope",
  "error",
])
export type ChatStatus = z.infer<typeof ChatStatusSchema>

export const ChatEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("message"), message: ChatMessageSchema }),
  z.strictObject({ kind: z.literal("delete"), messageId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("clear-user"), userId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("clear") }),
  z.strictObject({ kind: z.literal("status"), status: ChatStatusSchema }),
])
export type ChatEvent = z.infer<typeof ChatEventSchema>

export const ChatBatchSchema = z.strictObject({
  events: z.array(ChatEventSchema).max(500),
  session: z.number().int().nonnegative(),
})
export type ChatBatch = z.infer<typeof ChatBatchSchema>

export const ChatOpenInputSchema = z.strictObject({
  broadcasterId: z.string().regex(/^[0-9]{1,20}$/),
})
export type ChatOpenInput = z.infer<typeof ChatOpenInputSchema>
