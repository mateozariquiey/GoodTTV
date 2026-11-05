import type { Channel } from "@goodttv/interfaz"
import { t } from "@goodttv/interfaz"
import { GearSixIcon } from "@phosphor-icons/react"
import type { RefObject } from "react"
import { Avatar } from "./Avatar"
import { Search } from "./Search"

export const TopBar = ({
  account,
  onOpen,
  searchRef,
}: {
  readonly account:
    | { readonly displayName: string; readonly profileImageUrl?: string | undefined }
    | undefined
  readonly onOpen: (channel: Channel) => void
  readonly searchRef: RefObject<HTMLInputElement | null>
}) => (
  <header className="topbar">
    <a aria-label={t("GoodTTV, Inicio")} className="brand" href="#/">
      <span aria-hidden="true" className="brand__logo" />
      <span className="brand__name">GoodTTV</span>
    </a>
    <Search inputRef={searchRef} onOpen={onOpen} />
    <nav aria-label={t("Cuenta")} className="topbar__end">
      <a aria-label={t("Ajustes")} className="icon-button" href="#/ajustes" title={t("Ajustes")}>
        <GearSixIcon aria-hidden="true" />
      </a>
      {account === undefined ? null : (
        <a
          className="topbar__account"
          href="#/ajustes"
          title={t("Conectado como {displayName}", { displayName: account.displayName })}
        >
          <Avatar
            className="avatar avatar--small"
            name={account.displayName}
            url={account.profileImageUrl}
          />
        </a>
      )}
    </nav>
  </header>
)
