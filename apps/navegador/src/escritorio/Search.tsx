import { type Channel, formatViewers, fromSearch, searchChannels } from "@goodttv/interfaz"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react"
import { Avatar } from "./Avatar"

// Búsqueda siempre a mano (atajo /): al escribir, la lista de canales en el orden de relevancia de twitch.tv (sin
// cuenta, y con las erratas corregidas), con su foto y si están en directo; ↑ ↓ eligen, Enter abre el elegido (el
// primero, si aún no ha llegado la lista: en cuanto llega) y Esc cierra. Antes, Enter abría el canal con ese nombre
// exacto, y un nombre mal escrito llevaba a un canal que no era (22 oct). Ese atajo queda solo si Twitch no encuentra
// nada.
const LOGIN = /^[a-zA-Z0-9_]{1,25}$/
const MAX_RESULTS = 8
const SEARCH_DELAY_MS = 150
const compact = new Intl.NumberFormat("es", { maximumFractionDigits: 1, notation: "compact" })

type Results =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly text: string }
  | { readonly kind: "ready"; readonly text: string; readonly channels: readonly Channel[] }
  | { readonly kind: "error"; readonly text: string }

export const Search = ({
  inputRef,
  onOpen,
}: {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly onOpen: (channel: Channel) => void
}) => {
  const [query, setQuery] = useState("")
  const [focused, setFocused] = useState(false)
  const [results, setResults] = useState<Results>({ kind: "idle" })
  const [active, setActive] = useState(0)
  const id = useId()
  const text = query.trim()
  // Enter antes de que llegue la lista: se abre el primero en cuanto llega, si sigue siendo la misma búsqueda.
  const pendingEnter = useRef<string | null>(null)

  // Cada consulta empieza sin los resultados de la anterior, y una respuesta que llega tarde (bien o mal) se descarta.
  useEffect(() => {
    setActive(0)
    if (text === "") {
      setResults({ kind: "idle" })
      return undefined
    }
    setResults({ kind: "loading", text })
    let current = true
    const timer = setTimeout(() => {
      searchChannels(text)
        .then((cards) => {
          if (current) setResults({ channels: cards.map(fromSearch), kind: "ready", text })
        })
        .catch(() => {
          if (current) setResults({ kind: "error", text })
        })
    }, SEARCH_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [text])

  const found = results.kind === "ready" ? results.channels : []
  // Si Twitch no encuentra nada (o falla), abrir el canal con ese nombre tal cual.
  const exact: Channel | undefined =
    (results.kind === "ready" && found.length === 0) || results.kind === "error"
      ? LOGIN.test(text)
        ? { displayName: text, login: text.toLowerCase() }
        : undefined
      : undefined
  const options = exact === undefined ? found.slice(0, MAX_RESULTS) : [exact]
  const open = focused && text !== ""
  const selected = Math.min(active, Math.max(0, options.length - 1))

  const choose = (channel: Channel | undefined): void => {
    if (channel === undefined) return
    pendingEnter.current = null
    onOpen(channel)
    setQuery("")
    inputRef.current?.blur()
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo cuando llega la lista.
  useEffect(() => {
    if (results.kind !== "ready" && results.kind !== "error") return
    if (pendingEnter.current === results.text) choose(options[0])
  }, [results])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((index) =>
        options.length === 0 ? 0 : (index + step + options.length) % options.length,
      )
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (results.kind === "loading") pendingEnter.current = text
      else choose(options[selected])
    } else if (event.key === "Escape") {
      // Esc solo cierra la búsqueda: que no salga además del canal.
      event.preventDefault()
      pendingEnter.current = null
      setQuery("")
      inputRef.current?.blur()
    }
  }

  return (
    <div className="search">
      <label className="search__field">
        <MagnifyingGlassIcon aria-hidden="true" />
        <input
          aria-activedescendant={open && options.length > 0 ? `${id}-${selected}` : undefined}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-expanded={open}
          aria-label="Buscar canal"
          autoComplete="off"
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            // Un Enter pendiente era para lo que había escrito: si cambia, ya no vale (aunque vuelva a lo mismo).
            pendingEnter.current = null
            setQuery(event.currentTarget.value)
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar canal"
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          type="search"
          value={query}
        />
        <kbd>/</kbd>
      </label>
      {open ? (
        <div className="search__popup">
          <div aria-label="Canales" className="search__list" id={`${id}-list`} role="listbox">
            {options.map((channel, index) => (
              <div
                aria-selected={index === selected}
                className={`search__option${index === selected ? " search__option--active" : ""}`}
                id={`${id}-${index}`}
                key={channel.login}
                // Antes que el blur del campo, que cerraría la lista.
                onMouseDown={(event) => {
                  if (event.button !== 0) return
                  event.preventDefault()
                  choose(channel)
                }}
                onMouseEnter={() => setActive(index)}
                role="option"
                tabIndex={-1}
              >
                {channel === exact ? (
                  <span className="search__exact">
                    Abrir el canal <b>{text}</b>
                  </span>
                ) : (
                  <>
                    <Avatar name={channel.displayName} url={channel.profileImageUrl} />
                    <span className="search__text">
                      <b className="search__name">{channel.displayName}</b>
                      <span className="search__detail">
                        {[
                          channel.followers === undefined
                            ? null
                            : `${compact.format(channel.followers)} seguidores`,
                          channel.category || null,
                        ]
                          .filter((each) => each !== null)
                          .join(" · ")}
                      </span>
                    </span>
                    {channel.live ? (
                      <span className="live-count">
                        <i aria-hidden="true" />
                        {channel.viewerCount === undefined
                          ? "En directo"
                          : formatViewers(channel.viewerCount)}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
          {results.kind === "loading" ? <p className="search__note">Buscando…</p> : null}
          {results.kind === "ready" && found.length === 0 ? (
            <p className="search__note">Twitch no encuentra ningún canal así.</p>
          ) : null}
          {results.kind === "error" ? (
            <p className="search__note">No se pudo buscar. Inténtalo otra vez.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
