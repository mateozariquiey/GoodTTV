import { z } from "zod"
import type { ChatBatch, ChatOpenInput } from "./chat"

export const ClientIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]{20,64}$/)
  .brand<"ClientId">()

export const LoginSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_]{1,25}$/)
  .transform((login) => login.toLowerCase())

export const UserIdSchema = z.string().regex(/^[0-9]{1,20}$/)

export const CursorInputSchema = z.object({
  after: z.string().max(512).optional(),
  first: z.number().int().min(1).max(100).default(20),
})

export const LiveInputSchema = CursorInputSchema.extend({
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
})

export const SearchInputSchema = CursorInputSchema.extend({
  query: z.string().trim().min(1).max(100),
})

export const LoginsInputSchema = z.array(LoginSchema).max(100)

export const StreamCardSchema = z.object({
  category: z.string(),
  id: z.string(),
  profileImageUrl: z.url().optional(),
  startedAt: z.string(),
  tags: z.array(z.string()),
  thumbnailUrl: z.url(),
  title: z.string(),
  userId: z.string(),
  userLogin: z.string(),
  userName: z.string(),
  viewerCount: z.number().int().nonnegative(),
})

export const ChannelCardSchema = z.object({
  category: z.string(),
  displayName: z.string(),
  id: z.string(),
  isLive: z.boolean(),
  login: z.string(),
  thumbnailUrl: z.url(),
  title: z.string(),
})

export const PageSchema = <Item extends z.ZodType>(item: Item) =>
  z
    .object({
      cursor: z.string().optional(),
      items: z.array(item),
    })
    .transform((page) => ({ cursor: page.cursor, items: page.items }))

export const DeviceChallengeSchema = z.object({
  expiresAt: z.string(),
  flowId: z.string(),
  intervalSeconds: z.number().int().positive(),
  userCode: z.string(),
  verificationUri: z.url(),
})

const GuestAuthSchema = z.object({ kind: z.literal("guest") })
const AuthorizingAuthSchema = z.object({
  challenge: DeviceChallengeSchema,
  kind: z.literal("authorizing"),
})
const AuthenticatedAuthSchema = z.object({
  displayName: z.string(),
  kind: z.literal("authenticated"),
  login: z.string(),
  profileImageUrl: z.url().optional(),
})
const AuthErrorSchema = z.object({
  kind: z.literal("error"),
  message: z.string(),
})

export const AuthSnapshotSchema = z.discriminatedUnion("kind", [
  GuestAuthSchema,
  AuthorizingAuthSchema,
  AuthenticatedAuthSchema,
  AuthErrorSchema,
])

// What the app knows about its own configuration; never includes tokens.
export const AppStatusSchema = z.object({
  secureStorage: z.boolean(),
  version: z.string(),
  // Chromium's own verdict, e.g. "enabled" (hardware) or "unavailable_software".
  videoDecode: z.string().max(60),
})

export const RecentChannelSchema = z.strictObject({
  displayName: z.string().min(1).max(60),
  login: LoginSchema,
  profileImageUrl: z.url().max(512).optional(),
  userId: UserIdSchema.optional(),
  watchedAt: z.number().int().nonnegative(),
})
export const RECENTS_LIMIT = 20
export const RecentsListSchema = z.array(RecentChannelSchema).max(RECENTS_LIMIT)

// Lo último que se vio en Inicio con la cuenta vinculada, para enseñarlo nada más abrir mientras llega lo de ahora. Sin
// tokens: solo lo que se ve. Cada versión lo guarda a su manera (window.api.home).
export const SavedHomeSchema = z.object({
  account: AuthenticatedAuthSchema,
  following: z.array(StreamCardSchema).max(100), // loadHome pide 100
  popular: z.array(StreamCardSchema).max(100),
  recentLive: z.array(StreamCardSchema).max(RECENTS_LIMIT),
  recents: RecentsListSchema,
  savedAt: z.number().int().nonnegative(),
})

// Retraso del directo con el reproductor propio (variante privada, D11): «sin-paradas» deja un margen fijo que cubre
// las pausas globales; «adaptativo» lo deja solo tras la primera; «directo» no añade retraso ni rellena las pausas.
export const LatencyModeSchema = z.enum(["sin-paradas", "adaptativo", "directo"])
export type LatencyMode = z.infer<typeof LatencyModeSchema>

