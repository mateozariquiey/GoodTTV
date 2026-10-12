import { useState } from "react"
import { type Channel, initials } from "./channel"
import { formatUptime, formatViewers } from "./data"

// Small shared pieces. Every focusable control is a real <button> with data-nav.

export const Avatar = ({
  channel,
  size = "md",
}: {
  readonly channel: Channel
  readonly size?: "md" | "sm" | "lg"
}) => {
  const [failed, setFailed] = useState(false)
  return (
    <span aria-hidden="true" className={`avatar avatar--${size}`}>
      {channel.profileImageUrl === undefined || failed ? (
        initials(channel.displayName)
      ) : (
        <img alt="" onError={() => setFailed(true)} src={channel.profileImageUrl} />
      )}
    </span>
  )
}

export const LiveBadge = () => <span className="live-badge">EN DIRECTO</span>

export const Viewers = ({ channel }: { readonly channel: Channel }) =>
  channel.viewerCount === undefined ? null : (
    <span className="viewers">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0Z" />
      </svg>
      {formatViewers(channel.viewerCount)}
    </span>
  )

export const Uptime = ({ channel }: { readonly channel: Channel }) =>
  channel.startedAt === undefined ? null : <span>{formatUptime(channel.startedAt)}</span>

type StateMessageProps = {
  readonly action?: { readonly id: string; readonly label: string; readonly run: () => void }
  readonly detail?: string
  readonly kind: "loading" | "empty" | "error"
  readonly title: string
}

// Loading, empty and error states always say what happened and, when useful, offer one action.
export const StateMessage = ({ action, detail, kind, title }: StateMessageProps) => (
  <div className={`state state--${kind}`} role={kind === "error" ? "alert" : "status"}>
    {kind === "loading" ? <span aria-hidden="true" className="spinner" /> : null}
    <p className="state__title">{title}</p>
    {detail === undefined ? null : <p className="state__detail">{detail}</p>}
    {action === undefined ? null : (
      <button
        className="button button--primary"
        data-nav
        data-nav-id={action.id}
        onClick={action.run}
        type="button"
      >
        {action.label}
      </button>
    )}
  </div>
)

type ChannelRowProps = {
  readonly channel: Channel
  readonly entry?: boolean
  readonly navId: string
  readonly onFocus?: () => void
  readonly onOpen: () => void
}

// One channel in a guide-style list: who, how many, what and for how long.
export const ChannelRow = ({ channel, entry = false, navId, onFocus, onOpen }: ChannelRowProps) => (
  <button
    aria-label={`${channel.displayName}${channel.live === false ? ", desconectado" : ""}`}
    className={`row${channel.live === false ? " row--offline" : ""}`}
    data-nav
    data-nav-entry={entry ? "" : undefined}
    data-nav-id={navId}
    onClick={onOpen}
    onFocus={onFocus}
    type="button"
  >
    <Avatar channel={channel} />
    <span className="row__main">
      <span className="row__line">
        <strong className="row__name">{channel.displayName}</strong>
        {channel.live === false ? (
          <span className="row__offline">Desconectado</span>
        ) : (
          <Viewers channel={channel} />
        )}
      </span>
      {channel.live === false || channel.category === undefined ? null : (
        <span className="row__line row__line--meta">
          <span className="row__category">{channel.category}</span>
          <Uptime channel={channel} />
        </span>
      )}
      {channel.title === undefined || channel.title === "" ? null : (
        <span className="row__title">{channel.title}</span>
      )}
    </span>
  </button>
)
