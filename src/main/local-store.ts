import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import {
  type Preferences,
  type PreferencesPatch,
  PreferencesPatchSchema,
  PreferencesSchema,
  RECENTS_LIMIT,
  type RecentChannel,
  RecentChannelSchema,
  RecentsListSchema,
} from "../shared/contracts"

// Recently watched channels and viewing preferences, local to this installation.
// Writes are serialized and atomic (temporary file + rename, owner-only permissions),
// following VacuumStream's favourites store.

const StoredSchema = z.strictObject({
  preferences: PreferencesSchema,
  recents: RecentsListSchema,
  version: z.literal(1),
})
type Stored = z.infer<typeof StoredSchema>

export const DEFAULT_PREFERENCES: Preferences = { chatScale: "normal", chatVisible: true }
const EMPTY: Stored = { preferences: DEFAULT_PREFERENCES, recents: [], version: 1 }

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT"

export class LocalStore {
  readonly #directory: string
  readonly #path: string
  #operations: Promise<void> = Promise.resolve()

  public constructor(directory: string) {
    this.#directory = directory
    this.#path = join(directory, "local-data.json")
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
    let contents: string
    try {
      contents = await readFile(this.#path, "utf8")
    } catch (error) {
      if (isMissingFile(error)) return EMPTY
      throw error
    }
    // A damaged or truncated file must not lock the viewer out of the app: start again from
    // defaults. The next save replaces it.
    let json: unknown
    try {
      json = JSON.parse(contents)
    } catch {
      return EMPTY
    }
    const parsed = StoredSchema.safeParse(json)
    return parsed.success ? parsed.data : EMPTY
  }

  async #persist(input: Stored): Promise<void> {
    const stored = StoredSchema.parse(input)
    await mkdir(this.#directory, { mode: 0o700, recursive: true })
    const temporaryPath = `${this.#path}.tmp`
    await rm(temporaryPath, { force: true })
    try {
      await writeFile(temporaryPath, `${JSON.stringify(stored)}\n`, {
        flag: "wx",
        flush: true,
        mode: 0o600,
      })
      await rename(temporaryPath, this.#path)
      await chmod(this.#path, 0o600)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
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
