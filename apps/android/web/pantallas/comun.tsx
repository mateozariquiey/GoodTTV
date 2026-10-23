import { initials } from "@goodttv/interfaz"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import { type ReactNode, useState } from "react"
import { atras } from "./rutas"

// Piezas que comparten las pantallas.

// Foto del canal o, si no hay, sus iniciales.
export const Avatar = ({
  className = "avatar",
  name,
  url,
}: {
  readonly className?: string
  readonly name: string
  readonly url: string | undefined
}) =>
  url === undefined ? (
    <span aria-hidden="true" className={`${className} avatar--iniciales`}>
      {initials(name)}
    </span>
  ) : (
    <img alt="" className={className} src={url} />
  )

// La barra de arriba de una pantalla que no es Inicio: la flecha, que hace lo mismo que Atrás, y lo que lleve.
export const Barra = ({ children }: { readonly children: ReactNode }) => (
  <header className="barra">
    <button aria-label="Volver" className="boton-icono" onClick={() => atras()} type="button">
      <ArrowLeftIcon />
    </button>
    {children}
  </header>
)

// «Reintentar» que espera a la respuesta: mientras, dice «Comprobando…» y no repite.
export const Reintentar = ({ onRetry }: { readonly onRetry: () => Promise<void> }) => {
  const [retrying, setRetrying] = useState(false)
  return (
    <button
      aria-busy={retrying}
      className="boton"
      onClick={() => {
        if (retrying) return
        setRetrying(true)
        void onRetry().finally(() => setRetrying(false))
      }}
      type="button"
    >
      {retrying ? "Comprobando…" : "Reintentar"}
    </button>
  )
}
