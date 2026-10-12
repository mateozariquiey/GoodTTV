import { type ClientId, ClientIdSchema } from "@goodttv/contratos"

// The Client ID identifies this *application* to Twitch, not the viewer. It is public (not a
// secret), registered once in the Twitch developer console as a Public client. Forks should
// register their own; each version says how to pass it (the TV app: MAIN_VITE_TWITCH_CLIENT_ID at
// build time, TWITCH_CLIENT_ID at run time). Nobody types it with a remote.
export const PROJECT_CLIENT_ID = "q5asa7tpmoateti374pbjyfepb5gnx"

export type PublicSettings = {
  readonly clientId: ClientId | ""
}

// Where each version reads its settings from (the TV app: src/main/settings-store.ts).
export interface SettingsSource {
  readonly load: () => Promise<PublicSettings>
}

export const resolveClientId = (
  runtime: string | undefined,
  builtIn: string | undefined,
): ClientId | "" => {
  for (const candidate of [runtime, builtIn, PROJECT_CLIENT_ID]) {
    const parsed = ClientIdSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  return ""
}
