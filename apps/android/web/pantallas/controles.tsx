import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  PauseIcon,
  PlayIcon,
} from "@phosphor-icons/react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useAtrasCierra } from "./rutas"

// Lo que comparten el canal y el VOD encima del vídeo: los controles que se ocultan solos, pausa con retroceder y
// avanzar 10 s a los lados (como en la app de Twitch y en YouTube: junto a pausa, en el centro, donde cae el pulgar), la
// hoja que sube desde abajo para elegir (la velocidad, la calidad) y las pestañas del chat y los vídeos.

export const SALTO_S = 10 // como ← → en la extensión
const IDLE_MS = 3000 // los controles se ocultan solos mientras se reproduce

const HORIZONTAL = "(orientation: landscape)"
const alGirar = (cambio: () => void): (() => void) => {
  const consulta = matchMedia(HORIZONTAL)
  consulta.addEventListener("change", cambio)
  return () => consulta.removeEventListener("change", cambio)
}
export const useHorizontal = (): boolean =>
  useSyncExternalStore(alGirar, () => matchMedia(HORIZONTAL).matches)

// Despiertos al tocar el vídeo o un control; se duermen solos a los IDLE_MS.
export const useDespierto = () => {
  const [despierto, setDespierto] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const despertar = useCallback(() => {
    setDespierto(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setDespierto(false), IDLE_MS)
  }, [])
  const dormir = useCallback(() => {
    clearTimeout(timer.current)
    setDespierto(false)
  }, [])
  useEffect(() => {
    despertar()
    return () => clearTimeout(timer.current)
  }, [despertar])
  return { despertar, despierto, dormir }
}

// Retroceder o avanzar: la flecha en círculo con los segundos dentro, como en la extensión (SkipButton).
const Saltar = ({
  adelante,
  disabled,
  onSaltar,
}: {
  readonly adelante: boolean
  readonly disabled: boolean
  readonly onSaltar: () => void
}) => (
  <button
    aria-label={adelante ? `Avanzar ${SALTO_S} s` : `Retroceder ${SALTO_S} s`}
    className="boton-icono boton-icono--claro saltar"
    disabled={disabled}
    onClick={onSaltar}
    type="button"
  >
    {adelante ? <ArrowClockwiseIcon /> : <ArrowCounterClockwiseIcon />}
    <span aria-hidden="true" className="saltar__segundos">
      {SALTO_S}
    </span>
  </button>
)

// Pausa en el centro, con retroceder y avanzar a los lados. Esperando datos, la pausa gira (y se puede tocar igual).
export const Centro = ({
  adelante = true,
  esperando,
  onPausa,
  onSaltar,
  pausado,
}: {
  readonly adelante?: boolean // se puede avanzar (en directo, solo tras retroceder)
  readonly esperando: boolean
  readonly onPausa: () => void
  readonly onSaltar: (segundos: number) => void
  readonly pausado: boolean
}) => (
  <div className="centro">
    <Saltar adelante={false} disabled={false} onSaltar={() => onSaltar(-SALTO_S)} />
    <button
      aria-label={pausado ? "Reproducir" : "Pausa"}
      className="boton-icono boton-icono--claro centro__pausa"
      onClick={onPausa}
      type="button"
    >
      {esperando ? (
        <span aria-label="Cargando" className="girando girando--centro" role="status" />
      ) : pausado ? (
        <PlayIcon weight="fill" />
      ) : (
        <PauseIcon weight="fill" />
      )}
    </button>
    <Saltar adelante disabled={!adelante} onSaltar={() => onSaltar(SALTO_S)} />
  </div>
)

// Una hoja que sube desde abajo, encima de todo, para elegir algo; se cierra al tocar fuera o con Atrás.
export const Hoja = ({
  children,
  onClose,
  titulo,
}: {
  readonly children: ReactNode
  readonly onClose: () => void
  readonly titulo: string
}) => {
  useAtrasCierra(true, onClose)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: tocar fuera de la hoja la cierra; Atrás también.
    // biome-ignore lint/a11y/useKeyWithClickEvents: ídem; sin teclado en el teléfono.
    <div className="hoja" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: solo evita que un toque dentro la cierre. */}
      <div
        aria-label={titulo}
        aria-modal="true"
        className="hoja__panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h2 className="hoja__titulo">{titulo}</h2>
        {children}
      </div>
    </div>
  )
}

// Las opciones de una hoja, con la elegida marcada.
export const Opciones = <T,>({
  elegida,
  onElegir,
  opciones,
}: {
  readonly elegida: T
  readonly onElegir: (valor: T) => void
  readonly opciones: readonly { readonly nombre: string; readonly valor: T }[]
}) => (
  <div className="opciones" role="menu">
    {opciones.map((opcion) => (
      <button
        aria-checked={opcion.valor === elegida}
        className="opcion"
        key={opcion.nombre}
        onClick={() => onElegir(opcion.valor)}
        role="menuitemradio"
        type="button"
      >
        {opcion.nombre}
      </button>
    ))}
  </div>
)

export type Pestana = "chat" | "videos"

// Debajo de la ficha, en vertical: el chat o los vídeos del canal (COL-2), que no caben a la vez.
export const Pestanas = ({
  elegida,
  onElegir,
  videos,
}: {
  readonly elegida: Pestana
  readonly onElegir: (pestana: Pestana) => void
  readonly videos: string // su nombre: «Vídeos», «Más vídeos»
}) => (
  <div className="pestanas" role="tablist">
    {(
      [
        ["chat", "Chat"],
        ["videos", videos],
      ] as const
    ).map(([valor, nombre]) => (
      <button
        aria-selected={elegida === valor}
        className="pestana"
        key={valor}
        onClick={() => onElegir(valor)}
        role="tab"
        type="button"
      >
        {nombre}
      </button>
    ))}
  </div>
)
