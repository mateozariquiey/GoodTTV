import { z } from "zod"

// La cuenta del token, como la da /validate, guardada con él: así, al abrir, lo que se pide a Helix no espera a
// validarlo otra vez (TwitchSession). Las sesiones de antes no la tienen hasta la primera validación.
export const StoredIdentitySchema = z.object({
  login: z.string().min(1),
  scopes: z.array(z.string()),
  user_id: z.string().min(1),
})

export const StoredTokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string(),
  identity: StoredIdentitySchema.optional(),
  refreshToken: z.string().min(1),
})

export type StoredIdentity = z.infer<typeof StoredIdentitySchema>
export type StoredToken = z.infer<typeof StoredTokenSchema>

// Where each version keeps the Twitch session (the TV app: encrypted with the system keyring when
// there is one, src/main/token-vault.ts). isSecure: whether it is encrypted at rest.
export interface TokenStore {
  readonly isSecure: boolean
  readonly clear: () => Promise<void>
  readonly load: () => Promise<StoredToken | undefined>
  readonly save: (token: StoredToken) => Promise<void>
  // Si varias páginas comparten la sesión (pestañas de la extensión): ejecuta la operación sin que otra renueve el
  // token a la vez. El token de renovación solo vale una vez. Sin esto, la operación sin más.
  readonly exclusive?: <Result>(operation: () => Promise<Result>) => Promise<Result>
}
