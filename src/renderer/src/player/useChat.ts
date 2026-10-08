import { useEffect, useState } from "react"
import type { ChatBatch, ChatEvent, ChatMessage, ChatStatus } from "../../../shared/chat"

export const CHAT_HISTORY = 150

export type ChatState = {
  readonly messages: readonly ChatMessage[]
  readonly status: ChatStatus | "off"
}

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

// Reads chat for a channel while enabled. One connection serves the whole visit: changing channel
// only re-opens (main swaps the subscriptions); hiding chat or leaving playback closes it.
// Batches from an older session (previous channel) are dropped; batches that arrive before main
// answers with the session number wait for it.
export const useChat = (broadcasterId: string | undefined, enabled: boolean): ChatState => {
  const [state, setState] = useState<ChatState>({ messages: [], status: "off" })

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
    const apply = (batch: ChatBatch): void => {
      if (batch.session !== session) return
      setState((current) => applyChatEvents(current, batch.events))
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
      unsubscribe()
    }
  }, [broadcasterId, enabled])

  return state
}
