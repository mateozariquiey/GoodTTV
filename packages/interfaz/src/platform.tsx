import type { HlsConfig } from "hls.js"
import { createContext, useContext } from "react"

// Lo que cambia entre versiones de GoodTTV en lo común. Por defecto, la tele.
export type Platform = {
  // Configuración de hls.js que añade la versión (la extensión: el FetchLoader, para que las peticiones a /stream/
  // pasen por la página).
  readonly hls: Partial<HlsConfig>
}

export const TV_PLATFORM: Platform = { hls: {} }

export const PlatformContext = createContext<Platform>(TV_PLATFORM)

export const usePlatform = (): Platform => useContext(PlatformContext)
