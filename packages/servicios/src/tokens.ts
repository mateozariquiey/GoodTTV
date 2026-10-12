import { z } from "zod"

export const StoredTokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string(),
  refreshToken: z.string().min(1),
})

export type StoredToken = z.infer<typeof StoredTokenSchema>

// Where each version keeps the Twitch session (the TV app: encrypted with the system keyring when
// there is one, src/main/token-vault.ts). isSecure: whether it is encrypted at rest.
export interface TokenStore {
  readonly isSecure: boolean
  readonly clear: () => Promise<void>
  readonly load: () => Promise<StoredToken | undefined>
  readonly save: (token: StoredToken) => Promise<void>
}