export const PreferencesSchema = z.strictObject({
  chatScale: z.enum(["normal", "large"]),
  chatVisible: z.boolean(),
  latencyMode: LatencyModeSchema,
})
export const PreferencesPatchSchema = PreferencesSchema.partial()

export const InputActionSchema = z.enum([
  "up",
  "down",
  "left",
  "right",
  "ok",
  "back",
  "play-pause",
  "play",
  "pause",
])

export const KeyProbeSchema = z.strictObject({
  action: InputActionSchema.nullable(),
  code: z.string().max(40),
  key: z.string().max(40),
})

export const PlayerInteractionEndSchema = z.enum(["back", "cancelled", "failed"])

export type AppStatus = z.infer<typeof AppStatusSchema>
export type AuthSnapshot = z.infer<typeof AuthSnapshotSchema>
export type ChannelCard = z.infer<typeof ChannelCardSchema>
export type ClientId = z.infer<typeof ClientIdSchema>
export type CursorInput = z.input<typeof CursorInputSchema>
export type DeviceChallenge = z.infer<typeof DeviceChallengeSchema>
export type InputAction = z.infer<typeof InputActionSchema>
export type KeyProbe = z.infer<typeof KeyProbeSchema>
export type LiveInput = z.input<typeof LiveInputSchema>
export type Page<Item> = {
  readonly cursor: string | undefined
  readonly items: readonly Item[]
}
export type PlayerInteractionEnd = z.infer<typeof PlayerInteractionEndSchema>
export type Preferences = z.infer<typeof PreferencesSchema>
export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>
export type RecentChannel = z.infer<typeof RecentChannelSchema>
export type SavedHome = z.infer<typeof SavedHomeSchema>
export type SearchInput = z.input<typeof SearchInputSchema>
export type StreamCard = z.infer<typeof StreamCardSchema>

// The only capability object the renderer receives. No tokens, URLs or generic methods.
export interface AppApi {
  readonly app: {
    readonly status: () => Promise<AppStatus>
  }
  readonly auth: {
    readonly begin: () => Promise<DeviceChallenge>
    readonly logout: () => Promise<void>
    readonly snapshot: () => Promise<AuthSnapshot>
  }
  readonly catalog: {
    readonly followed: (input: CursorInput) => Promise<Page<StreamCard>>
    readonly live: (input: LiveInput) => Promise<Page<StreamCard>>
    readonly search: (input: SearchInput) => Promise<Page<ChannelCard>>
    readonly streamsByLogin: (logins: readonly string[]) => Promise<readonly StreamCard[]>
  }
  readonly chat: {
    readonly close: () => Promise<void>
    readonly onBatch: (listener: (batch: ChatBatch) => void) => () => void
    readonly open: (input: ChatOpenInput) => Promise<number>
  }
  // Inicio de la última vez (SavedHomeSchema); null si no hay nada guardado.
  readonly home: {
    readonly forget: () => Promise<void>
    readonly save: (home: SavedHome) => Promise<void>
    readonly saved: () => Promise<SavedHome | null>
  }
  readonly input: {
    readonly onAction: (listener: (action: InputAction) => void) => () => void
    readonly onProbe: (listener: (probe: KeyProbe) => void) => () => void
    readonly setProbing: (active: boolean) => Promise<void>
    readonly setTextEntry: (active: boolean) => Promise<void>
  }
  readonly player: {
    readonly beginInteraction: () => Promise<number>
    readonly endInteraction: (id: number) => Promise<void>
    readonly onInteractionEnded: (
      listener: (id: number, reason: PlayerInteractionEnd) => void,
    ) => () => void
    readonly setWatching: (active: boolean) => Promise<void>
  }
  readonly preferences: {
    readonly get: () => Promise<Preferences>
    readonly update: (patch: PreferencesPatch) => Promise<Preferences>
  }
  readonly recents: {
    readonly add: (channel: RecentChannel) => Promise<readonly RecentChannel[]>
    readonly list: () => Promise<readonly RecentChannel[]>
  }
}
