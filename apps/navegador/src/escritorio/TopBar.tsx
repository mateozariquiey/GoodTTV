import type { Channel } from "@goodttv/interfaz"
import { GearSixIcon } from "@phosphor-icons/react"
import type { RefObject } from "react"
import { Avatar } from "./Avatar"
import { Search } from "./Search"

export const TopBar = ({
  account,
  onOpen,
  searchRef,
  signedIn,
}: {
  readonly account:
    | { readonly displayName: string; readonly profileImageUrl?: string | undefined }
    | undefined
  readonly onOpen: (channel: Channel) => void
  readonly searchRef: RefObject<HTMLInputElement | null>
  readonly signedIn: boolean
}) => (
  <header className="topbar">
    <a aria-label="GoodTTV, Inicio" className="brand" href="#/">
      <span aria-hidden="true" className="brand__logo" />
      <span className="brand__name">GoodTTV</span>
    </a>
    <Search inputRef={searchRef} onOpen={onOpen} signedIn={signedIn} />
    <nav aria-label="Cuenta" className="topbar__end">
      <a aria-label="Ajustes" className="icon-button" href="#/ajustes" title="Ajustes">
        <GearSixIcon aria-hidden="true" />
      </a>
      {account === undefined ? null : (
        <a
          className="topbar__account"
          href="#/ajustes"
          title={`Conectado como ${account.displayName}`}
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
