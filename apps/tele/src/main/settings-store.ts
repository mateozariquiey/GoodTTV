import type { ClientId } from "@goodttv/contratos"
import { type PublicSettings, resolveClientId, type SettingsSource } from "@goodttv/servicios"

// The TV app's Client ID: TWITCH_CLIENT_ID at run time, then MAIN_VITE_TWITCH_CLIENT_ID from the
// build, then the project's own (@goodttv/servicios, settings.ts).
export class SettingsStore implements SettingsSource {
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
