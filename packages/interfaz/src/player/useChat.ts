import type { ChatBatch, ChatEvent, ChatMessage, ChatStatus } from "@goodttv/contratos"
import { useEffect, useRef, useState } from "react"

export const CHAT_HISTORY = 150

export type ChatState = {
  readonly messages: readonly ChatMessage[]
  readonly status: ChatStatus | "off"
}

// What the panel shows: the chat plus how many seconds it is being held to match the picture (rounded; null while
// not known yet).
export type ChatView = ChatState & { readonly delay: number | null }

export const applyChatEvents = (state: ChatState, events: readonly ChatEvent[]): ChatState => {
  let messages = [...state.messages]
  let status = state.status
  for (const event of events) {
    switch (event.kind) {
      case "message":
        messages.push(event.message)
        break
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
export const useChat = (
  broadcasterId: string | undefined,
  enabled: boolean,
  delay: () => number | null = () => 0,
): ChatView => {
  const [state, setState] = useState<ChatState>({ messages: [], status: "off" })
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

  useEffect(() => {
    if (!enabled) return undefined
    return () => {
      void window.api.chat.close()
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || broadcasterId === undefined) {
      setState({ messages: [], status: "off" })
      // A channel opened by name has no id for chat: stop reading the previous one.
      if (enabled) void window.api.chat.close()
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
    setState({ messages: [], status: "connecting" })
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
  }, [broadcasterId, enabled])

  return { ...state, delay: held }
}
