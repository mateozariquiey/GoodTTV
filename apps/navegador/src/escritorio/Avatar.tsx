import { avatarAt, initials } from "@goodttv/interfaz"

// Foto del canal o, si no hay, sus iniciales.
export const Avatar = ({
  className = "avatar",
  name,
  size = 32,
  url,
}: {
  readonly className?: string
  readonly name: string
  readonly size?: number // lo que ocupa (px de CSS), para pedir la foto a su medida: el de la clase
  readonly url: string | undefined
}) =>
  url === undefined ? (
    <span aria-hidden="true" className={`${className} avatar--initials`}>
      {initials(name)}
    </span>
  ) : (
    <img alt="" className={className} src={avatarAt(url, size)} />
  )
