import type { ChatEmote, ChatEmoteGroups } from "@goodttv/contratos"
import { emoteThumb, NO_EMOTES } from "@goodttv/interfaz"
import { CopyIcon, MagnifyingGlassIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { android } from "../api"
import { Hoja } from "./controles"

// Los emotes para escribir en el chat (CHAT-1), para el dedo: como en la extensión (ChatCompose.tsx), pero sin Tab ni
// ratón. Al escribir «:» y dos letras, las sugerencias salen encima de la caja (encima del teclado); el botón de la cara
// abre la lista entera, con un buscador, en el sitio del chat; y mantener pulsado un emote del chat enseña su nombre y de
// dónde es, para ponerlo en la caja o copiarlo. Las imágenes de las listas, en 1x (emoteThumb): las 2x de los animados
// de 7TV pesan 300-600 KB, y con decenas a la vez Firefox dejaba huecos.

export const PROVEEDOR: Readonly<Record<ChatEmote["provider"], string>> = {
  "7tv": "7TV",
  bttv: "BTTV",
  ffz: "FFZ",
  twitch: "Twitch",
}

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

// Cada emote de la lista se pide tras estar un momento a la vista (o a punto), como en la extensión: deslizar deprisa
// con el dedo no deja pedidas las imágenes de las filas que pasan de largo, que retrasaban las de abajo (22 oct, en Zen),
// y lo que sale de la vista sin haber cargado se cancela.
const CARGAR_MS = 150
const CARGAR_MARGEN = "120px 0px"

const SECCIONES = [
  ["channel", "Del canal"],
  ["twitch", "Tuyos de Twitch"],
  ["global", "Globales"],
] as const

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
  const texto = busqueda.trim().toLowerCase()
  const cargando = groups === NO_EMOTES
  // Las imágenes, a mano (data-src → src): React no toca su src, que no lleva.
  const cuerpo = useRef<HTMLDivElement>(null)
  // Con otra búsqueda, los emotes son otros.
  useEffect(() => {
    const raiz = cuerpo.current
    if (raiz === null || cargando) return undefined
    const esperas = new Map<Element, ReturnType<typeof setTimeout>>()
    const imagen = (celda: Element): HTMLImageElement | null => celda.querySelector("img[data-src]")
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const { isIntersecting, target } of entradas) {
          const img = imagen(target)
          if (img === null) continue
          if (isIntersecting) {
            if (img.hasAttribute("src") || esperas.has(target)) continue
            esperas.set(
              target,
              setTimeout(() => {
                esperas.delete(target)
                img.src = img.dataset["src"] ?? ""
              }, CARGAR_MS),
            )
          } else {
            clearTimeout(esperas.get(target))
            esperas.delete(target)
            if (!img.complete) img.removeAttribute("src")
          }
        }
      },
      { root: raiz, rootMargin: CARGAR_MARGEN },
    )
    for (const celda of raiz.querySelectorAll(".lista-emotes__emote")) observador.observe(celda)
    return () => {
      observador.disconnect()
      for (const espera of esperas.values()) clearTimeout(espera)
    }
  }, [cargando, texto])
  const secciones = SECCIONES.map(([clave, titulo]) => ({
    clave,
    emotes: groups[clave].filter((emote) => emote.name.toLowerCase().includes(texto)),
    titulo,
  })).filter((seccion) => seccion.emotes.length > 0)
  return (
    <div className="lista-emotes">
      <label className="lista-emotes__buscar">
        <MagnifyingGlassIcon aria-hidden="true" />
        <input
          aria-label="Buscar emotes"
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => setBusqueda(event.currentTarget.value)}
          placeholder="Buscar emotes"
          type="search"
          value={busqueda}
        />
      </label>
      <div className="lista-emotes__cuerpo" ref={cuerpo}>
        {cargando ? (
          <p className="nota">Cargando emotes…</p>
        ) : secciones.length === 0 ? (
          <p className="nota">{texto === "" ? "No hay emotes." : "Ninguno se llama así."}</p>
        ) : (
          secciones.map((seccion) => (
            <section key={seccion.clave}>
              <h3 className="lista-emotes__titulo">{seccion.titulo}</h3>
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
          "Toca un emote para ponerlo en el mensaje."
        ) : (
          <>
            <strong>{ultimo.name}</strong> · {PROVEEDOR[ultimo.provider]}
          </>
        )}
      </p>
    </div>
  )
}

// Lo que se sabe de un emote del chat, sacado de su imagen (Message, de @goodttv/interfaz, lo deja en data-*).
export type EmoteDelChat = {
  readonly name: string
  readonly overlays: readonly string[]
  readonly provider: ChatEmote["provider"] | undefined
  readonly url: string
}

export const emoteDe = (element: Element): EmoteDelChat | null => {
  const [base, ...overlays] = [...element.querySelectorAll<HTMLImageElement>("img")]
  if (base === undefined) return null
  const provider = base.dataset["provider"]
  return {
    name: base.dataset["name"] ?? base.alt,
    overlays: overlays.map((image) => image.dataset["name"] ?? "").filter((name) => name !== ""),
    provider:
      provider !== undefined && provider in PROVEEDOR
        ? (provider as ChatEmote["provider"])
        : undefined,
    url: base.src,
  }
}

// La ficha de un emote del chat (al mantenerlo pulsado): grande, con su nombre y de dónde es; ponerlo en la caja (si se
// puede escribir) o copiar su nombre.
export const FichaEmote = ({
  emote,
  onCerrar,
  onEscribir,
}: {
  readonly emote: EmoteDelChat
  readonly onCerrar: () => void
  readonly onEscribir: ((name: string) => void) | undefined
}) => {
  const [copiado, setCopiado] = useState(false)
  const datos = [
    emote.provider === undefined ? null : PROVEEDOR[emote.provider],
    emote.overlays.length > 0 ? `con ${emote.overlays.join(", ")}` : null,
  ].filter((each) => each !== null)
  return (
    <Hoja onClose={onCerrar} titulo="Emote">
      <div className="ficha-emote">
        <img alt="" src={emote.url} />
        <div>
          <strong className="ficha-emote__nombre">{emote.name}</strong>
          {datos.length === 0 ? null : (
            <span className="ficha-emote__datos">{datos.join(" · ")}</span>
          )}
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
            <PaperPlaneTiltIcon aria-hidden="true" size={20} />
            Al mensaje
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
          {copiado ? "Copiado" : "Copiar el nombre"}
        </button>
      </div>
    </Hoja>
  )
}
