import type { ChatEmote, ChatMessage, ChatToken } from "@goodttv/contratos"
import { memo, useRef } from "react"
import type { ChatState, ChatView } from "./useChat"
import { useChatAtBottom } from "./useChatAtBottom"

export const CHAT_STATUS_TEXT: Record<ChatState["status"], string | undefined> = {
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

// Memoizado: cada lote del chat (cada 100 ms) solo pinta los mensajes nuevos, no los 150 de la lista.
export const Message = memo(({ message }: { readonly message: ChatMessage }) => (
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
))

// Read-only chat beside the video. Never over it: Twitch requires the player unobscured.
export const ChatPanel = ({
  chat,
  scale,
}: {
  readonly chat: ChatView
  readonly scale: "normal" | "large"
}) => {
  const list = useRef<HTMLOListElement>(null)
  useChatAtBottom(list, chat.messages)
  // With the own player, chat waits for the picture (D11): say so, above all while nothing has appeared yet.
  const { delay } = chat
  const waiting = chat.status === "connected" && chat.messages.length === 0
  const status =
    CHAT_STATUS_TEXT[chat.status] ??
    (waiting && delay === null ? "Sincronizando el chat con la imagen…" : undefined) ??
    (waiting && delay !== null && delay >= 5
      ? `El chat va a la par de la imagen: cada mensaje aparece unos ${delay} s después de llegar.`
      : undefined)
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
      <footer className="chat__footer">
        {chat.status === "connected" && delay !== null && delay >= 1
          ? `Solo lectura · a la par de la imagen (−${delay} s)`
          : "Solo lectura"}
      </footer>
    </aside>
  )
}
