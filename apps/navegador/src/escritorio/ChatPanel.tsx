import type { ChatEmote } from "@goodttv/contratos"
import { CHAT_STATUS_TEXT, type ChatView, Message, useChatAtBottom } from "@goodttv/interfaz"
import { type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from "react"
import { Compose, type ComposeHandle, PROVIDER_LABEL } from "./ChatCompose"

// El chat junto al vídeo, con los mensajes y emotes de la tele (@goodttv/interfaz). Baja solo con los mensajes nuevos
// si ya estabas abajo; si subiste a leer, se queda donde estás. Con la cuenta vinculada con permiso para escribir, una
// caja al pie (CHAT-1, ChatCompose.tsx): lo enviado sale ya, sin esperar al retraso de la imagen. Un emote del chat
// dice su nombre al pasar el ratón, y un clic lo añade al mensaje (o, sin poder escribir, copia su nombre). Mientras
// el ratón está en un emote, la lista no baja con los mensajes nuevos, que se lo llevarían.
const STICK_PX = 32
const TIP_ROOM_PX = 96 // sin este sitio encima del emote, su ficha va debajo
const TIP_HALF_PX = 110 // la mitad del ancho máximo de la ficha, para que no se salga del chat

// si: se puede escribir; vincular: hay cuenta, pero sin el permiso (se vinculó antes de CHAT-1); no: sin cuenta.
export type ChatWriting = "si" | "vincular" | "no"

type Place = { readonly below: boolean; readonly x: number; readonly y: number }

type Tip = Place & {
  readonly copied: boolean
  readonly element: Element
  readonly name: string
  readonly overlays: readonly string[]
  readonly provider: ChatEmote["provider"] | undefined
  readonly url: string
}

// Dónde va la ficha de un emote en el chat: centrada encima (o debajo, sin sitio), sin salirse por los lados.
const placeTip = (element: Element, panel: Element): Place => {
  const box = panel.getBoundingClientRect()
  const at = element.getBoundingClientRect()
  const below = at.top - box.top < TIP_ROOM_PX
  return {
    below,
    x: Math.min(Math.max(at.left + at.width / 2 - box.left, TIP_HALF_PX), box.width - TIP_HALF_PX),
    y: below ? at.bottom - box.top + 6 : box.bottom - at.top + 6,
  }
}

// replay: el chat de un VOD (VOD-1), que se repite a la par de la imagen.
export const ChatPanel = ({
  chat,
  replay = false,
  scale,
  writing,
}: {
  readonly chat: ChatView
  readonly replay?: boolean
  readonly scale: "large" | "normal"
  readonly writing: ChatWriting
}) => {
  const panel = useRef<HTMLElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const stick = useRef(true)
  useChatAtBottom(list, chat.messages, stick)
  const status = CHAT_STATUS_TEXT[chat.status]
  const behind =
    chat.status === "connected" && chat.delay !== null && chat.delay >= 1
      ? `Va ${chat.delay} s por detrás, como la imagen.`
      : null
  const send = chat.send
  const canWrite = writing === "si" && send !== undefined
  // Lo propio sale abajo: la lista vuelve a seguir los mensajes nuevos.
  const onSent = useCallback(() => {
    stick.current = true
  }, [])
  const composer = useRef<ComposeHandle>(null)

  // Con el ratón en un emote, sin bajar; al salir de él, como estaba, salvo que se haya desplazado a mano.
  const holding = useRef(false)
  const hold = (on: boolean): void => {
    if (on && stick.current) {
      holding.current = true
      stick.current = false
    } else if (!on && holding.current) {
      holding.current = false
      stick.current = true
    }
  }
  const [tip, setTip] = useState<Tip | null>(null)
  const hideTip = (): void => {
    setTip(null)
    hold(false)
  }
  const showTip = (event: ReactPointerEvent): void => {
    const element = event.target instanceof Element ? event.target.closest(".emote") : null
    if (element === null) {
      hideTip()
      return
    }
    if (element === tip?.element) return
    const [base, ...overlays] = [...element.querySelectorAll<HTMLImageElement>("img")]
    if (base === undefined || panel.current === null) return
    hold(true)
    const provider = base.dataset["provider"]
    setTip({
      ...placeTip(element, panel.current),
      copied: false,
      element,
      name: base.dataset["name"] ?? base.alt,
      overlays: overlays.map((image) => image.dataset["name"] ?? "").filter((name) => name !== ""),
      provider:
        provider !== undefined && provider in PROVIDER_LABEL
          ? (provider as ChatEmote["provider"])
          : undefined,
      url: base.src,
    })
  }
  // Desplazarse a mano (la rueda, la barra) deja de retener: manda la posición, al desplazarse. Un clic en el emote no,
  // y al salir de él la lista vuelve a bajar.
  const stopHolding = (): void => {
    holding.current = false
  }
  const onListPointerDown = (event: ReactPointerEvent): void => {
    if (!(event.target instanceof Element) || event.target.closest(".emote") === null) stopHolding()
  }
  const onEmoteClick = (event: React.MouseEvent): void => {
    if (
      tip === null ||
      !(event.target instanceof Element) ||
      event.target.closest(".emote") !== tip.element
    )
      return
    if (canWrite) composer.current?.insert(tip.name)
    else
      void navigator.clipboard
        .writeText(tip.name)
        .then(() => setTip((current) => (current === null ? null : { ...current, copied: true })))
        .catch(() => undefined)
  }

  return (
    <aside aria-label="Chat" className={`chat chat--${scale}`} ref={panel}>
      <header className="chat__head">{replay ? "Chat del vídeo" : "Chat del directo"}</header>
      {status === undefined ? null : <p className="chat__status">{status}</p>}
      {/* En un bloque propio, para que la lista se maquete aparte del resto de la página (desktop.css). */}
      <div className="chat__scroller">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: el clic en un emote es un atajo del ratón; con el teclado, Tab completa al escribir. */}
        <ol
          aria-live="off"
          className="chat__list"
          onClick={onEmoteClick}
          onPointerDown={onListPointerDown}
          onPointerLeave={hideTip}
          onPointerOver={showTip}
          onScroll={(event) => {
            // La ficha sigue a su emote (al quitarse los mensajes de arriba, el navegador recoloca la lista).
            if (tip !== null && (panel.current === null || !tip.element.isConnected)) hideTip()
            else if (tip !== null && panel.current !== null)
              setTip({ ...tip, ...placeTip(tip.element, panel.current) })
            if (holding.current) return
            const element = event.currentTarget
            stick.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < STICK_PX
          }}
          onWheel={stopHolding}
          ref={list}
        >
          {chat.messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
        </ol>
      </div>
      {tip === null ? null : (
        <div
          className={`emote-tip${tip.below ? " emote-tip--below" : ""}`}
          style={tip.below ? { left: tip.x, top: tip.y } : { bottom: tip.y, left: tip.x }}
        >
          <img alt="" className="emote-tip__image" src={tip.url} />
          <strong className="emote-tip__name">{tip.name}</strong>
          <span className="emote-tip__meta">
            {[
              tip.provider === undefined ? null : PROVIDER_LABEL[tip.provider],
              tip.overlays.length > 0 ? `con ${tip.overlays.join(", ")}` : null,
            ]
              .filter((each) => each !== null)
              .join(" · ")}
          </span>
          <span className="emote-tip__hint">
            {tip.copied ? "Copiado" : canWrite ? "Clic: al mensaje" : "Clic: copiar el nombre"}
          </span>
        </div>
      )}
      <footer className="chat__foot">
        {canWrite ? (
          <>
            <Compose emotes={chat.emotes} handle={composer} onSent={onSent} send={send} />
            {behind === null ? null : <p className="chat__note">{behind} Lo tuyo sale ya.</p>}
          </>
        ) : writing === "vincular" ? (
          <p className="chat__note">
            Solo lectura. Para escribir, vuelve a vincular la cuenta en{" "}
            <a href="#/ajustes">Ajustes</a>.
          </p>
        ) : replay ? (
          <p className="chat__note">Como se escribió en el directo, a la par de la imagen.</p>
        ) : (
          <p className="chat__note">
            {behind === null ? "Solo lectura." : `Solo lectura. ${behind}`}
          </p>
        )}
      </footer>
    </aside>
  )
}
