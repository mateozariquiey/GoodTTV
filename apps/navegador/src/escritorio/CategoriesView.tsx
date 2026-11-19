import type { CategoryCard } from "@goodttv/contratos"
import {
  type Channel,
  formatViewers,
  fromStream,
  t,
  tMensaje,
  useRefreshWhileVisible,
  useResource,
} from "@goodttv/interfaz"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import { useCallback } from "react"
import { StreamGrid } from "./HomeView"
import { routeHash } from "./routes"

// El directorio (D49): qué se está viendo en Twitch ahora mismo, de más a menos espectadores, y los directos de una
// categoría. Sin cuenta también, como «Populares ahora». Lo de explorar va aparte de Inicio, que sigue siendo de tus
// seguidos: se llega por «Categorías», arriba.
const REFRESH_MS = 60_000
const PLACEHOLDERS = 24

const BoxArt = ({
  category,
  large = false,
}: {
  readonly category: CategoryCard
  readonly large?: boolean
}) => {
  const className = large ? "category__art category__art--large" : "category__art"
  return category.boxArtUrl === undefined ? (
    <span className={className} />
  ) : (
    <img alt="" className={className} loading="lazy" src={category.boxArtUrl} />
  )
}

const Counts = ({ category }: { readonly category: CategoryCard }) => (
  <>
    <span className="live-count">
      <i aria-hidden="true" />
      {t("{n} espectadores", { n: formatViewers(category.viewerCount) })}
    </span>
    <span className="category__channels">
      {t("{n} canales", { n: formatViewers(category.channelCount) })}
    </span>
  </>
)

const Failed = ({
  message,
  onRetry,
}: {
  readonly message: string
  readonly onRetry: () => void
}) => (
  <div className="notice-block">
    <p>{t("No se pudieron cargar las categorías ({error}).", { error: tMensaje(message) })}</p>
    <button className="button" onClick={onRetry} type="button">
      {t("Reintentar")}
    </button>
  </div>
)

export const CategoriesView = () => {
  const load = useCallback(() => window.api.catalog.categories(), [])
  const { refresh, resource, retry } = useResource(load)
  useRefreshWhileVisible(refresh, REFRESH_MS)
  return (
    <div className="page">
      <h2 className="page__section">{t("Categorías")}</h2>
      {resource.kind === "error" ? (
        <Failed message={resource.message} onRetry={retry} />
      ) : resource.kind === "loading" ? (
        <ol aria-busy="true" className="categories">
          {Array.from({ length: PLACEHOLDERS }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: huecos iguales, sin nada propio
            <li aria-hidden="true" className="category placeholder" key={index}>
              <span className="category__art" />
            </li>
          ))}
        </ol>
      ) : resource.value.length === 0 ? (
        <p className="page__note">{t("Twitch no ha dado ninguna categoría.")}</p>
      ) : (
        <ol className="categories">
          {resource.value.map((category, index) => (
            <li key={category.id}>
              <a className="category" href={routeHash({ slug: category.slug, view: "category" })}>
                <span aria-hidden="true" className="category__rank">
                  {index + 1}
                </span>
                <BoxArt category={category} />
                <span className="category__text">
                  <b className="category__name" title={category.name}>
                    {category.name}
                  </b>
                  <Counts category={category} />
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export const CategoryView = ({
  onOpen,
  slug,
}: {
  readonly onOpen: (channel: Channel) => void
  readonly slug: string
}) => {
  const load = useCallback(() => window.api.catalog.category(slug), [slug])
  const { refresh, resource, retry } = useResource(load)
  useRefreshWhileVisible(refresh, REFRESH_MS)
  const back = (
    <a className="category-back" href={routeHash({ view: "categories" })}>
      <ArrowLeftIcon aria-hidden="true" />
      {t("Categorías")}
    </a>
  )
  if (resource.kind === "error")
    return (
      <div className="page">
        {back}
        <Failed message={resource.message} onRetry={retry} />
      </div>
    )
  if (resource.kind === "loading")
    return (
      <div className="page">
        {back}
        <p className="page__note">{t("Cargando…")}</p>
      </div>
    )
  if (resource.value === null)
    return (
      <div className="page">
        {back}
        <p className="page__note">{t("Esa categoría no existe en Twitch.")}</p>
      </div>
    )
  const { category, streams } = resource.value
  return (
    <div className="page">
      {back}
      <header className="category-head">
        <BoxArt category={category} large />
        <div className="category-head__text">
          <h2 className="category-head__name">{category.name}</h2>
          <p className="category-head__counts">
            <Counts category={category} />
          </p>
        </div>
      </header>
      {streams.length === 0 ? (
        <p className="page__note">{t("Nadie la emite ahora.")}</p>
      ) : (
        <StreamGrid
          channels={streams.map(fromStream)}
          onOpen={onOpen}
          poster={false}
          withCategory={false}
        />
      )}
    </div>
  )
}
