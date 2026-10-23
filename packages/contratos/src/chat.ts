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

// Escribir en el chat (CHAT-1; la extensión y Android, D24). Twitch admite hasta 500 caracteres.
export const CHAT_MESSAGE_MAX = 500
export const ChatSendInputSchema = z.strictObject({
  broadcasterId: z.string().regex(/^[0-9]{1,20}$/),
  message: z.string().trim().min(1).max(CHAT_MESSAGE_MAX),
})
export type ChatSendInput = z.infer<typeof ChatSendInputSchema>

// Enviado: el mensaje tal como se enseña ya, sin esperar a que llegue por EventSub (que lo sustituye al llegar, con sus
// insignias y emotes de Twitch). No enviado: el motivo, para enseñarlo.
export const ChatSendResultSchema = z.discriminatedUnion("sent", [
  z.strictObject({ message: ChatMessageSchema, sent: z.literal(true) }),
  z.strictObject({ reason: z.string().min(1).max(300), sent: z.literal(false) }),
])
export type ChatSendResult = z.infer<typeof ChatSendResultSchema>

// Los emotes que se pueden escribir en un canal, para elegirlos o completarlos al escribir (CHAT-1). Los de 7TV, BTTV y
// FFZ se envían como texto: los ve como imagen quien tenga su extensión, o GoodTTV.
export type ChatEmoteGroups = {
  readonly channel: readonly ChatEmote[] // 7TV, BTTV y FFZ del canal
  readonly twitch: readonly ChatEmote[] // los de Twitch de la cuenta: suscripciones, de seguidor y globales
  readonly global: readonly ChatEmote[] // 7TV, BTTV y FFZ globales
}

// Un mensaje del chat de un VOD (VOD-1): el mismo que en directo, con su segundo en el vídeo.
export type ReplayMessage = ChatMessage & { readonly offset: number }
