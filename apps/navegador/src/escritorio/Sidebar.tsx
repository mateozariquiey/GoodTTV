import { type Channel, type FollowedOrder, formatViewers } from "@goodttv/interfaz"
import { ArrowsDownUpIcon, CheckIcon, SidebarSimpleIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Avatar } from "./Avatar"

// Tus seguidos en directo, siempre a mano para cambiar de canal. Plegada, solo avatares (el nombre, al pasar el
// ratón). El canal que ves, en blanco: la marca de selección de GoodTTV. Se ordenan por espectadores o, como el
// «Recomendado para ti» de Twitch, primero los que más ves (watch-time.ts).
const ORDERS: readonly (readonly [FollowedOrder, string, string])[] = [
  ["recomendado", "Recomendado para ti", "Primero los que más ves en GoodTTV"],
  ["espectadores", "Espectadores", "De más a menos espectadores"],
]

export const Sidebar = ({
  channels,
  collapsed,
  current,
  failed,
  loading,
  onCollapse,
  onOpen,
  onOrder,
  order,
  placeholders,
  signedIn,
}: {
  readonly channels: readonly Channel[]
  readonly collapsed: boolean
  readonly current: string | undefined
  readonly failed: boolean
  readonly loading: boolean
  readonly onCollapse: () => void
  readonly onOpen: (channel: Channel) => void
  readonly onOrder: (order: FollowedOrder) => void
  readonly order: FollowedOrder
  readonly placeholders: number // los huecos que pintar mientras carga: los que había la última vez
  readonly signedIn: boolean
}) => (
  <aside aria-label="Siguiendo" className="sidebar">
    <div className="sidebar__head">
      <h2 className="sidebar__title">Siguiendo</h2>
      {signedIn && !collapsed ? <OrderMenu onOrder={onOrder} order={order} /> : null}
      <button
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Desplegar la columna" : "Plegar la columna"}
        className="icon-button icon-button--small"
        onClick={onCollapse}
        title={collapsed ? "Desplegar la columna" : "Plegar la columna"}
        type="button"
      >
        <SidebarSimpleIcon aria-hidden="true" />
      </button>
    </div>
    {loading && channels.length === 0 && placeholders > 0 ? (
      <ul aria-busy="true" className="sidebar__list">
        {Array.from({ length: placeholders }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: huecos iguales, sin nada propio
          <li aria-hidden="true" className="sidebar__channel placeholder" key={index}>
            <span className="avatar" />
            <span className="sidebar__text">
              <b className="sidebar__name">&nbsp;</b>
              <span className="sidebar__category">&nbsp;</span>
            </span>
          </li>
        ))}
      </ul>
    ) : loading && channels.length === 0 ? (
      <p className="sidebar__note">Cargando…</p>
    ) : failed && channels.length === 0 ? (
      <p className="sidebar__note">No se pudo cargar.</p>
    ) : !signedIn ? (
      <p className="sidebar__note">
        <a href="#/ajustes">Vincula tu cuenta</a> para ver aquí a quién sigues.
      </p>
    ) : channels.length === 0 ? (
      <p className="sidebar__note">Ninguno de tus seguidos está en directo.</p>
    ) : (
      <ul className="sidebar__list">
        {channels.map((channel) => (
          <li key={channel.login}>
            <a
              aria-current={channel.login === current ? "page" : undefined}
              className="sidebar__channel"
              href={`#/canal/${channel.login}`}
              onClick={(event) => {
                event.preventDefault()
                onOpen(channel)
              }}
              title={
                collapsed
                  ? `${channel.displayName}: ${channel.category ?? ""}`.replace(/: $/, "")
                  : undefined
              }
            >
              <Avatar name={channel.displayName} url={channel.profileImageUrl} />
              <span className="sidebar__text">
                <b className="sidebar__name">{channel.displayName}</b>
                <span className="sidebar__category">{channel.category}</span>
              </span>
              <span className="live-count">
                <i aria-hidden="true" />
                {channel.viewerCount === undefined ? "" : formatViewers(channel.viewerCount)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    )}
  </aside>
)

// El orden de la columna, en un menú como el de Twitch. Se cierra al elegir, con Esc o con un clic fuera.
const OrderMenu = ({
  onOrder,
  order,
}: {
  readonly onOrder: (order: FollowedOrder) => void
  readonly order: FollowedOrder
}) => {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // Al cerrarse con el foco dentro (Esc, o elegir con el teclado), vuelve al botón: el elegido desaparece con el menú.
  const close = useCallback((): void => {
    if (menu.current?.contains(document.activeElement)) trigger.current?.focus()
    setOpen(false)
  }, [])
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || event.target.closest(".order") === null)
        setOpen(false)
    }
    // Esc solo cierra el menú (en la captura, antes que el Esc general de la ventana).
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return
      event.preventDefault()
      close()
    }
    addEventListener("pointerdown", onPointer, { capture: true })
    addEventListener("keydown", onKey, { capture: true })
    return () => {
      removeEventListener("pointerdown", onPointer, { capture: true })
      removeEventListener("keydown", onKey, { capture: true })
    }
  }, [close, open])
  return (
    <div className="order">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Ordenar"
        className="icon-button icon-button--small"
        onClick={() => setOpen((value) => !value)}
        ref={trigger}
        title="Ordenar"
        type="button"
      >
        <ArrowsDownUpIcon aria-hidden="true" />
      </button>
      {open ? (
        <div className="order__menu" ref={menu} role="menu">
          <p className="order__title">Ordenar por</p>
          {ORDERS.map(([value, label, hint]) => (
            <button
              aria-checked={value === order}
              className="order__option"
              key={value}
              onClick={() => {
                onOrder(value)
                close()
              }}
              role="menuitemradio"
              title={hint}
              type="button"
            >
              <span>{label}</span>
              {value === order ? <CheckIcon aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
