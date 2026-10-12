import {
  type Preferences,
  type PreferencesPatch,
  PreferencesPatchSchema,
  PreferencesSchema,
  RECENTS_LIMIT,
  type RecentChannel,
  RecentChannelSchema,
  RecentsListSchema,
} from "@goodttv/contratos"
import { z } from "zod"

// Recently watched channels and viewing preferences, local to this installation. Writes are
// serialized; where the text is kept depends on the version (the TV app: an owner-only file
// written atomically, src/main/local-store.ts).

export interface TextStorage {
  // undefined: nothing saved yet.
  readonly read: () => Promise<string | undefined>
  readonly write: (text: string) => Promise<void>
}

const StoredSchema = z.strictObject({
  preferences: PreferencesSchema,
  recents: RecentsListSchema,
  version: z.literal(1),
})
type Stored = z.infer<typeof StoredSchema>

export const DEFAULT_PREFERENCES: Preferences = {
  chatScale: "normal",
  chatVisible: true,
  latencyMode: "adaptativo",
}
const EMPTY: Stored = { preferences: DEFAULT_PREFERENCES, recents: [], version: 1 }

export class LocalStore {
  readonly #storage: TextStorage
  #operations: Promise<void> = Promise.resolve()

  public constructor(storage: TextStorage) {
    this.#storage = storage
  }

  public recents(): Promise<readonly RecentChannel[]> {
    return this.#serialize(async () => (await this.#load()).recents)
  }

  // Moves the channel to the front, replacing an older entry for the same login.
  public addRecent(input: RecentChannel): Promise<readonly RecentChannel[]> {
    return this.#serialize(async () => {
      const entry = RecentChannelSchema.parse(input)
      const stored = await this.#load()
      const previous = stored.recents.find((recent) => recent.login === entry.login)
      const merged: RecentChannel = {
        ...previous,
        ...entry,
      }
      const recents = [
        merged,
        ...stored.recents.filter((recent) => recent.login !== entry.login),
      ].slice(0, RECENTS_LIMIT)
      await this.#persist({ ...stored, recents })
      return recents
    })
  }

  public preferences(): Promise<Preferences> {
    return this.#serialize(async () => (await this.#load()).preferences)
  }

  public updatePreferences(patch: PreferencesPatch): Promise<Preferences> {
    return this.#serialize(async () => {
      const parsed = PreferencesPatchSchema.parse(patch)
      const stored = await this.#load()
      const preferences = PreferencesSchema.parse({ ...stored.preferences, ...parsed })
      await this.#persist({ ...stored, preferences })
      return preferences
    })
  }

  async #load(): Promise<Stored> {
    const contents = await this.#storage.read()
    if (contents === undefined) return EMPTY
    // A damaged or truncated file must not lock the viewer out of the app: start again from
    // defaults. The next save replaces it.
    let json: unknown
    try {
      json = JSON.parse(contents)
    } catch {
      return EMPTY
    }
    // Preferencias añadidas después (como latencyMode) toman su valor por defecto en archivos anteriores.
    if (typeof json === "object" && json !== null && "preferences" in json) {
      const { preferences } = json
      if (typeof preferences === "object" && preferences !== null) {
        json = { ...json, preferences: { ...DEFAULT_PREFERENCES, ...preferences } }
      }
    }
    const parsed = StoredSchema.safeParse(json)
    return parsed.success ? parsed.data : EMPTY
  }

  async #persist(input: Stored): Promise<void> {
    const stored = StoredSchema.parse(input)
    await this.#storage.write(`${JSON.stringify(stored)}\n`)
  }

  #serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#operations.then(operation, operation)
    this.#operations = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
