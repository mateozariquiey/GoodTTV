import { z } from "zod"
import {
  type ChatBadge,
  type ChatBatch,
  type ChatEmote,
  type ChatEvent,
  ChatEventSchema,
  type ChatStatus,
} from "../../shared/chat"
import { type EmoteLookup, readableUserColor, tokenizeFragments } from "./tokenize"

// Reads chat through EventSub over WebSocket. One socket serves the open channel; switching
// channel swaps subscriptions on the same session. Tokens stay in main: the renderer only
// receives tokenized messages.

export const CHAT_SCOPE = "user:read:chat"
const SUBSCRIPTION_TYPES = [
  "channel.chat.message",
  "channel.chat.message_delete",
  "channel.chat.clear_user_messages",
  "channel.chat.clear",
] as const
const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30"
const FLUSH_MS = 100
const MAX_BACKOFF_MS = 30_000
// Bounds for a very busy chat while emotes load or the renderer lags: older chat lines are
// dropped first; moderation and status events are always kept.
const MAX_PENDING_MESSAGES = 300
const MAX_QUEUED_EVENTS = 600

export class ChatScopeError extends Error {
  public constructor() {
    super(`The Twitch session lacks ${CHAT_SCOPE}`)
    this.name = "ChatScopeError"
  }
}

export type ChatSocket = {
  readonly addEventListener: (
    type: "close" | "error" | "message",
    listener: (event: { readonly data?: unknown }) => void,
  ) => void
  readonly close: () => void
}

export type ChatApi = {
  readonly badges: (broadcasterId: string) => Promise<ReadonlyMap<string, ChatBadge>>
  readonly emotes: (broadcasterId: string) => Promise<EmoteLookup>
  // Undefined when nobody is signed in; rejects on transient failures (network, Twitch down).
  readonly viewer: () => Promise<
    { readonly scopes: readonly string[]; readonly userId: string } | undefined
  >
  readonly subscribe: (
    type: string,
    broadcasterId: string,
    userId: string,
    sessionId: string,
  ) => Promise<string>
  readonly unsubscribe: (subscriptionId: string) => Promise<void>
}

export type ChatOptions = {
  readonly api: ChatApi
  readonly createSocket?: (url: string) => ChatSocket
  readonly emit: (batch: ChatBatch) => void
}

const EnvelopeSchema = z.object({
  metadata: z.object({ message_type: z.string(), subscription_type: z.string().optional() }),
  payload: z.unknown(),
})
const WelcomeSchema = z.object({
  session: z.object({
    id: z.string().min(1),
    keepalive_timeout_seconds: z.number().int().positive().nullable().optional(),
    reconnect_url: z.string().nullable().optional(),
  }),
})
const NotificationSchema = z.object({ event: z.record(z.string(), z.unknown()) })
const MessageEventSchema = z.object({
  badges: z.array(z.object({ id: z.string(), set_id: z.string() })).default([]),
  broadcaster_user_id: z.string(),
  chatter_user_id: z.string(),
  chatter_user_login: z.string(),
  chatter_user_name: z.string(),
  color: z.string().default(""),
  message: z.object({
    fragments: z.array(
      z.object({
        emote: z.object({ id: z.string() }).nullable().optional(),
        text: z.string(),
        type: z.string(),
      }),
    ),
    text: z.string(),
  }),
  message_id: z.string(),
  reply: z.object({ parent_user_name: z.string() }).nullable().optional(),
})
const TargetedEventSchema = z.object({
  broadcaster_user_id: z.string(),
  message_id: z.string().optional(),
  target_user_id: z.string().optional(),
})

// Every socket belongs to a generation. Closing chat or giving up on a connection starts a new
// generation, so nothing from an older socket (including a half-done reconnect) can come back.
type Socket = { readonly generation: number; readonly socket: ChatSocket; sessionId?: string }

