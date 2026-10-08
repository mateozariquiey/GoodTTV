import { useEffect, useState } from "react"
import { type Channel, fromSearch } from "../channel"
import { searchChannels } from "../data"
import { ChannelRow, StateMessage } from "../ui"

const KEY_ROWS = [
  ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
  ["k", "l", "m", "n", "o", "p", "q", "r", "s", "t"],
  ["u", "v", "w", "x", "y", "z", "_", "ñ", "-", "."],
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
] as const

const LOGIN = /^[a-zA-Z0-9_]{1,25}$/
const DEBOUNCE_MS = 450

type Results =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly query: string }
  | { readonly kind: "ready"; readonly channels: readonly Channel[]; readonly query: string }
  | { readonly kind: "error"; readonly query: string }

type SearchScreenProps = {
  readonly onWatch: (channel: Channel, lineup: readonly Channel[]) => void
  readonly signedIn: boolean
}

// Typing with a remote: an alphabetical on-screen keyboard. A physical keyboard also works:
// while the field has focus, main lets letters, Space and Backspace through.
export const SearchScreen = ({ onWatch, signedIn }: SearchScreenProps) => {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Results>({ kind: "idle" })
  const [attempt, setAttempt] = useState(0)
  const trimmed = query.trim()

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the search on Retry.
  useEffect(() => {
    if (!signedIn || trimmed.length < 2) {
      setResults({ kind: "idle" })
      return undefined
    }
    let active = true
    setResults({ kind: "loading", query: trimmed })
    const timer = setTimeout(() => {
      searchChannels(trimmed)
        .then((cards) => {
          if (active) setResults({ channels: cards.map(fromSearch), kind: "ready", query: trimmed })
        })
        .catch(() => {
          if (active) setResults({ kind: "error", query: trimmed })
        })
    }, DEBOUNCE_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [attempt, signedIn, trimmed])

  const type = (character: string) => setQuery((current) => `${current}${character}`.slice(0, 50))
  const exact: Channel | undefined = LOGIN.test(trimmed)
    ? { displayName: trimmed, login: trimmed.toLowerCase() }
    : undefined
  const channels = results.kind === "ready" ? results.channels : []
  const lineup = channels.filter((channel) => channel.live === true)

  return (
    <div className="search">
      <div className="search__input">
        <label className="search__field">
          <span className="search__label">Buscar canal</span>
          <input
            autoComplete="off"
            data-nav
            data-nav-id="search-field"
            maxLength={50}
            onBlur={() => void window.api.input.setTextEntry(false)}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onFocus={() => void window.api.input.setTextEntry(true)}
            placeholder="Nombre del canal"
            spellCheck={false}
            value={query}
          />
        </label>
        <fieldset className="keyboard">
          <legend className="visually-hidden">Teclado en pantalla</legend>
          {KEY_ROWS.map((row) => (
            <div className="keyboard__row" key={row.join("")}>
              {row.map((character) => (
                <button
                  className="key"
                  data-nav
                  data-nav-entry={character === "a" ? "" : undefined}
                  data-nav-id={`key-${character}`}
                  key={character}
                  onClick={() => type(character)}
                  type="button"
                >
                  {character}
                </button>
              ))}
            </div>
          ))}
          <div className="keyboard__row keyboard__row--actions">
            <button
              className="key key--wide"
              data-nav
              data-nav-id="key-space"
              onClick={() => type(" ")}
              type="button"
            >
              Espacio
            </button>
            <button
              className="key key--wide"
              data-nav
              data-nav-id="key-delete"
              onClick={() => setQuery((current) => Array.from(current).slice(0, -1).join(""))}
              type="button"
            >
              Borrar
            </button>
            <button
              className="key key--wide"
              data-nav
              data-nav-id="key-clear"
              onClick={() => setQuery("")}
              type="button"
            >
              Vaciar
            </button>
          </div>
        </fieldset>
      </div>
      <div className="search__results">
        {exact === undefined ? null : (
          <section aria-label="Ir directamente" className="guide__section">
            <h2 className="guide__heading">Ir directamente</h2>
            <ul className="guide__list">
              <li>
                <ChannelRow
                  channel={{ ...exact, title: `Abrir twitch.tv/${exact.login}` }}
                  navId="search-exact"
                  onOpen={() => onWatch(exact, [])}
                />
              </li>
            </ul>
          </section>
        )}
        {!signedIn ? (
          <p className="guide__empty">
            Sin cuenta vinculada solo puedes abrir un canal por su nombre exacto.
          </p>
        ) : results.kind === "idle" ? (
          <p className="guide__empty">Escribe al menos dos letras.</p>
        ) : results.kind === "loading" ? (
          <StateMessage kind="loading" title={`Buscando «${results.query}»…`} />
        ) : results.kind === "error" ? (
          <StateMessage
            action={{
              id: "search-retry",
              label: "Reintentar",
              run: () => setAttempt((value) => value + 1),
            }}
            kind="error"
            title="No se pudo buscar en Twitch"
          />
        ) : channels.length === 0 ? (
          <StateMessage kind="empty" title={`No hay canales para «${results.query}»`} />
        ) : (
          <section aria-label="Resultados" className="guide__section">
            <h2 className="guide__heading">Resultados</h2>
            <ul className="guide__list">
              {channels.map((channel) => (
                <li key={channel.login}>
                  <ChannelRow
                    channel={channel}
                    navId={`search-${channel.login}`}
                    onOpen={() => onWatch(channel, lineup)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
