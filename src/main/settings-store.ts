import { type ClientId, ClientIdSchema } from "../shared/contracts"

// The Client ID identifies this *application* to Twitch, not the viewer. It is public (not a
// secret), registered once in the Twitch developer console as a Public client. Forks should
// register their own and build with MAIN_VITE_TWITCH_CLIENT_ID; TWITCH_CLIENT_ID overrides it at
// run time. Nobody types it with a remote.
export const PROJECT_CLIENT_ID = "q5asa7tpmoateti374pbjyfepb5gnx"

export type PublicSettings = {
  readonly clientId: ClientId | ""
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

export class SettingsStore {
  readonly #clientId: ClientId | ""

  public constructor(
    runtime: string | undefined = process.env["TWITCH_CLIENT_ID"],
    builtIn: string | undefined = import.meta.env.MAIN_VITE_TWITCH_CLIENT_ID,
  ) {
    this.#clientId = resolveClientId(runtime, builtIn)
  }

  public async load(): Promise<PublicSettings> {
    return { clientId: this.#clientId }
  }
}
