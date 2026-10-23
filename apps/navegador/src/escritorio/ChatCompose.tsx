import { CHAT_MESSAGE_MAX, type ChatEmote, type ChatEmoteGroups } from "@goodttv/contratos"
import {
  emoteThumb,
  insertAt,
  NO_EMOTES,
  replaceWord,
  suggestEmotes,
  useChatCompose,
  useChatEmotes,
  wordAt,
} from "@goodttv/interfaz"
import { SmileyIcon } from "@phosphor-icons/react"
import {
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

// La caja para escribir en el chat (CHAT-1), con los emotes del canal (7TV, BTTV, FFZ) y los tuyos de Twitch:
//   - Tab completa la palabra con el primer emote que empieza por ella, y otra vez Tab, con el siguiente (Mayús+Tab,
//     el anterior), como en Chatterino y 7TV;
//   - «:» y dos letras sugieren los que empiezan por ellas, como en Twitch: ↑ ↓ para elegir, Tab o Enter para ponerlo;
//   - el botón de la cara abre la lista entera, con un buscador.
// Enter envía (useChatCompose); Esc cierra lo abierto, o sale de la caja sin dejar el canal.

export const PROVIDER_LABEL: Readonly<Record<ChatEmote["provider"], string>> = {
  "7tv": "7TV",
  bttv: "BTTV",
  ffz: "FFZ",
  twitch: "Twitch",
}

// Para poner un emote desde fuera (un clic en uno del chat).
export type ComposeHandle = { readonly insert: (name: string) => void }

type Cycle = {
  readonly end: number // el cursor tras el emote puesto
  readonly index: number
  readonly matches: readonly ChatEmote[]
  readonly start: number
}

const CYCLE_MAX = 50

export const Compose = ({
  emotes,
  handle,
  onSent,
  send,
}: {
  readonly emotes: (() => Promise<ChatEmoteGroups>) | undefined
  readonly handle: Ref<ComposeHandle>
  readonly onSent: () => void
  readonly send: (text: string) => Promise<string | null>
}) => {
  const { change, error, submit, text } = useChatCompose(send, onSent)
  const input = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [picking, setPicking] = useState(false)
  // Pedidos al ir a escribir, no al abrir el canal.
  const groups = useChatEmotes(emotes, focused || picking)
  const [caret, setCaret] = useState(0)
  const cycle = useRef<Cycle | null>(null)

  // El cursor, donde quedó lo puesto, tras pintar el texto nuevo (React lo dejaría al final).
  const pendingCaret = useRef<number | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: tras cada texto nuevo.
  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === null) return
    pendingCaret.current = null
    input.current?.setSelectionRange(at, at)
  }, [text])
  const apply = (next: { readonly caret: number; readonly text: string }): void => {
    setCaret(next.caret)
    // El mismo texto (Tab con un solo emote posible) no se vuelve a pintar: el cursor, ya.
    if (next.text === text) input.current?.setSelectionRange(next.caret, next.caret)
    else {
      pendingCaret.current = next.caret
      change(next.text)
    }
  }
  const insert = (name: string): void => {
    cycle.current = null
    apply(insertAt(text, input.current?.selectionStart ?? text.length, name))
  }
  useImperativeHandle(handle, () => ({
    insert: (name: string) => {
      insert(name)
      input.current?.focus()
    },
  }))

  // «:» y unas letras: sugerencias, hasta elegir una o descartarlas con Esc.
  const word = wordAt(text, caret)
  const [dismissed, setDismissed] = useState<number | null>(null) // el principio de la palabra descartada
  const suggestions =
    focused && word.text.startsWith(":") && dismissed !== word.start
      ? suggestEmotes(groups, word.text)
      : []
  const [chosen, setChosen] = useState(0)
  const listId = useId()
  const suggestionsKey = suggestions.map((each) => each.name).join(" ")
  // biome-ignore lint/correctness/useExhaustiveDependencies: otras sugerencias, desde la primera.
  useEffect(() => setChosen(0), [suggestionsKey])
  const pick = (emote: ChatEmote): void => {
    cycle.current = null
    apply(replaceWord(text, word, emote.name))
  }

  // Tab: la palabra, completada; seguido, el siguiente que empieza igual.
  const complete = (at: number, backwards: boolean): boolean => {
    const last = cycle.current
    if (last !== null && at === last.end) {
      const count = last.matches.length
      const index = (last.index + (backwards ? count - 1 : 1)) % count
      const next = last.matches[index]
      if (next === undefined) return false
      apply(replaceWord(text, { end: last.end, start: last.start, text: "" }, next.name))
      cycle.current = { ...last, end: last.start + next.name.length + 1, index }
      return true
    }
    const current = wordAt(text, at)
    const matches = suggestEmotes(groups, current.text, CYCLE_MAX)
    const first = matches[0]
    if (first === undefined) return false
    apply(replaceWord(text, current, first.name))
    cycle.current = {
      end: current.start + first.name.length + 1,
      index: 0,
      matches,
      start: current.start,
    }
    return true
  }

  return (
    <form
      className="chat__compose"
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
      {suggestions.length === 0 ? null : (
        <div aria-label="Emotes" className="emote-suggestions" id={listId} role="listbox">
          {suggestions.map((emote, index) => (
            <div
              aria-selected={index === chosen}
              className="emote-suggestions__item"
              id={`${listId}-${index}`}
              key={emote.name}
              // Sin quitarle el foco a la caja.
              onPointerDown={(event) => {
                event.preventDefault()
                pick(emote)
              }}
              role="option"
              tabIndex={-1}
            >
              <img alt="" src={emoteThumb(emote)} />
              <span className="emote-suggestions__name">{emote.name}</span>
              <span className="emote-suggestions__provider">{PROVIDER_LABEL[emote.provider]}</span>
            </div>
          ))}
        </div>
      )}
      {picking ? (
        <EmotePicker
          groups={groups}
          onClose={() => {
            setPicking(false)
            input.current?.focus()
          }}
          onPick={insert}
        />
      ) : null}
      <div className="chat__field">
        <input
          aria-activedescendant={suggestions.length > 0 ? `${listId}-${chosen}` : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={suggestions.length > 0}
          aria-label="Enviar un mensaje"
          autoComplete="off"
          className="chat__input"
          enterKeyHint="send"
          maxLength={CHAT_MESSAGE_MAX}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            const { selectionStart, value } = event.currentTarget
            const at = selectionStart ?? value.length
            cycle.current = null
            setCaret(at)
            // Descartadas, hasta empezar otra palabra con «:».
            if (!wordAt(value, at).text.startsWith(":")) setDismissed(null)
            change(value)
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            const at = event.currentTarget.selectionStart ?? text.length
            const open = suggestions.length > 0
            if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              const step = event.key === "ArrowDown" ? 1 : suggestions.length - 1
              setChosen((index) => (index + step) % suggestions.length)
            } else if (open && (event.key === "Tab" || event.key === "Enter")) {
              const emote = suggestions[chosen]
              if (emote !== undefined) pick(emote)
            } else if (event.key === "Tab") {
              if (!complete(at, event.shiftKey)) return
            } else if (event.key === "Escape") {
              if (open) setDismissed(word.start)
              else event.currentTarget.blur()
            } else return
            event.preventDefault()
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          placeholder="Enviar un mensaje"
          ref={input}
          role="combobox"
          spellCheck
          title="Tab completa el emote; «:» y unas letras, sugerencias"
          value={text}
        />
        <button
          aria-expanded={picking}
          aria-label="Emotes"
          className="chat__emotes"
          onClick={() => setPicking((open) => !open)}
          title="Emotes"
          type="button"
        >
          <SmileyIcon aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}

