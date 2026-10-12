import { initials } from "@goodttv/interfaz"

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
    <span aria-hidden="true" className={`${className} avatar--initials`}>
      {initials(name)}
    </span>
  ) : (
    <img alt="" className={className} src={url} />
  )
