import {
  type Channel,
  channelSearchDetail,
  formatViewers,
  t,
  typedChannel,
  useChannelSearch,
} from "@goodttv/interfaz"
import { ArrowRightIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useRef } from "react"
import { Avatar, Barra } from "./comun"

// La búsqueda, a pantalla completa con el teclado, como la de la extensión (Search.tsx): al escribir, los canales en el
// orden de relevancia de twitch.tv (sin cuenta, y con las erratas corregidas), con su foto, sus seguidores y si están en
// directo, y se elige uno. «Ir» en el teclado abre el primero (si aún no ha llegado la lista, en cuanto llega). Antes, la
// primera opción abría el canal con ese nombre exacto, y un nombre mal escrito llevaba a un canal que no era (22 oct):
// ese atajo queda solo si Twitch no encuentra nada. Lo escrito sigue al volver de un canal (lo guarda App).
const MAX_RESULTS = 12
const SEARCH_DELAY_MS = 150

export const Busqueda = ({
  onOpen,
  onQuery,
  query,
}: {
  readonly onOpen: (channel: Channel) => void
  readonly onQuery: (query: string) => void
  readonly query: string
}) => {
  const input = useRef<HTMLInputElement>(null)
  const text = query.trim()
  // Cada consulta, sin los resultados de la anterior (useChannelSearch, común con la extensión y la TV).
  const { results } = useChannelSearch(text, { delayMs: SEARCH_DELAY_MS })
  // «Ir» antes de que llegue la lista: se abre el primero en cuanto llega, si sigue siendo la misma búsqueda.
  const pendingGo = useRef<string | null>(null)

  // Sin nada escrito, el teclado sale solo; al volver de un canal con resultados, se ven sin taparlos.
  useEffect(() => {
    if (query === "") input.current?.focus()
  }, [])

  const found = results.kind === "ready" ? results.channels.slice(0, MAX_RESULTS) : []
  // Si Twitch no encuentra nada (o falla), abrir el canal con ese nombre tal cual.
  const exact: Channel | undefined =
    (results.kind === "ready" && found.length === 0) || results.kind === "error"
      ? typedChannel(text)
      : undefined
  const options = exact === undefined ? found : [exact]
  const open = (channel: Channel | undefined): void => {
    if (channel === undefined) return
    pendingGo.current = null
    onOpen(channel)
  }
  // Solo cuando llega la lista.
  useEffect(() => {
    if (results.kind !== "ready" && results.kind !== "error") return
    if (pendingGo.current === results.text) open(options[0])
  }, [results])

  return (
    <div className="pantalla">
      <Barra>
        <form
          className="buscador"
          onSubmit={(event) => {
            event.preventDefault()
            if (results.kind === "loading") pendingGo.current = text
            else open(options[0])
          }}
        >
          <input
            aria-label={t("Buscar un canal")}
            autoCapitalize="none"
            autoComplete="off"
            enterKeyHint="go"
            onChange={(event) => {
              // Un «Ir» pendiente era para lo que había escrito: si cambia, ya no vale (aunque vuelva a lo mismo).
              pendingGo.current = null
              onQuery(event.currentTarget.value)
            }}
            placeholder={t("Buscar un canal")}
            ref={input}
            spellCheck={false}
            type="search"
            value={query}
          />
          {query === "" ? null : (
            <button
              aria-label={t("Borrar")}
              className="boton-icono"
              onClick={() => {
                onQuery("")
                input.current?.focus()
              }}
              type="button"
            >
              <XIcon />
            </button>
          )}
        </form>
      </Barra>
      <ul className="resultados">
        {options.map((channel) => (
          <li key={channel.login}>
            <button className="resultado" onClick={() => open(channel)} type="button">
              {channel === exact ? (
                <>
                  <span className="resultado__icono">
                    <ArrowRightIcon />
                  </span>
                  <span className="resultado__texto">
                    <span>
                      {t("Abrir el canal")} <b>{text}</b>
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <Avatar name={channel.displayName} url={channel.profileImageUrl} />
                  <span className="resultado__texto">
                    <b>{channel.displayName}</b>
                    <span className="resultado__detalle">{channelSearchDetail(channel)}</span>
                  </span>
                  {channel.live ? (
                    <span className="en-directo">
                      <i aria-hidden="true" />
                      {channel.viewerCount === undefined
                        ? t("En directo")
                        : formatViewers(channel.viewerCount)}
                    </span>
                  ) : null}
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
      {results.kind === "loading" ? <p className="nota">{t("Buscando…")}</p> : null}
      {results.kind === "ready" && found.length === 0 ? (
        <p className="nota">{t("Twitch no encuentra ningún canal así.")}</p>
      ) : null}
      {results.kind === "error" ? (
        <p className="nota">{t("No se pudo buscar. Inténtalo otra vez.")}</p>
      ) : null}
    </div>
  )
}