export class EventSubChat {
  readonly #api: ChatApi
  readonly #createSocket: (url: string) => ChatSocket
  readonly #emit: (batch: ChatBatch) => void
  #session = 0
  #generation = 0
  #broadcasterId: string | undefined
  #viewerId: string | undefined
  #socket: Socket | undefined
  #replacement: Socket | undefined
  #subscriptions: string[] = []
  #queue: ChatEvent[] = []
  #flushTimer: ReturnType<typeof setTimeout> | undefined
  #watchdog: ReturnType<typeof setTimeout> | undefined
  #retryTimer: ReturnType<typeof setTimeout> | undefined
  #keepaliveMs = 40_000
  #failures = 0
  #pending: Promise<void> = Promise.resolve()
  #pendingMessages = 0

  public constructor(options: ChatOptions) {
    this.#api = options.api
    this.#createSocket =
      options.createSocket ?? ((url) => new WebSocket(url) as unknown as ChatSocket)
    this.#emit = options.emit
  }

  // Starts reading a channel and returns the session the renderer must match. With a live
  // connection, switching channel only swaps the subscriptions.
  public open(broadcasterId: string): number {
    this.#session += 1
    const session = this.#session
    this.#broadcasterId = broadcasterId
    this.#queue = []
    clearTimeout(this.#retryTimer)
    // Warm the per-channel caches while the socket connects.
    void this.#api.emotes(broadcasterId).catch(() => undefined)
    void this.#api.badges(broadcasterId).catch(() => undefined)
    this.#status("connecting")
    void this.#start(session)
    return session
  }

  public close(): void {
    this.#session += 1
    this.#broadcasterId = undefined
    this.#queue = []
    clearTimeout(this.#flushTimer)
    this.#flushTimer = undefined
    clearTimeout(this.#retryTimer)
    this.#dropSubscriptions()
    this.#invalidateSockets()
  }

  async #start(session: number): Promise<void> {
    let viewer: Awaited<ReturnType<ChatApi["viewer"]>>
    try {
      viewer = await this.#api.viewer()
    } catch {
      // Network or Twitch trouble while validating the token: keep trying with backoff.
      if (session === this.#session) this.#scheduleReconnect()
      return
    }
    if (session !== this.#session) return
    if (viewer === undefined) {
      this.#status("unauthenticated")
      return
    }
    if (!viewer.scopes.includes(CHAT_SCOPE)) {
      this.#status("missing-scope")
      return
    }
    this.#viewerId = viewer.userId
    const socket = this.#socket
    if (socket === undefined) {
      this.#connect(EVENTSUB_URL, "primary")
      return
    }
    // Still waiting for the welcome: it will subscribe for the current channel.
    if (socket.sessionId !== undefined) await this.#resubscribe(session, socket)
  }

  #connect(url: string, role: "primary" | "replacement"): void {
    const current: Socket = { generation: this.#generation, socket: this.#createSocket(url) }
    if (role === "primary") {
      this.#socket = current
      // A socket that never says anything is as dead as one that stops talking.
      this.#armWatchdog()
    } else {
      this.#replacement?.socket.close()
      this.#replacement = current
    }
    current.socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") this.#onMessage(current, event.data)
    })
    current.socket.addEventListener("close", () => this.#onClose(current))
  }

  #isLive(current: Socket): boolean {
    return (
      current.generation === this.#generation &&
      (current === this.#socket || current === this.#replacement)
    )
  }

  #onMessage(current: Socket, raw: string): void {
    if (!this.#isLive(current)) return
    let envelope: z.infer<typeof EnvelopeSchema>
    try {
      envelope = EnvelopeSchema.parse(JSON.parse(raw))
    } catch {
      return
    }
    this.#armWatchdog()
    const type = envelope.metadata.message_type
    if (type === "session_welcome") {
      const welcome = WelcomeSchema.safeParse(envelope.payload)
      if (!welcome.success) return
      current.sessionId = welcome.data.session.id
      const keepalive = welcome.data.session.keepalive_timeout_seconds
      if (keepalive != null) this.#keepaliveMs = (keepalive + 10) * 1000
      if (current === this.#replacement) {
        // Twitch moved us: subscriptions carry over to the new socket.
        const previous = this.#socket
        this.#socket = current
        this.#replacement = undefined
        previous?.socket.close()
        this.#status("connected")
        return
      }
      void this.#resubscribe(this.#session, current)
      return
    }
    if (type === "session_reconnect" && current === this.#socket) {
      const url = WelcomeSchema.safeParse(envelope.payload).data?.session.reconnect_url
      if (typeof url === "string" && url.startsWith("wss://")) this.#connect(url, "replacement")
      return
    }
    if (type === "revocation") {
      this.#status("error")
      return
    }
    if (type === "notification" && current === this.#socket) {
      const notification = NotificationSchema.safeParse(envelope.payload)
      const subscription = envelope.metadata.subscription_type
      if (notification.success && subscription !== undefined) {
        this.#onNotification(subscription, notification.data.event)
      }
    }
  }

  #onNotification(subscription: string, event: Record<string, unknown>): void {
    const broadcasterId = this.#broadcasterId
    if (broadcasterId === undefined || event["broadcaster_user_id"] !== broadcasterId) return
    const session = this.#session
    if (subscription === "channel.chat.message") {
      const parsed = MessageEventSchema.safeParse(event)
      // Too far behind (slow emote providers, a flood): skip chat lines rather than grow.
      if (!parsed.success || this.#pendingMessages >= MAX_PENDING_MESSAGES) return
      this.#pendingMessages += 1
      // Keep arrival order while the channel's emotes and badges finish loading.
      this.#pending = this.#pending.then(async () => {
        try {
          if (session !== this.#session) return
          const [emotes, badges] = await Promise.all([
            this.#api.emotes(broadcasterId).catch(() => new Map<string, ChatEmote>()),
            this.#api.badges(broadcasterId).catch(() => new Map<string, ChatBadge>()),
          ])
          if (session !== this.#session) return
          this.#push(messageEvent(parsed.data, emotes, badges))
        } finally {
          this.#pendingMessages -= 1
        }
      })
      return
    }
    const target = TargetedEventSchema.safeParse(event)
    if (!target.success) return
    this.#pending = this.#pending.then(() => {
      if (session !== this.#session) return
      if (subscription === "channel.chat.clear") this.#push({ kind: "clear" })
      if (subscription === "channel.chat.message_delete" && target.data.message_id !== undefined) {
        this.#push({ kind: "delete", messageId: target.data.message_id })
      }
      if (
        subscription === "channel.chat.clear_user_messages" &&
        target.data.target_user_id !== undefined
      ) {
        this.#push({ kind: "clear-user", userId: target.data.target_user_id })
      }
    })
  }

  async #resubscribe(session: number, socket: Socket): Promise<void> {
    const broadcasterId = this.#broadcasterId
    const viewerId = this.#viewerId
    const sessionId = socket.sessionId
    if (broadcasterId === undefined || viewerId === undefined || sessionId === undefined) return
    this.#dropSubscriptions()
    const results = await Promise.allSettled(
      SUBSCRIPTION_TYPES.map((type) =>
        this.#api.subscribe(type, broadcasterId, viewerId, sessionId),
      ),
    )
    const ids = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    const failure = results.find((result) => result.status === "rejected")
    const current = session === this.#session && socket === this.#socket && this.#isLive(socket)
    if (!current || failure !== undefined) {
      // Never keep half a set of subscriptions, or ones for a channel no longer shown.
      for (const id of ids) void this.#api.unsubscribe(id).catch(() => undefined)
    }
    if (!current) return
    if (failure !== undefined) {
      if (failure.reason instanceof ChatScopeError) {
        this.#invalidateSockets()
        this.#status("missing-scope")
        return
      }
      this.#scheduleReconnect()
      return
    }
    this.#subscriptions = ids
    this.#failures = 0
    this.#status("connected")
  }

  #onClose(closed: Socket): void {
    if (closed === this.#replacement) {
      this.#replacement = undefined
      return
    }
    if (closed !== this.#socket) return
    this.#socket = undefined
    this.#subscriptions = []
    clearTimeout(this.#watchdog)
    if (this.#broadcasterId !== undefined) this.#scheduleReconnect()
  }

  #scheduleReconnect(): void {
    this.#invalidateSockets()
    this.#status("reconnecting")
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.#failures)
    this.#failures += 1
    clearTimeout(this.#retryTimer)
    const session = this.#session
    this.#retryTimer = setTimeout(() => {
      if (session === this.#session && this.#socket === undefined) void this.#start(session)
    }, delay)
  }

  #armWatchdog(): void {
    clearTimeout(this.#watchdog)
    // Notifications and keepalives reset the timer; silence beyond it means a dead socket.
    this.#watchdog = setTimeout(() => {
      if (this.#broadcasterId !== undefined) this.#scheduleReconnect()
    }, this.#keepaliveMs)
  }

  #dropSubscriptions(): void {
    for (const id of this.#subscriptions) void this.#api.unsubscribe(id).catch(() => undefined)
    this.#subscriptions = []
  }

  #invalidateSockets(): void {
    this.#generation += 1
    clearTimeout(this.#watchdog)
    const sockets = [this.#socket, this.#replacement]
    this.#socket = undefined
    this.#replacement = undefined
    this.#subscriptions = []
    for (const socket of sockets) socket?.socket.close()
  }

  #status(status: ChatStatus): void {
    this.#push({ kind: "status", status })
  }

  #push(event: ChatEvent): void {
    // Validate here so one malformed message can never make the renderer reject a batch.
    const parsed = ChatEventSchema.safeParse(event)
    if (!parsed.success) return
    this.#queue.push(parsed.data)
    if (this.#queue.length > MAX_QUEUED_EVENTS) {
      const oldestLine = this.#queue.findIndex((queued) => queued.kind === "message")
      if (oldestLine >= 0) this.#queue.splice(oldestLine, 1)
    }
    this.#scheduleFlush()
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== undefined) return
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined
      const events = this.#queue.splice(0, 500)
      if (events.length > 0) this.#emit({ events, session: this.#session })
      if (this.#queue.length > 0) this.#scheduleFlush()
    }, FLUSH_MS)
  }
}

