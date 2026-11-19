import type { CategoryCard } from "@goodttv/contratos"
import {
  type Channel,
  formatViewers,
  fromStream,
  t,
  tMensaje,
  useResource,
} from "@goodttv/interfaz"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { navigation } from "../navigation"
import { ChannelRow, StateMessage } from "../ui"
import { Preview } from "./HomeScreen"

// El directorio (D49) en la TV, con el mando: a la izquierda, las categorías con más espectadores ahora, y a la derecha,
// la enfocada en grande con sus cifras. OK abre sus directos, con la misma lista y la misma vista previa que Inicio, y
// Atrás vuelve a las categorías (App.tsx, que les da una capa de foco a cada una: cada lista recuerda dónde estaba).
const REFRESH_MS = 60_000

type CategoriesScreenProps = {
  readonly active: boolean
  readonly category: string | undefined // la abierta, por su nombre en las direcciones de twitch.tv
  readonly onCategory: (slug: string) => void
  readonly onWatch: (channel: Channel, lineup: readonly Channel[]) => void
}

// Refresca mientras se ve. Al llegar la lista por primera vez, el foco pasa de la pestaña a su primera fila (first, de
// la capa layer); después, si un refresco se lleva la fila enfocada, vuelve a algo que exista.
const useShown = <Value,>(
  load: (() => Promise<Value>) | undefined,
  shown: boolean,
  layer: string,
  first: (value: Value) => string | undefined,
) => {
  const { refresh, resource, retry } = useResource(load)
  useEffect(() => {
    if (!shown) return undefined
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh, shown])
  const firstNow = useRef(first)
  firstNow.current = first
  useEffect(() => {
    if (!shown || resource.kind === "loading") return
    const entry = resource.kind === "ready" ? firstNow.current(resource.value) : undefined
    requestAnimationFrame(() => {
      if (entry !== undefined && navigation.remembered(layer) === undefined)
        navigation.focus(layer, entry)
      else navigation.ensureFocus()
    })
  }, [layer, resource, shown])
  return { resource, retry }
}

const categoryId = (slug: string): string => `category-${slug}`
const streamId = (login: string): string => `category-stream-${login}`

const Counts = ({ category }: { readonly category: CategoryCard }) => (
  <span className="category__counts">
    <span className="viewers">
      {t("{n} espectadores", { n: formatViewers(category.viewerCount) })}
    </span>
    <span>{t("{n} canales", { n: formatViewers(category.channelCount) })}</span>
  </span>
)

const BoxArt = ({ category }: { readonly category: CategoryCard }) =>
  category.boxArtUrl === undefined ? (
    <span className="category__art" />
  ) : (
    <img alt="" className="category__art" src={category.boxArtUrl} />
  )

export const CategoriesScreen = ({
  active,
  category,
  onCategory,
  onWatch,
}: CategoriesScreenProps) => {
  // No se pide hasta entrar en la pestaña por primera vez.
  const [opened, setOpened] = useState(false)
  if (active && !opened) setOpened(true)
  const load = useCallback(() => window.api.catalog.categories(), [])
  const inList = active && category === undefined
  const { resource, retry } = useShown(
    opened ? load : undefined,
    inList,
    "tab-categories",
    (list) => (list[0] === undefined ? undefined : categoryId(list[0].slug)),
  )
  const categories = resource.kind === "ready" ? resource.value : []
  const [focusedId, setFocusedId] = useState<string>()
  const focused = categories.find((each) => each.id === focusedId) ?? categories[0]

  return (
    <>
      <div className="home" hidden={category !== undefined}>
        <div className="guide">
          {resource.kind === "loading" ? (
            <StateMessage kind="loading" title={t("Cargando categorías…")} />
          ) : resource.kind === "error" ? (
            <StateMessage
              action={{ id: "categories-retry", label: t("Reintentar"), run: retry }}
              detail={tMensaje(resource.message)}
              kind="error"
              title={t("No se pudieron cargar las categorías")}
            />
          ) : categories.length === 0 ? (
            <StateMessage kind="empty" title={t("Twitch no ha dado ninguna categoría.")} />
          ) : (
            <ol className="guide__list">
              {categories.map((each, index) => (
                <li key={each.id}>
                  <button
                    className="row"
                    data-nav
                    data-nav-entry={index === 0 ? "" : undefined}
                    data-nav-id={categoryId(each.slug)}
                    onClick={() => onCategory(each.slug)}
                    onFocus={() => setFocusedId(each.id)}
                    type="button"
                  >
                    <span aria-hidden="true" className="category__rank">
                      {index + 1}
                    </span>
                    <BoxArt category={each} />
                    <span className="row__main">
                      <strong className="row__name">{each.name}</strong>
                      <Counts category={each} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
        {focused === undefined ? (
          <aside className="preview preview--empty" />
        ) : (
          <aside aria-live="polite" className="preview category-preview">
            {focused.boxArtUrl === undefined ? null : (
              // La carátula llega a 144 × 192: en grande, la misma con más píxeles.
              <img
                alt=""
                className="category-preview__art"
                key={focused.id}
                src={focused.boxArtUrl.replace("-144x192.", "-432x576.")}
              />
            )}
            <div>
              <h1 className="preview__title">{focused.name}</h1>
              <p className="preview__meta">
                <Counts category={focused} />
              </p>
              <p className="preview__hint">
                <kbd>OK</kbd> {t("para ver sus directos")}
              </p>
            </div>
          </aside>
        )}
      </div>
      {category === undefined ? null : (
        <CategoryStreams active={active} key={category} onWatch={onWatch} slug={category} />
      )}
    </>
  )
}

const CategoryStreams = ({
  active,
  onWatch,
  slug,
}: {
  readonly active: boolean
  readonly onWatch: (channel: Channel, lineup: readonly Channel[]) => void
  readonly slug: string
}) => {
  const load = useCallback(() => window.api.catalog.category(slug), [slug])
  const { resource, retry } = useShown(load, active, "tab-category", (value) =>
    value?.streams[0] === undefined ? undefined : streamId(value.streams[0].userLogin),
  )
  const found = resource.kind === "ready" ? resource.value : null
  const channels = useMemo(() => found?.streams.map(fromStream) ?? [], [found])
  const [focusedLogin, setFocusedLogin] = useState<string>()
  const focused = channels.find((each) => each.login === focusedLogin) ?? channels[0]
  return (
    <div className="home">
      <div className="guide">
        {resource.kind === "loading" ? (
          <StateMessage kind="loading" title={t("Cargando canales…")} />
        ) : resource.kind === "error" ? (
          <StateMessage
            action={{ id: "category-retry", label: t("Reintentar"), run: retry }}
            detail={tMensaje(resource.message)}
            kind="error"
            title={t("No se pudieron cargar las categorías")}
          />
        ) : found === null ? (
          <StateMessage kind="empty" title={t("Esa categoría no existe en Twitch.")} />
        ) : (
          <section aria-label={found.category.name} className="guide__section">
            <h2 className="guide__heading">
              <span>{found.category.name}</span>
              <Counts category={found.category} />
            </h2>
            {channels.length === 0 ? (
              <p className="guide__empty">{t("Nadie la emite ahora.")}</p>
            ) : (
              <ul className="guide__list">
                {channels.map((channel, index) => (
                  <li key={channel.login}>
                    <ChannelRow
                      channel={channel}
                      entry={index === 0}
                      navId={streamId(channel.login)}
                      onFocus={() => setFocusedLogin(channel.login)}
                      onOpen={() => onWatch(channel, channels)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      <Preview channel={focused} known signedIn />
    </div>
  )
}
