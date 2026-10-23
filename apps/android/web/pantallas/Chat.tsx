import { CHAT_MESSAGE_MAX, type ChatEmote, type ChatEmoteGroups } from "@goodttv/contratos"
import {
  CHAT_STATUS_TEXT,
  type ChatView,
  insertAt,
  Message,
  replaceWord,
  suggestEmotes,
  useChatAtBottom,
  useChatCompose,
  useChatEmotes,
  wordAt,
} from "@goodttv/interfaz"
import { ArrowDownIcon, PaperPlaneRightIcon, SmileyIcon } from "@phosphor-icons/react"
import {
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { type EmoteDelChat, emoteDe, FichaEmote, ListaEmotes, Sugerencias } from "./Emotes"
import { useAtrasCierra } from "./rutas"

// El chat de solo lectura, con los mensajes y emotes (7TV, BTTV y FFZ) de la tele (@goodttv/interfaz). Baja solo con
// los mensajes nuevos si ya estabas abajo; si subes a leer, se queda donde estás y ofrece volver a los últimos. Va a la
// par de la imagen (useChat lo retrasa): mientras no ha salido nada, como en la tele, se dice por qué. Con la cuenta
// vinculada con permiso para escribir, una caja al pie (CHAT-1): lo enviado sale ya, sin esperar al retraso, y los
// emotes se ponen con «:» y dos letras o con la lista (Emotes.tsx). Mantener pulsado un emote del chat enseña su ficha.
// En un VOD (replay), el chat del vídeo, como se escribió en el directo (useReplayChat).
const STICK_PX = 32
const LARGA_MS = 450 // una pulsación larga
const MOVER_PX = 10 // si el dedo se mueve más, es que desplaza la lista

// si: se puede escribir; vincular: hay cuenta, pero sin el permiso (se vinculó antes de CHAT-1); no: sin cuenta.
export type Escritura = "si" | "vincular" | "no"

// Para poner un emote en la caja desde fuera (la ficha de un emote del chat).
type EscribirHandle = { readonly insert: (name: string) => void }

export const Chat = ({
  chat,
  replay = false,
  scale,
  writing,
}: {
  readonly chat: ChatView
  readonly replay?: boolean
  readonly scale: "large" | "normal"
  readonly writing: Escritura
}) => {
  const list = useRef<HTMLOListElement>(null)
  const stick = useRef(true)
  const alto = useRef(0) // el de la lista, para saber si un desplazamiento viene de que ha cambiado
  const [atBottom, setAtBottom] = useState(true)
  useChatAtBottom(list, chat.messages, stick)
  const { delay } = chat
  const waiting = chat.status === "connected" && chat.messages.length === 0
  const status = replay
    ? chat.status === "error"
      ? "No se pudo cargar el chat del vídeo."
      : chat.status === "connecting"
        ? "Cargando el chat del vídeo…"
        : undefined
    : (CHAT_STATUS_TEXT[chat.status] ??
      (waiting && delay === null ? "Sincronizando el chat con la imagen…" : undefined) ??
      (waiting && delay !== null && delay >= 5
        ? `El chat va a la par de la imagen: cada mensaje aparece unos ${delay} s después de llegar.`
        : undefined))
  // Lo propio sale abajo: la lista vuelve a seguir los mensajes nuevos.
  const onSent = useCallback(() => {
    stick.current = true
    setAtBottom(true)
  }, [])
  const { send } = chat
  const canWrite = writing === "si" && send !== undefined
  const composer = useRef<EscribirHandle>(null)

  // Mantener pulsado un emote: su ficha. Si el dedo se mueve, desplaza la lista (y el navegador cancela la pulsación).
  const [ficha, setFicha] = useState<EmoteDelChat | null>(null)
  const pulsacion = useRef<{
    readonly x: number
    readonly y: number
    readonly timer: number
  } | null>(null)
  const soltar = (): void => {
    if (pulsacion.current !== null) clearTimeout(pulsacion.current.timer)
    pulsacion.current = null
  }
  const onPointerDown = (event: ReactPointerEvent): void => {
    soltar()
    const element = event.target instanceof Element ? event.target.closest(".emote") : null
    if (element === null) return
    const timer = window.setTimeout(() => {
      pulsacion.current = null
      setFicha(emoteDe(element))
    }, LARGA_MS)
    pulsacion.current = { timer, x: event.clientX, y: event.clientY }
  }
  const onPointerMove = (event: ReactPointerEvent): void => {
    const empezada = pulsacion.current
    if (empezada === null) return
    if (Math.hypot(event.clientX - empezada.x, event.clientY - empezada.y) > MOVER_PX) soltar()
  }

  return (
    <section aria-label="Chat" className={`chat chat--${scale}`}>
      {status === undefined ? null : <p className="chat__estado">{status}</p>}
      <ol
        aria-live="off"
        className="chat__lista"
        // Sin el menú ni la selección de la imagen al mantener pulsado un emote.
        onContextMenu={(event) => {
          if (event.target instanceof Element && event.target.closest(".emote") !== null)
            event.preventDefault()
        }}
        onPointerCancel={soltar}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={soltar}
        // Al cambiar de alto (el teclado, la ficha que se aparta), Chrome desplaza la lista sin que la persona lo haga: si
        // iba abajo, sigue abajo (useChatAtBottom la baja).
        onScroll={(event) => {
          const element = event.currentTarget
          if (element.clientHeight !== alto.current) {
            alto.current = element.clientHeight
            if (stick.current) return
          }
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_PX
          setAtBottom(stick.current)
        }}
        ref={list}
      >
        {chat.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </ol>
      {atBottom ? null : (
        <div className="chat__ultimos">
          <button
            onClick={() => {
              const element = list.current
              if (element !== null) element.scrollTop = element.scrollHeight
            }}
            type="button"
          >
            <ArrowDownIcon aria-hidden="true" size={16} />
            Últimos mensajes
          </button>
        </div>
      )}
      {canWrite ? (
        <Escribir emotes={chat.emotes} handle={composer} onSent={onSent} send={send} />
      ) : writing === "vincular" ? (
        <p className="chat__nota">
          Para escribir, vuelve a vincular la cuenta (el avatar, arriba).
        </p>
      ) : null}
      {ficha === null ? null : (
        <FichaEmote
          emote={ficha}
          onCerrar={() => setFicha(null)}
          onEscribir={canWrite ? (name) => composer.current?.insert(name) : undefined}
        />
      )}
    </section>
  )
}

// La caja para escribir: el botón o «Enviar» en el teclado (useChatCompose). Los emotes se piden la primera vez que se
// va a escribir (al tocar la caja o la cara), no al abrir el canal.
const Escribir = ({
  emotes,
  handle,
  onSent,
  send,
}: {
  readonly emotes: (() => Promise<ChatEmoteGroups>) | undefined
  readonly handle: Ref<EscribirHandle>
  readonly onSent: () => void
  readonly send: (text: string) => Promise<string | null>
}) => {
  const { change, error, submit, text } = useChatCompose(send, onSent)
  const input = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [picking, setPicking] = useState(false)
  useAtrasCierra(picking, () => setPicking(false))
  const groups = useChatEmotes(emotes, focused || picking)
  const [caret, setCaret] = useState(0)

  // El cursor, donde quedó lo puesto, tras pintar el texto nuevo (React lo dejaría al final).
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === null) return
    pendingCaret.current = null
    input.current?.setSelectionRange(at, at)
  }, [text])
  const apply = (next: { readonly caret: number; readonly text: string }): void => {
    setCaret(next.caret)
    pendingCaret.current = next.caret
    change(next.text)
  }
  // Con la caja sin foco (la lista abierta), donde estaba el cursor: Android no conserva la selección de la caja.
  const insert = (name: string): void =>
    apply(
      insertAt(
        text,
        document.activeElement === input.current
          ? (input.current?.selectionStart ?? text.length)
          : Math.min(caret, text.length),
        name,
      ),
    )
  useImperativeHandle(handle, () => ({
    insert: (name: string) => {
      insert(name)
      setPicking(false)
      input.current?.focus()
    },
  }))

  // «:» y dos letras: las sugerencias, encima de la caja.
  const word = wordAt(text, caret)
  const suggestions = focused && word.text.startsWith(":") ? suggestEmotes(groups, word.text) : []
  const pick = (emote: ChatEmote): void => apply(replaceWord(text, word, emote.name))

  return (
    <>
      {picking ? <ListaEmotes groups={groups} onElegir={(emote) => insert(emote.name)} /> : null}
      <form
        className="chat__escribir"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {error === null ? null : (
          <p className="chat__error" role="alert">
            {error}
          </p>
        )}
        {suggestions.length === 0 ? null : <Sugerencias emotes={suggestions} onElegir={pick} />}
        <div className="chat__caja">
          <input
            aria-label="Enviar un mensaje"
            autoComplete="off"
            enterKeyHint="send"
            maxLength={CHAT_MESSAGE_MAX}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              const { selectionStart, value } = event.currentTarget
              setCaret(selectionStart ?? value.length)
              change(value)
            }}
            // Escribir cierra la lista: el teclado ocupa su sitio.
            onFocus={() => {
              setFocused(true)
              setPicking(false)
            }}
            onSelect={(event) => {
              if (document.activeElement === event.currentTarget)
                setCaret(event.currentTarget.selectionStart ?? 0)
            }}
            placeholder="Enviar un mensaje"
            ref={input}
            spellCheck
            value={text}
          />
          <button
            aria-expanded={picking}
            aria-label="Emotes"
            className="boton-icono"
            // Abrir la lista cierra el teclado, para que quepa.
            onClick={() => {
              if (!picking) input.current?.blur()
              setPicking(!picking)
            }}
            type="button"
          >
            <SmileyIcon aria-hidden="true" weight={picking ? "fill" : "regular"} />
          </button>
          <button
            aria-label="Enviar"
            className="boton-icono"
            disabled={text.trim() === ""}
            onMouseDown={(event) => event.preventDefault()}
            type="submit"
          >
            <PaperPlaneRightIcon aria-hidden="true" weight="fill" />
          </button>
        </div>
      </form>
    </>
  )
}
