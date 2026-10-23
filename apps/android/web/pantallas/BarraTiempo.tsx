import type { Storyboard } from "@goodttv/contratos"
import { formatClock } from "@goodttv/interfaz"
import { thumbnailAt } from "@goodttv/sin-anuncios"
import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react"
import { android } from "../api"
import { useEnPantalla } from "./media3"

// La barra del vídeo, para el dedo: lo cargado y lo visto, y se arrastra. Mientras se arrastra, encima del dedo, el
// momento (en un directo, cuánto antes de ahora) y, si el VOD las tiene, su miniatura. Solo salta al soltar. La zona que
// se puede tocar es más alta que la barra que se ve, y arrastrarla desde un borde no es el gesto de Atrás de Android
// (la app la excluye, barraZona).
const MINIATURA_PX = 168 // ancho de la miniatura a la vista (las de Twitch son mayores)

const avisarBarra = (x: number, y: number, ancho: number, alto: number): void =>
  android.barraZona(x, y, ancho, alto)
const quitarBarra = (): void => android.barraZona(0, 0, 0, 0)

export const BarraTiempo = ({
  bufer,
  duracion,
  etiqueta = formatClock,
  onArrastrar,
  onSaltar,
  posicion,
  storyboard,
}: {
  readonly bufer: number
  readonly duracion: number
  readonly etiqueta?: (segundos: number) => string
  readonly onArrastrar: (arrastrando: boolean) => void // para que los controles no se oculten mientras
  readonly onSaltar: (a: number) => void
  readonly posicion: number
  readonly storyboard: Storyboard | null
}) => {
  const barra = useRef<HTMLDivElement>(null)
  useEnPantalla(barra, avisarBarra, quitarBarra)
  const [arrastre, setArrastre] = useState<number | null>(null) // s bajo el dedo
  const en = (event: ReactPointerEvent): number => {
    const caja = barra.current?.getBoundingClientRect()
    if (caja === undefined || caja.width === 0 || duracion <= 0) return 0
    return Math.min(1, Math.max(0, (event.clientX - caja.left) / caja.width)) * duracion
  }
  const proporcion = (segundos: number): number =>
    duracion > 0 ? Math.min(1, Math.max(0, segundos / duracion)) : 0
  const vista = arrastre ?? posicion
  const miniatura =
    arrastre === null || storyboard === null ? null : thumbnailAt(storyboard, arrastre)
  const escala = storyboard === null ? 1 : Math.min(1, MINIATURA_PX / storyboard.width)
  const soltar = (): void => {
    setArrastre(null)
    onArrastrar(false)
  }
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: sin teclado en el teléfono; los 10 s, en los botones.
    // biome-ignore lint/a11y/useKeyWithClickEvents: el clic solo evita que tocar la barra oculte los controles.
    <div
      aria-label="Posición en el vídeo"
      aria-valuemax={Math.round(duracion)}
      aria-valuemin={0}
      aria-valuenow={Math.round(vista)}
      aria-valuetext={etiqueta(vista)}
      className={`barra-tiempo${arrastre === null ? "" : " barra-tiempo--arrastrando"}`}
      onClick={(event) => event.stopPropagation()}
      onPointerCancel={soltar}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setArrastre(en(event))
        onArrastrar(true)
      }}
      onPointerMove={(event) => {
        if (arrastre !== null) setArrastre(en(event))
      }}
      onPointerUp={(event) => {
        if (arrastre === null) return
        onSaltar(en(event))
        soltar()
      }}
      ref={barra}
      role="slider"
    >
      <div className="barra-tiempo__pista">
        <i className="barra-tiempo__cargado" style={{ width: `${proporcion(bufer) * 100}%` }} />
        <i className="barra-tiempo__visto" style={{ width: `${proporcion(vista) * 100}%` }} />
      </div>
      <i className="barra-tiempo__bola" style={{ left: `${proporcion(vista) * 100}%` }} />
      {arrastre === null ? null : (
        <div
          className="barra-tiempo__momento"
          // Centrado en el dedo, sin salirse de la barra (la mitad de lo que mide, a cada lado).
          style={{
            left: `clamp(${(MINIATURA_PX * escala) / 2}px, ${proporcion(arrastre) * 100}%, calc(100% - ${(MINIATURA_PX * escala) / 2}px))`,
          }}
        >
          {miniatura === null || storyboard === null ? null : (
            <span
              className="barra-tiempo__miniatura"
              style={{
                backgroundImage: `url("${miniatura.sheet}")`,
                backgroundPosition: `-${miniatura.col * storyboard.width * escala}px -${miniatura.row * storyboard.height * escala}px`,
                backgroundSize: `${storyboard.cols * storyboard.width * escala}px ${storyboard.rows * storyboard.height * escala}px`,
                height: storyboard.height * escala,
                width: storyboard.width * escala,
              }}
            />
          )}
          <span className="barra-tiempo__hora">{etiqueta(arrastre)}</span>
        </div>
      )}
    </div>
  )
}
