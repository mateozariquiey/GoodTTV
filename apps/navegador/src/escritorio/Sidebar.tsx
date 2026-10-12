import { type Channel, formatViewers } from "@goodttv/interfaz"
import { SidebarSimpleIcon } from "@phosphor-icons/react"
import { Avatar } from "./Avatar"

// Tus seguidos en directo, siempre a mano para cambiar de canal. Plegada, solo avatares (el nombre, al pasar el
// ratón). El canal que ves, en blanco: la marca de selección de GoodTTV.
export const Sidebar = ({
  channels,
  collapsed,
  current,
  loading,
  onCollapse,
  onOpen,
  signedIn,
}: {
  readonly channels: readonly Channel[]
  readonly collapsed: boolean
  readonly current: string | undefined
  readonly loading: boolean
  readonly onCollapse: () => void
  readonly onOpen: (channel: Channel) => void
  readonly signedIn: boolean
}) => (
  <aside aria-label="Siguiendo" className="sidebar">
    <div className="sidebar__head">
      <h2 className="sidebar__title">Siguiendo</h2>
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
    {!signedIn ? (
      <p className="sidebar__note">
        <a href="#/ajustes">Vincula tu cuenta</a> para ver aquí a quién sigues.
      </p>
    ) : loading && channels.length === 0 ? (
      <p className="sidebar__note">Cargando…</p>
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
