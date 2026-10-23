import type { Storyboard } from "@goodttv/contratos"
import { formatClock } from "@goodttv/interfaz"
import { thumbnailAt } from "@goodttv/sin-anuncios"
import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react"
import { SKIP_S } from "./SkipButton"

// La barra del vídeo: lo cargado, lo visto y, al pasar el ratón, el momento con su miniatura. Se arrastra; con el
// teclado (el foco en ella), ← → mueven 10 s, como fuera de ella.
export const SeekBar = ({
  buffered,
  duration,
  label = formatClock,
  onSeek,
  storyboard,
  time,
}: {
  readonly buffered: number
  readonly duration: number
  readonly onSeek: (to: number) => void
  readonly storyboard: Storyboard | null
  readonly time: number
  // Lo que dice al pasar el ratón: por defecto, la posición (en un directo, cuánto antes de ahora).
  readonly label?: (seconds: number) => string
}) => {
  const bar = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null) // s bajo el ratón
  const [dragging, setDragging] = useState<number | null>(null)
  const at = (event: ReactPointerEvent): number => {
    const box = bar.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0 || duration <= 0) return 0
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * duration
  }
  const shown = dragging ?? time
  const ratio = (seconds: number): string =>
    `${duration > 0 ? Math.min(100, (seconds / duration) * 100) : 0}%`
  const preview = hover ?? dragging
  const thumb = preview === null || storyboard === null ? null : thumbnailAt(storyboard, preview)
  return (
    <div
      aria-label="Posición en el vídeo"
      aria-valuemax={Math.round(duration)}
      aria-valuemin={0}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${formatClock(shown)} de ${formatClock(duration)}`}
      className={`seek${dragging === null ? "" : " seek--dragging"}`}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault()
          event.stopPropagation()
          onSeek(time + (event.key === "ArrowLeft" ? -SKIP_S : SKIP_S))
        }
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(at(event))
      }}
      onPointerLeave={() => setHover(null)}
      onPointerMove={(event) => {
        const seconds = at(event)
        setHover(seconds)
        if (dragging !== null) setDragging(seconds)
      }}
      onPointerUp={(event) => {
        if (dragging === null) return
        onSeek(at(event))
        setDragging(null)
      }}
      ref={bar}
      role="slider"
      tabIndex={0}
    >
      <div className="seek__track">
        <i className="seek__buffered" style={{ width: ratio(buffered) }} />
        <i className="seek__played" style={{ width: ratio(shown) }} />
      </div>
      <i className="seek__knob" style={{ left: ratio(shown) }} />
      {preview === null ? null : (
        <div className="seek__preview" style={{ left: ratio(preview) }}>
          {thumb === null || storyboard === null ? null : (
            <span
              className="seek__thumb"
              style={{
                backgroundImage: `url("${thumb.sheet}")`,
                backgroundPosition: `-${thumb.col * storyboard.width}px -${thumb.row * storyboard.height}px`,
                height: storyboard.height,
                width: storyboard.width,
              }}
            />
          )}
          <span className="seek__time">{label(preview)}</span>
        </div>
      )}
    </div>
  )
}
