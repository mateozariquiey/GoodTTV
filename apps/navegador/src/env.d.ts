/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Client ID de Twitch de un fork; sin él, el del proyecto (@goodttv/servicios, settings.ts).
  readonly VITE_TWITCH_CLIENT_ID?: string
}
