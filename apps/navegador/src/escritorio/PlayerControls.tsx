import { chosenVolume, t } from "@goodttv/interfaz"
import {
  ArrowsInLineHorizontalIcon,
  ArrowsOutLineHorizontalIcon,
  ChatTextIcon,
  CornersInIcon,
  CornersOutIcon,
  SpeakerHighIcon,
  SpeakerSimpleXIcon,
} from "@phosphor-icons/react"
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react"

// Lo que comparten los controles del reproductor de la extensión: el canal (ChannelView), el VOD (VodView) y la barra
// de la cuadrícula (GridView). Son para el ratón y el teclado; los de Android, para el dedo, van aparte
// (apps/android/web/pantallas/controles.tsx).

const IDLE_MS = 3000
const DOUBLE_CLICK_MS = 220

// Los controles se despiertan al mover el ratón sobre el vídeo (wake) y se duermen solos a los IDLE_MS, o al salir el
// ratón (sleep). Quien los usa decide además cuándo se quedan a la vista (en pausa, con un menú abierto).
export const useControlsAwake = () => {
  const [awake, setAwake] = useState(true)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const wake = useCallback(() => {
    setAwake(true)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setAwake(false), IDLE_MS)
  }, [])
  useEffect(() => {
    wake()
    return () => clearTimeout(idleTimer.current)
  }, [wake])
  const sleep = useCallback(() => setAwake(false), [])
  return { awake, sleep, wake }
}

// En el vídeo, un clic pausa (toggle) y dos van a pantalla completa. El primero espera por si llega el segundo; si el
// doble clic del sistema es más lento y el primero ya pausó, se deshace. Solo ese: una pausa hecha aposta justo antes
// de un doble clic se queda (cada clic sabe qué gesto lo empezó). cancel: olvida el clic que espera (el canal, al pasar
// a otro, para que no llegue a él).
export const useSurfaceClicks = (toggle: () => void, toggleFullscreen: () => void) => {
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const gesture = useRef(0) // el gesto en curso: cambia con el primer clic de cada uno
  const toggledIn = useRef(-1) // el gesto cuyo primer clic llegó a pausar o reanudar
  const cancel = useCallback(() => clearTimeout(clickTimer.current), [])
  useEffect(() => cancel, [cancel])
  const onClick = (event: { readonly detail: number }): void => {
    if (event.detail <= 1) gesture.current += 1
    const mine = gesture.current
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      toggledIn.current = mine
      toggle()
    }, DOUBLE_CLICK_MS)
  }
  const onDoubleClick = (): void => {
    clearTimeout(clickTimer.current)
    if (toggledIn.current === gesture.current) toggle()
    toggledIn.current = -1
    toggleFullscreen()
  }
  return { cancel, onClick, onDoubleClick }
}

// El volumen de un reproductor (el canal y el VOD): empieza con el que eligió la persona (volume.ts), y cambiarlo lo
// lleva al <video> (apply, el setVolume del reproductor).
export const useVolume = (apply: (volume: number) => void) => {
  const [volume, setVolume] = useState(() => chosenVolume().volume)
  const change = useCallback(
    (next: number) => {
      const value = Math.min(1, Math.max(0, next))
      setVolume(value)
      apply(value)
    },
    [apply],
  )
  return [volume, change] as const
}

// Silenciar y la barra del volumen. muted: el silencio del <video>; con el volumen a 0 también se ve en silencio, y
// quitarlo sube el volumen a la mitad.
export const VolumeControl = ({
  muted,
  onToggleMuted,
  onVolume,
  volume,
}: {
  readonly muted: boolean
  readonly onToggleMuted: () => void
  readonly onVolume: (volume: number) => void
  readonly volume: number
}) => {
  const silent = muted || volume === 0
  return (
    <>
      <button
        aria-label={silent ? t("Quitar el silencio") : t("Silenciar")}
        className="icon-button icon-button--light"
        onClick={silent && volume === 0 ? () => onVolume(0.5) : onToggleMuted}
        title={silent ? t("Quitar el silencio (M)") : t("Silenciar (M)")}
        type="button"
      >
        {silent ? <SpeakerSimpleXIcon /> : <SpeakerHighIcon />}
      </button>
      <input
        aria-label={t("Volumen")}
        className="volume"
        max={1}
        min={0}
        onChange={(event) => onVolume(Number(event.currentTarget.value))}
        step={0.01}
        style={{ "--level": `${(silent ? 0 : volume) * 100}%` } as CSSProperties}
        type="range"
        value={silent ? 0 : volume}
      />
    </>
  )
}

// Un menú de los controles (la calidad; en el VOD, también la velocidad). children: sus opciones. Abierto, Esc solo lo
// cierra: se atiende en captura, antes que el Esc general de la ventana (Desktop), que saldría del modo teatro o
// volvería a Inicio.
export const ControlsMenu = ({
  children,
  label,
  onToggle,
  open,
  title,
}: {
  readonly children: ReactNode
  readonly label: string
  readonly onToggle: (open: boolean) => void
  readonly open: boolean
  readonly title: string
}) => {
  useEffect(() => {
    if (!open) return undefined
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onToggle(false)
    }
    addEventListener("keydown", onEscape, { capture: true })
    return () => removeEventListener("keydown", onEscape, { capture: true })
  }, [onToggle, open])
  return (
    <div className="quality">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="quality__button"
        onClick={() => onToggle(!open)}
        title={title}
        type="button"
      >
        {label}
      </button>
      {open ? (
        <div className="quality__menu" role="menu">
          {children}
        </div>
      ) : null}
    </div>
  )
}

export const ChatButton = ({
  onToggle,
  shown,
}: {
  readonly onToggle: () => void
  readonly shown: boolean
}) => (
  <button
    aria-label={shown ? t("Ocultar el chat") : t("Mostrar el chat")}
    aria-pressed={shown}
    className="icon-button icon-button--light"
    onClick={onToggle}
    title={shown ? t("Ocultar el chat (C)") : t("Mostrar el chat (C)")}
    type="button"
  >
    <ChatTextIcon />
  </button>
)

// El modo teatro es de la ventana: a pantalla completa no sale.
export const TheaterButton = ({
  fullscreen,
  onTheater,
  theater,
}: {
  readonly fullscreen: boolean
  readonly onTheater: (on: boolean) => void
  readonly theater: boolean
}) =>
  fullscreen ? null : (
    <button
      aria-label={t("Modo teatro")}
      aria-pressed={theater}
      className="icon-button icon-button--light icon-button--toggle"
      onClick={() => onTheater(!theater)}
      title={t("Modo teatro (T): el vídeo y el chat ocupan la ventana")}
      type="button"
    >
      {theater ? <ArrowsInLineHorizontalIcon /> : <ArrowsOutLineHorizontalIcon />}
    </button>
  )

export const FullscreenButton = ({
  fullscreen,
  onToggle,
}: {
  readonly fullscreen: boolean
  readonly onToggle: () => void
}) => (
  <button
    aria-label={fullscreen ? t("Salir de la pantalla completa") : t("Pantalla completa")}
    className="icon-button icon-button--light"
    onClick={onToggle}
    title={fullscreen ? t("Salir de la pantalla completa (F)") : t("Pantalla completa (F)")}
    type="button"
  >
    {fullscreen ? <CornersInIcon /> : <CornersOutIcon />}
  </button>
)
