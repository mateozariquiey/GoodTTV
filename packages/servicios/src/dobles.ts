import { ClientIdSchema } from "@goodttv/contratos"
import type { SettingsSource } from "./settings"
import type { StoredToken, TokenStore } from "./tokens"

// Solo para las pruebas de la cuenta y de Helix (twitch-*.test.ts): dónde guarda cada versión la sesión y de dónde
// saca el Client ID, sin Node ni el navegador. Hacen lo mismo que el TokenVault y el SettingsStore de la TV.

export const TEST_CLIENT_ID = "abcdefghijklmnopqrstuvwxyz1234"

export const testSettings = (): SettingsSource => ({
  load: async () => ({ clientId: ClientIdSchema.parse(TEST_CLIENT_ID) }),
})

// La sesión en memoria, cifrada como la de la TV con el llavero (isSecure). Guarda una copia, como al escribirla en
// un archivo: lo que se cambie después en el objeto guardado no la toca.
export const memoryTokens = (): TokenStore => {
  let saved: StoredToken | undefined
  return {
    clear: async () => {
      saved = undefined
    },
    isSecure: true,
    load: async () => (saved === undefined ? undefined : structuredClone(saved)),
    save: async (token) => {
      saved = structuredClone(token)
    },
  }
}
