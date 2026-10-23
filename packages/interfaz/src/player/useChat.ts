import type {
  ChatBatch,
  ChatEmoteGroups,
  ChatEvent,
  ChatMessage,
  ChatStatus,
} from "@goodttv/contratos"
import { useCallback, useEffect, useRef, useState } from "react"
import { NO_EMOTES } from "./emote-complete"

export const CHAT_HISTORY = 150

export type ChatState = {
  readonly messages: readonly ChatMessage[]
  readonly status: ChatStatus | "off"
}

// What the panel shows: the chat plus how many seconds it is being held to match the picture (rounded; null while
// not known yet). send, where one can write (not on the TV, D24): resolves with null once sent, or with the reason
// it was not; emotes, the ones that can be written in this channel.
export type ChatView = ChatState & {
  readonly delay: number | null
  readonly emotes?: () => Promise<ChatEmoteGroups>
  readonly send?: (text: string) => Promise<string | null>
}

export const applyChatEvents = (state: ChatState, events: readonly ChatEvent[]): ChatState => {
  let messages = [...state.messages]
  let status = state.status
  for (const event of events) {
    switch (event.kind) {
      case "message": {
        // One's own message is shown as soon as it is sent; the copy from EventSub, with badges and Twitch emotes,
        // takes its place.
        let index = messages.length - 1
        while (index >= 0 && messages[index]?.id !== event.message.id) index--
        if (index >= 0) messages[index] = event.message
        else messages.push(event.message)
        break
      }
      case "delete":
        messages = messages.filter((message) => message.id !== event.messageId)
        break
      case "clear-user":
        messages = messages.filter((message) => message.userId !== event.userId)
        break
      case "clear":
        messages = []
        break
      case "status":
        status = event.status
        break
    }
  }
  return { messages: messages.slice(-CHAT_HISTORY), status }
}

// Most chat events held at once (~100 s of a very busy chat). A long pause makes the delay grow without end; past
// this, the oldest held events are dropped, as they would scroll out of the history anyway when released.
export const CHAT_MAX_HELD = 3000

// Holds chat events so chat stays in step with a delayed picture: each batch is shown delay() seconds after it
// arrived (delay is read when releasing, so it follows the picture as it changes). Order is kept. delay() null =
// not known yet (the picture is starting): hold everything until it is.
export class ChatDelayQueue {
  readonly #held: { readonly at: number; readonly events: readonly ChatEvent[] }[] = []
  #count = 0

  constructor(private readonly delay: () => number | null) {}

