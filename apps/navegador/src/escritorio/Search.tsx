import { type Channel, fromSearch, searchChannels } from "@goodttv/interfaz"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import { type KeyboardEvent, type RefObject, useEffect, useId, useState } from "react"
import { Avatar } from "./Avatar"

// Búsqueda siempre a mano (atajo /). La primera opción abre el canal con ese nombre exacto; con cuenta, debajo salen
// los canales que encuentra Twitch, primero los que están en directo. ↑ ↓ eligen, Enter abre y Esc cierra.
const LOGIN = /^[a-zA-Z0-9_]{1,25}$/
const MAX_RESULTS = 8

export const Search = ({
  inputRef,
  onOpen,
  signedIn,
}: {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly onOpen: (channel: Channel) => void
  readonly signedIn: boolean
}) => {
  const [query, setQuery] = useState("")
  const [focused, setFocused] = useState(false)
  const [results, setResults] = useState<readonly Channel[]>([])
  const [active, setActive] = useState(0)
  const id = useId()
  const text = query.trim()

  // Cada consulta empieza sin los resultados de la anterior, y una respuesta que llega tarde (bien o mal) se descarta.
  useEffect(() => {
    setActive(0)
    setResults([])
    if (!signedIn || text.length < 2) return undefined
    let current = true
    const timer = setTimeout(() => {
      searchChannels(text)
        .then((cards) => {
          if (!current) return
          const channels = cards.map(fromSearch)
          setResults([...channels.filter((c) => c.live), ...channels.filter((c) => !c.live)])
        })
        .catch(() => {
          if (current) setResults([])
        })
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [signedIn, text])

  const exact: Channel | undefined = LOGIN.test(text)
    ? { displayName: text, login: text.toLowerCase() }
    : undefined
  const options = [
    ...(exact === undefined ? [] : [exact]),
    ...results.filter((channel) => channel.login !== exact?.login).slice(0, MAX_RESULTS),
  ]
  const open = focused && text !== ""
  const selected = Math.min(active, Math.max(0, options.length - 1))

  const choose = (channel: Channel | undefined): void => {
    if (channel === undefined) return
    onOpen(channel)
    setQuery("")
    inputRef.current?.blur()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((index) =>
        options.length === 0 ? 0 : (index + step + options.length) % options.length,
      )
    } else if (event.key === "Enter") {
      event.preventDefault()
      choose(options[selected])
    } else if (event.key === "Escape") {
      // Esc solo cierra la búsqueda: que no salga además del canal.
      event.preventDefault()
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
          onChange={(event) => setQuery(event.currentTarget.value)}
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
                        {channel.category === "" ? channel.title : channel.category}
                      </span>
                    </span>
                    {channel.live ? (
                      <span className="live-count">
                        <i aria-hidden="true" />
                        En directo
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
          {signedIn ? null : (
            <p className="search__note">
              Vincula tu cuenta en Ajustes para buscar canales por nombre.
            </p>
          )}
          {signedIn && exact === undefined && results.length === 0 ? (
            <p className="search__note">Un nombre de canal solo lleva letras, números y _.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