const ACTION_MARK = String.fromCharCode(1)
const ACTION_PREFIX = `${ACTION_MARK}ACTION `

export const messageEvent = (
  event: z.infer<typeof MessageEventSchema>,
  emotes: EmoteLookup,
  badges: ReadonlyMap<string, ChatBadge>,
): ChatEvent => {
  // "/me" messages may arrive wrapped in CTCP ACTION markers; render them in italics.
  const action = event.message.text.startsWith(ACTION_PREFIX)
  const last = event.message.fragments.length - 1
  const fragments = action
    ? event.message.fragments.map((fragment, index) => {
        let text = fragment.text
        if (index === 0 && text.startsWith(ACTION_PREFIX)) text = text.slice(ACTION_PREFIX.length)
        if (index === last && text.endsWith(ACTION_MARK)) text = text.slice(0, -1)
        return { ...fragment, text }
      })
    : event.message.fragments
  return {
    kind: "message",
    message: {
      action,
      badges: event.badges
        .flatMap((badge) => badges.get(`${badge.set_id}/${badge.id}`) ?? [])
        .slice(0, 8),
      color: readableUserColor(event.color, event.chatter_user_id),
      displayName: event.chatter_user_name.slice(0, 60) || event.chatter_user_login,
      id: event.message_id,
      ...(event.reply?.parent_user_name === undefined
        ? {}
        : { replyTo: event.reply.parent_user_name.slice(0, 60) }),
      tokens: tokenizeFragments(fragments, emotes).slice(0, 600),
      userId: event.chatter_user_id,
    },
  }
}
