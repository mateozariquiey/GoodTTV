import type { SavedHome } from "@goodttv/contratos"
import type { HlsConfig } from "hls.js"
import { createContext, useContext } from "react"

// Lo que cambia entre versiones de GoodTTV en lo común. Por defecto, la tele.
export type Platform = {
  // Configuración de hls.js que añade la versión (la extensión: el FetchLoader, para que las peticiones a /stream/
  // pasen por la página).
  readonly hls: Partial<HlsConfig>
  // Inicio de la última vez, si la versión lo puede leer sin esperar (la extensión, de localStorage): así sale en la
  // primera imagen. Si no, useHome lo pide a window.api.home.
  readonly savedHome?: () => SavedHome | null
}

export const TV_PLATFORM: Platform = { hls: {} }

export const PlatformContext = createContext<Platform>(TV_PLATFORM)

export const usePlatform = (): Platform => useContext(PlatformContext)
