import { CHAT_STATUS_TEXT, type ChatView, Message, useChatAtBottom } from "@goodttv/interfaz"
import { useRef } from "react"

// Chat de solo lectura junto al vídeo, con los mensajes y emotes de la tele (@goodttv/interfaz). Baja solo con los
// mensajes nuevos si ya estabas abajo; si subiste a leer, se queda donde estás.
const STICK_PX = 32

export const ChatPanel = ({
  chat,
  scale,
}: {
  readonly chat: ChatView
  readonly scale: "large" | "normal"
}) => {
  const list = useRef<HTMLOListElement>(null)
  const stick = useRef(true)
  useChatAtBottom(list, chat.messages, stick)
  const status = CHAT_STATUS_TEXT[chat.status]
  return (
    <aside aria-label="Chat" className={`chat chat--${scale}`}>
      <header className="chat__head">Chat del directo</header>
      {status === undefined ? null : <p className="chat__status">{status}</p>}
      <ol
        aria-live="off"
        className="chat__list"
        onScroll={(event) => {
          const element = event.currentTarget
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_PX
        }}
        ref={list}
      >
        {chat.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </ol>
      <footer className="chat__foot">
        {chat.status === "connected" && chat.delay !== null && chat.delay >= 1
          ? `Solo lectura. Va ${chat.delay} s por detrás, como la imagen.`
          : "Solo lectura."}
      </footer>
    </aside>
  )
}