  push(events: readonly ChatEvent[], at = Date.now()): void {
    this.#held.push({ at, events })
    this.#count += events.length
    while (this.#count > CHAT_MAX_HELD && this.#held.length > 1)
      this.#count -= this.#held.shift()?.events.length ?? 0
  }

  due(now = Date.now()): ChatEvent[] {
    const delay = this.delay()
    if (delay === null) return []
    const limit = now - delay * 1000
    let count = 0
    while (
      count < this.#held.length &&
      (this.#held[count]?.at ?? Number.POSITIVE_INFINITY) <= limit
    )
      count++
    const events = this.#held.splice(0, count).flatMap((entry) => entry.events)
    this.#count -= events.length
    return events
  }
}

// Reads chat for a channel while enabled. One connection serves the whole visit: changing channel
// only re-opens (main swaps the subscriptions); hiding chat or leaving playback closes it.
// Batches from an older session (previous channel) are dropped; batches that arrive before main
// answers with the session number wait for it.
// delay(): seconds to hold chat events so chat stays in step with a delayed picture (own player, D11), or null
// while not known. Events keep their order; connection status is never delayed.
// connected: false closes the connection but keeps the messages (a hidden tab in the extension, so that several tabs
// do not use up EventSub's three connections); back to true, it reconnects and goes on from them.
export const useChat = (
  broadcasterId: string | undefined,
  enabled: boolean,
  delay: () => number | null = () => 0,
  connected = true,
): ChatView => {
  const [state, setState] = useState<ChatState>({ messages: [], status: "off" })
  const shown = useRef<string | undefined>(undefined) // the channel whose messages are on screen
  const delayRef = useRef(delay)
  delayRef.current = delay
  const [held, setHeld] = useState<number | null>(0)

  useEffect(() => {
    if (!enabled) return undefined
    const sample = (): void => {
      const seconds = delayRef.current()
      setHeld(seconds === null ? null : Math.round(seconds))
    }
    sample()
    const timer = setInterval(sample, 1000)
    return () => clearInterval(timer)
  }, [enabled])

  const live = enabled && connected
  useEffect(() => {
    if (!live) return undefined
    return () => {
      void window.api.chat.close()
    }
  }, [live])

  useEffect(() => {
    if (enabled && !connected && broadcasterId === shown.current) return undefined // paused: keep what is shown
    if (!enabled || broadcasterId === undefined) {
      shown.current = undefined
      setState({ messages: [], status: "off" })
      // A channel opened by name has no id for chat: stop reading the previous one.
      if (enabled) void window.api.chat.close()
      return undefined
    }
    if (!connected) {
      shown.current = undefined
      setState({ messages: [], status: "off" })
      return undefined
    }
    let session: number | undefined
    let active = true
    const early: ChatBatch[] = []
    const queue = new ChatDelayQueue(() => delayRef.current())
    const release = (): void => {
      const events = queue.due()
      if (events.length > 0) setState((current) => applyChatEvents(current, events))
    }
    const timer = setInterval(release, 250)
    const apply = (batch: ChatBatch): void => {
      if (batch.session !== session) return
      const status = batch.events.filter((event) => event.kind === "status")
      if (status.length > 0) setState((current) => applyChatEvents(current, status))
      const events = batch.events.filter((event) => event.kind !== "status")
      if (events.length === 0) return
      queue.push(events)
      release()
    }
    // Back from a pause on the same channel, the messages stay and the new ones follow them.
    if (shown.current === broadcasterId)
      setState((current) => ({ ...current, status: "connecting" }))
    else setState({ messages: [], status: "connecting" })
    shown.current = broadcasterId
    const unsubscribe = window.api.chat.onBatch((batch) => {
      if (session === undefined) early.push(batch)
      else apply(batch)
    })
    window.api.chat
      .open({ broadcasterId })
      .then((opened) => {
        if (!active) return
        session = opened
        for (const batch of early.splice(0)) apply(batch)
      })
      .catch(() => {
        if (active) setState({ messages: [], status: "error" })
      })
    return () => {
      active = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [broadcasterId, connected, enabled])

  const send = useCallback(
    async (text: string): Promise<string | null> => {
      const write = window.api.chat.send
      if (write === undefined || broadcasterId === undefined) return "Aquí no se puede escribir."
      try {
        const result = await write({ broadcasterId, message: text })
        if (!result.sent) return result.reason
        // Sin esperar a la cola del retraso: lo propio sale ya. Si la copia de EventSub ya llegó, se queda esa.
        if (shown.current === broadcasterId) {
          setState((current) =>
            current.messages.some((message) => message.id === result.message.id)
              ? current
              : applyChatEvents(current, [{ kind: "message", message: result.message }]),
          )
        }
        return null
      } catch {
        return "No se pudo enviar. Inténtalo otra vez."
      }
    },
    [broadcasterId],
  )

  const emotes = useCallback(async (): Promise<ChatEmoteGroups> => {
    const list = window.api.chat.emotes
    if (list === undefined || broadcasterId === undefined) return NO_EMOTES
    return list({ broadcasterId })
  }, [broadcasterId])

  return {
    ...state,
    delay: held,
    ...(window.api.chat.send === undefined ? {} : { send }),
    ...(window.api.chat.emotes === undefined ? {} : { emotes }),
  }
}
