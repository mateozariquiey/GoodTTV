import { type Channel, t, typedChannel, useChannelSearch } from "@goodttv/interfaz"
import { useState } from "react"
import { ChannelRow, StateMessage } from "../ui"

const KEY_ROWS = [
  ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
  ["k", "l", "m", "n", "o", "p", "q", "r", "s", "t"],
  ["u", "v", "w", "x", "y", "z", "_", "ñ", "-", "."],
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
] as const

const DEBOUNCE_MS = 450

type SearchScreenProps = {
  readonly onWatch: (channel: Channel, lineup: readonly Channel[]) => void
}

// Typing with a remote: an alphabetical on-screen keyboard. A physical keyboard also works:
// while the field has focus, main lets letters, Space and Backspace through. Busca como invitado, con la relevancia de
// twitch.tv, también sin cuenta (guestCatalog, como en la extensión y Android).
export const SearchScreen = ({ onWatch }: SearchScreenProps) => {
  const [query, setQuery] = useState("")
  const trimmed = query.trim()
  const { results, retry } = useChannelSearch(trimmed, { delayMs: DEBOUNCE_MS, minLength: 2 })

  const type = (character: string) => setQuery((current) => `${current}${character}`.slice(0, 50))
  const exact = typedChannel(trimmed)
  const channels = results.kind === "ready" ? results.channels : []
  const lineup = channels.filter((channel) => channel.live === true)

  return (
    <div className="search">
      <div className="search__input">
        <label className="search__field">
          <span className="search__label">{t("Buscar canal")}</span>
          <input
            autoComplete="off"
            data-nav
            data-nav-id="search-field"
            maxLength={50}
            onBlur={() => void window.api.input.setTextEntry(false)}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onFocus={() => void window.api.input.setTextEntry(true)}
            placeholder={t("Nombre del canal")}
            spellCheck={false}
            value={query}
          />
        </label>
        <fieldset className="keyboard">
          <legend className="visually-hidden">{t("Teclado en pantalla")}</legend>
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
              {t("Espacio")}
            </button>
            <button
              className="key key--wide"
              data-nav
              data-nav-id="key-delete"
              onClick={() => setQuery((current) => Array.from(current).slice(0, -1).join(""))}
              type="button"
            >
              {t("Borrar letra")}
            </button>
            <button
              className="key key--wide"
              data-nav
              data-nav-id="key-clear"
              onClick={() => setQuery("")}
              type="button"
            >
              {t("Vaciar")}
            </button>
          </div>
        </fieldset>
      </div>
      <div className="search__results">
        {exact === undefined ? null : (
          <section aria-label={t("Ir directamente")} className="guide__section">
            <h2 className="guide__heading">{t("Ir directamente")}</h2>
            <ul className="guide__list">
              <li>
                <ChannelRow
                  channel={{
                    ...exact,
                    title: t("Abrir twitch.tv/{login}", { login: exact.login }),
                  }}
                  navId="search-exact"
                  onOpen={() => onWatch(exact, [])}
                />
              </li>
            </ul>
          </section>
        )}
        {results.kind === "idle" ? (
          <p className="guide__empty">{t("Escribe al menos dos letras.")}</p>
        ) : results.kind === "loading" ? (
          <StateMessage kind="loading" title={t("Buscando «{query}»…", { query: results.text })} />
        ) : results.kind === "error" ? (
          <StateMessage
            action={{
              id: "search-retry",
              label: t("Reintentar"),
              run: retry,
            }}
            kind="error"
            title={t("No se pudo buscar en Twitch")}
          />
        ) : channels.length === 0 ? (
          <StateMessage
            kind="empty"
            title={t("No hay canales para «{query}»", { query: results.text })}
          />
        ) : (
          <section aria-label={t("Resultados")} className="guide__section">
            <h2 className="guide__heading">{t("Resultados")}</h2>
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
