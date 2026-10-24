import { PictureInPictureIcon } from "@phosphor-icons/react"

// Imagen en imagen: el navegador saca el vídeo a una ventana pequeña que se queda encima, para seguir viéndolo en otra
// pestaña o en otra aplicación. Solo si el navegador lo admite (Chrome, y Firefox y Zen desde que traen la API: Firefox
// 158 y Zen 1.23 ya la tienen). Con el vídeo estrecho no sale (desktop.css), como «En directo».
const supported = typeof document !== "undefined" && document.pictureInPictureEnabled === true

export const PictureInPictureButton = ({
  active,
  onToggle,
}: {
  readonly active: boolean
  readonly onToggle: () => void
}) =>
  supported ? (
    <button
      aria-label="Imagen en imagen"
      aria-pressed={active}
      className="icon-button icon-button--light icon-button--toggle pip-button"
      onClick={onToggle}
      title={
        active
          ? "Volver a ver el vídeo aquí"
          : "Imagen en imagen: el vídeo, en una ventana pequeña encima de todo"
      }
      type="button"
    >
      <PictureInPictureIcon />
    </button>
  ) : null
