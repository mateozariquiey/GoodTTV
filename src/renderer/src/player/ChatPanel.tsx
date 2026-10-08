import { useLayoutEffect, useRef } from "react"
import type { ChatEmote, ChatMessage, ChatToken } from "../../../shared/chat"
import type { ChatState } from "./useChat"

const STATUS_TEXT: Record<ChatState["status"], string | undefined> = {
  connected: undefined,
  connecting: "Conectando con el chat…",
  error: "No se pudo conectar con el chat. Se reintentará al cambiar de canal.",
  "missing-scope": "Vuelve a vincular la cuenta en Ajustes para leer el chat.",
  off: "Vincula tu cuenta en Ajustes para leer el chat.",
  reconnecting: "Reconectando con el chat…",
  unauthenticated: "Vincula tu cuenta en Ajustes para leer el chat.",
}

const EmoteImage = ({
  emote,
  overlay = false,
}: {
  readonly emote: ChatEmote
  readonly overlay?: boolean
}) => (
  <img
    alt={overlay ? "" : emote.name}
    className={overlay ? "emote__overlay" : "emote__image"}
    decoding="async"
    draggable={false}
    src={emote.url}
    style={
      emote.width !== undefined && emote.height !== undefined
        ? { aspectRatio: `${emote.width} / ${emote.height}` }
        : undefined
    }
  />
)

const Token = ({ token }: { readonly token: ChatToken }) => {
  if (token.kind === "text") return <>{token.text}</>
  if (token.kind === "mention") return <span className="mention">{token.text}</span>
  return (
    <span className="emote" title={token.emote.name}>
      <EmoteImage emote={token.emote} />
      {token.overlays.map((overlay, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: overlays are fixed per message.
        <EmoteImage emote={overlay} key={index} overlay />
      ))}
    </span>
  )
}

const Message = ({ message }: { readonly message: ChatMessage }) => (
  <li className={`message${message.action ? " message--action" : ""}`}>
    {message.replyTo === undefined ? null : (
      <span className="message__reply">↪ a @{message.replyTo}</span>
    )}
    {message.badges.map((badge) => (
      <img
        alt={badge.title}
        className="badge"
        key={badge.url}
        src={badge.url}
        title={badge.title}
      />
    ))}
    <span className="message__name" style={{ color: message.color }}>
      {message.displayName}
    </span>
    {message.action ? " " : ": "}
    <span className="message__text" style={message.action ? { color: message.color } : undefined}>
      {message.tokens.map((token, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tokens are an immutable sequence.
        <Token key={index} token={token} />
      ))}
    </span>
  </li>
)

// Read-only chat beside the video. Never over it: Twitch requires the player unobscured.
export const ChatPanel = ({
  chat,
  scale,
}: {
  readonly chat: ChatState
  readonly scale: "normal" | "large"
}) => {
  const list = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => {
    const element = list.current
    if (element !== null) element.scrollTop = element.scrollHeight
  })
  const status = STATUS_TEXT[chat.status]
  return (
    <aside aria-label="Chat" className={`chat chat--${scale}`}>
      <header className="chat__header">
        <h2>Chat</h2>
        <span className="chat__providers">7TV · BTTV · FFZ</span>
      </header>
      {status === undefined ? null : <p className="chat__status">{status}</p>}
      <ol aria-live="off" className="chat__messages" ref={list}>
        {chat.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </ol>
      <footer className="chat__footer">Solo lectura</footer>
    </aside>
  )
}
