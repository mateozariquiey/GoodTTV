import type { ChatEmote, ChatEmoteGroups } from "@goodttv/contratos"
import {
  type ChatEmoteInfo,
  chatEmoteDetails,
  EMOTE_PROVIDER,
  emoteSections,
  emoteThumb,
  NO_EMOTES,
  t,
  useLazyEmoteImages,
} from "@goodttv/interfaz"
import { CopyIcon, MagnifyingGlassIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"
import { android } from "../api"
import { Hoja } from "./controles"

// Los emotes para escribir en el chat (CHAT-1), para el dedo: como en la extensión (ChatCompose.tsx), pero sin Tab ni
// ratón. Al escribir «:» y dos letras, las sugerencias salen encima de la caja (encima del teclado); el botón de la cara
// abre la lista entera, con un buscador, en el sitio del chat; y mantener pulsado un emote del chat enseña su nombre y de
// dónde es, para ponerlo en la caja o copiarlo. Las imágenes de las listas, en 1x (emoteThumb): las 2x de los animados
// de 7TV pesan 300-600 KB, y con decenas a la vez Firefox dejaba huecos. Agrupar y buscar en la lista, pedir sus
// imágenes al estar a la vista y los datos de la ficha son comunes (emote-list.ts, en @goodttv/interfaz).

// Encima de la caja, en una fila que se desliza. Tocar una no le quita el foco a la caja (el teclado sigue abierto).
export const Sugerencias = ({
  emotes,
  onElegir,
}: {
  readonly emotes: readonly ChatEmote[]
  readonly onElegir: (emote: ChatEmote) => void
}) => (
  <div aria-label="Emotes" className="sugerencias" role="listbox">
    {emotes.map((emote) => (
      <button
        aria-selected={false}
        className="sugerencia"
        key={emote.name}
        onClick={() => onElegir(emote)}
        onMouseDown={(event) => event.preventDefault()}
        role="option"
        type="button"
      >
        <img alt="" src={emoteThumb(emote)} />
        <span>{emote.name}</span>
      </button>
    ))}
  </div>
)

// La lista entera, en el sitio de los mensajes: los del canal, los tuyos de Twitch y los globales, con un buscador.
// Tocar uno lo pone en la caja y la lista sigue abierta, para poner varios; abajo, el nombre del último. Se cierra con
// la cara, con Atrás o al tocar la caja para escribir.
export const ListaEmotes = ({
  groups,
  onElegir,
}: {
  readonly groups: ChatEmoteGroups
  readonly onElegir: (emote: ChatEmote) => void
}) => {
  const [busqueda, setBusqueda] = useState("")
  const [ultimo, setUltimo] = useState<ChatEmote | null>(null)
  const cargando = groups === NO_EMOTES
  // Las imágenes, al estar un momento a la vista (data-src → src).
  const cuerpo = useRef<HTMLDivElement>(null)
  useLazyEmoteImages(cuerpo, ".lista-emotes__emote", !cargando, busqueda)
  const secciones = emoteSections(groups, busqueda)
  return (
    <div className="lista-emotes">
      <label className="lista-emotes__buscar">
        <MagnifyingGlassIcon aria-hidden="true" />
        <input
          aria-label={t("Buscar emotes")}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => setBusqueda(event.currentTarget.value)}
          placeholder={t("Buscar emotes")}
          type="search"
          value={busqueda}
        />
      </label>
      <div className="lista-emotes__cuerpo" ref={cuerpo}>
        {cargando ? (
          <p className="nota">{t("Cargando emotes…")}</p>
        ) : secciones.length === 0 ? (
          <p className="nota">
            {busqueda.trim() === "" ? t("No hay emotes.") : t("Ninguno se llama así.")}
          </p>
        ) : (
          secciones.map((seccion) => (
            <section key={seccion.key}>
              <h3 className="lista-emotes__titulo">{seccion.title}</h3>
              <div className="lista-emotes__rejilla">
                {seccion.emotes.map((emote) => (
                  <button
                    aria-label={emote.name}
                    className="lista-emotes__emote"
                    key={emote.name}
                    onClick={() => {
                      setUltimo(emote)
                      onElegir(emote)
                    }}
                    type="button"
                  >
                    <img alt="" data-src={emoteThumb(emote)} decoding="async" />
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      <p className="lista-emotes__ultimo">
        {ultimo === null ? (
          t("Toca un emote para ponerlo en el mensaje.")
        ) : (
          <>
            <strong>{ultimo.name}</strong> · {EMOTE_PROVIDER[ultimo.provider]}
          </>
        )}
      </p>
    </div>
  )
}

// La ficha de un emote del chat (al mantenerlo pulsado): grande, con su nombre y de dónde es; ponerlo en la caja (si se
// puede escribir) o copiar su nombre.
export const FichaEmote = ({
  emote,
  onCerrar,
  onEscribir,
}: {
  readonly emote: ChatEmoteInfo
  readonly onCerrar: () => void
  readonly onEscribir: ((name: string) => void) | undefined
}) => {
  const [copiado, setCopiado] = useState(false)
  const datos = chatEmoteDetails(emote)
  return (
    <Hoja onClose={onCerrar} titulo="Emote">
      <div className="ficha-emote">
        <img alt="" src={emote.url} />
        <div>
          <strong className="ficha-emote__nombre">{emote.name}</strong>
          {datos === "" ? null : <span className="ficha-emote__datos">{datos}</span>}
        </div>
      </div>
      <div className="botones hoja__botones">
        {onEscribir === undefined ? null : (
          <button
            className="boton boton--principal"
            onClick={() => {
              onEscribir(emote.name)
              onCerrar()
            }}
            type="button"
          >
            <PaperPlaneTiltIcon aria-hidden="true" size={20} /> {t("Al mensaje")}
          </button>
        )}
        <button
          className="boton"
          onClick={() => {
            android.copiar(emote.name)
            setCopiado(true)
          }}
          type="button"
        >
          <CopyIcon aria-hidden="true" size={20} />
          {copiado ? t("Copiado") : t("Copiar el nombre")}
        </button>
      </div>
    </Hoja>
  )
}
