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
import { type ReactNode, useCallback, useEffect } from "react"
import { Barra } from "./comun"
import { Lista } from "./Inicio"
import { routeHash } from "./rutas"

// El directorio (D49), como en la extensión, para el dedo: las categorías con más espectadores ahora, en una lista con su
// puesto, su carátula pequeña y sus cifras, y los directos de una, con las filas de Inicio. Se llega desde la barra de
// Inicio. Las dos pantallas siguen montadas debajo de lo que se abre desde ellas (App.tsx), para volver donde se estaba:
// mientras están debajo (hidden) no se refrescan, y al volver, sí.
const REFRESH_MS = 60_000
const HUECOS = 12

const useDirectorio = <Value,>(load: () => Promise<Value>, hidden: boolean) => {
  const { refresh, resource, retry } = useResource(load)
  const refreshShown = useCallback(() => {
    if (!hidden) void refresh()
  }, [hidden, refresh])
  useRefreshWhileVisible(refreshShown, REFRESH_MS)
  // Al volver a ella, al día; al montarse ya carga useResource.
  useEffect(() => {
    if (!hidden) void refresh()
  }, [hidden, refresh])
  return { resource, retry }
}

const Caratula = ({ category }: { readonly category: CategoryCard }) =>
  category.boxArtUrl === undefined ? (
    <span className="categoria__caratula" />
  ) : (
    <img alt="" className="categoria__caratula" loading="lazy" src={category.boxArtUrl} />
  )

const Cifras = ({ category }: { readonly category: CategoryCard }) => (
  <span className="categoria__cifras">
    <span className="en-directo">
      <i aria-hidden="true" />
      {t("{n} espectadores", { n: formatViewers(category.viewerCount) })}
    </span>
    <span>{t("{n} canales", { n: formatViewers(category.channelCount) })}</span>
  </span>
)

const Pantalla = ({
  children,
  hidden,
  titulo,
}: {
  readonly children: ReactNode
  readonly hidden: boolean
  readonly titulo: string
}) => (
  <div className={hidden ? "pantalla pantalla--debajo" : "pantalla"}>
    <Barra>
      <h1 className="barra__titulo">{titulo}</h1>
    </Barra>
    {children}
  </div>
)

const Fallo = ({
  message,
  onRetry,
}: {
  readonly message: string
  readonly onRetry: () => void
}) => (
  <div className="aviso">
    <p>{t("No se pudieron cargar las categorías ({error}).", { error: tMensaje(message) })}</p>
    <button className="boton" onClick={onRetry} type="button">
      {t("Reintentar")}
    </button>
  </div>
)

export const Categorias = ({ hidden }: { readonly hidden: boolean }) => {
  const load = useCallback(() => window.api.catalog.categories(), [])
  const { resource, retry } = useDirectorio(load, hidden)
  return (
    <Pantalla hidden={hidden} titulo={t("Categorías")}>
      {resource.kind === "error" ? (
        <Fallo message={resource.message} onRetry={retry} />
      ) : resource.kind === "loading" ? (
        <ol aria-busy="true" className="categorias">
          {Array.from({ length: HUECOS }, (_, index) => (
            <li aria-hidden="true" className="categoria hueco" key={index}>
              <span className="categoria__caratula" />
            </li>
          ))}
        </ol>
      ) : resource.value.length === 0 ? (
        <p className="nota">{t("Twitch no ha dado ninguna categoría.")}</p>
      ) : (
        <ol className="categorias">
          {resource.value.map((category, index) => (
            <li key={category.id}>
              <a className="categoria" href={routeHash({ slug: category.slug, view: "category" })}>
                <span aria-hidden="true" className="categoria__puesto">
                  {index + 1}
                </span>
                <Caratula category={category} />
                <span className="categoria__texto">
                  <b className="categoria__nombre">{category.name}</b>
                  <Cifras category={category} />
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </Pantalla>
  )
}

// En la lista de una categoría, cada directo va sin su línea de categoría, que es la misma en todos.
const sinCategoria = ({ category: _, ...channel }: Channel): Channel => channel

export const Categoria = ({
  hidden,
  onOpen,
  slug,
}: {
  readonly hidden: boolean
  readonly onOpen: (channel: Channel) => void
  readonly slug: string
}) => {
  const load = useCallback(() => window.api.catalog.category(slug), [slug])
  const { resource, retry } = useDirectorio(load, hidden)
  const found = resource.kind === "ready" ? resource.value : null
  return (
    <Pantalla hidden={hidden} titulo={found?.category.name ?? t("Categorías")}>
      {resource.kind === "error" ? (
        <Fallo message={resource.message} onRetry={retry} />
      ) : resource.kind === "loading" ? (
        <p className="nota">{t("Cargando…")}</p>
      ) : found === null ? (
        <p className="nota">{t("Esa categoría no existe en Twitch.")}</p>
      ) : (
        <>
          <div className="categoria categoria--cabecera">
            <Caratula category={found.category} />
            <Cifras category={found.category} />
          </div>
          {found.streams.length === 0 ? (
            <p className="nota">{t("Nadie la emite ahora.")}</p>
          ) : (
            <Lista
              channels={found.streams.map((stream) => sinCategoria(fromStream(stream)))}
              onOpen={onOpen}
            />
          )}
        </>
      )}
    </Pantalla>
  )
}