// Cada emote de la lista se pide tras estar un momento a la vista (o a punto): bajar deprisa no deja pedidas las
// imágenes de las filas que pasan de largo, que en Zen retrasaban las de abajo (22 oct, knekro: 215 pedidas en una
// bajada), y lo que sale de la vista sin haber cargado se cancela.
const LOAD_DELAY_MS = 150
const LOAD_MARGIN = "120px 0px"

const SECTIONS = [
  ["channel", "Del canal"],
  ["twitch", "Tuyos de Twitch"],
  ["global", "Globales"],
] as const

// La lista entera, encima de la caja: los del canal, los tuyos de Twitch y los globales, con un buscador. Un clic pone
// el emote y la lista sigue abierta, para poner varios; se cierra con Esc, el botón o un clic fuera.
const EmotePicker = ({
  groups,
  onClose,
  onPick,
}: {
  readonly groups: ChatEmoteGroups
  readonly onClose: () => void
  readonly onPick: (name: string) => void
}) => {
  const [search, setSearch] = useState("")
  const [hovered, setHovered] = useState<ChatEmote | null>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(".emote-picker, .chat__emotes") == null) close.current()
    }
    addEventListener("pointerdown", onPointer, { capture: true })
    return () => removeEventListener("pointerdown", onPointer, { capture: true })
  }, [])
  const query = search.trim().toLowerCase()
  const loading = groups === NO_EMOTES
  const sections = SECTIONS.map(([key, title]) => ({
    emotes: groups[key].filter((emote) => emote.name.toLowerCase().includes(query)),
    key,
    title,
  })).filter((section) => section.emotes.length > 0)
  // Las imágenes, a mano (data-src → src): React no toca su src, que no lleva.
  const list = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: con otra búsqueda, las celdas son otras.
  useEffect(() => {
    const root = list.current
    if (root === null || loading) return undefined
    const timers = new Map<Element, ReturnType<typeof setTimeout>>()
    const imageOf = (cell: Element): HTMLImageElement | null => cell.querySelector("img[data-src]")
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { isIntersecting, target } of entries) {
          const image = imageOf(target)
          if (image === null) continue
          if (isIntersecting) {
            if (image.hasAttribute("src") || timers.has(target)) continue
            timers.set(
              target,
              setTimeout(() => {
                timers.delete(target)
                image.src = image.dataset["src"] ?? ""
              }, LOAD_DELAY_MS),
            )
          } else {
            clearTimeout(timers.get(target))
            timers.delete(target)
            if (!image.complete) image.removeAttribute("src")
          }
        }
      },
      { root, rootMargin: LOAD_MARGIN },
    )
    for (const cell of root.querySelectorAll(".emote-picker__emote")) observer.observe(cell)
    return () => {
      observer.disconnect()
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [loading, query])
  return (
    <div className="emote-picker">
      <input
        aria-label="Buscar emotes"
        autoComplete="off"
        // biome-ignore lint/a11y/noAutofocus: abrir la lista es para buscar en ella.
        autoFocus
        className="emote-picker__search"
        onChange={(event) => setSearch(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          onClose()
        }}
        placeholder="Buscar"
        value={search}
      />
      <div className="emote-picker__list" ref={list}>
        {loading ? (
          <p className="emote-picker__note">Cargando emotes…</p>
        ) : sections.length === 0 ? (
          <p className="emote-picker__note">
            {query === "" ? "No hay emotes." : "Ninguno se llama así."}
          </p>
        ) : (
          sections.map((section) => (
            <section key={section.key}>
              <h3 className="emote-picker__title">{section.title}</h3>
              <div className="emote-picker__grid">
                {section.emotes.map((emote) => (
                  <button
                    aria-label={emote.name}
                    className="emote-picker__emote"
                    key={emote.name}
                    onClick={() => onPick(emote.name)}
                    onFocus={() => setHovered(emote)}
                    onPointerEnter={() => setHovered(emote)}
                    type="button"
                  >
                    <img alt="" data-src={emoteThumb(emote)} />
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      <p className="emote-picker__hovered">
        {hovered === null ? (
          "Pasa el ratón por un emote para ver su nombre."
        ) : (
          <>
            <strong>{hovered.name}</strong> · {PROVIDER_LABEL[hovered.provider]}
          </>
        )}
      </p>
    </div>
  )
}
