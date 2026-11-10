import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { TextStorage } from "@goodttv/servicios"

// Where the TV app keeps recents and preferences (LocalStore, @goodttv/servicios): local-data.json
// in its user data folder. Writes are atomic (temporary file + rename, owner-only permissions),
// following VacuumStream's favourites store. Inicio de la última vez va aparte (saved-home.ts).

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT"

export type OwnerFile = TextStorage & { readonly remove: () => Promise<void> }

export const ownerFile = (directory: string, name: string): OwnerFile => {
  const path = join(directory, name)
  return {
    read: async () => {
      try {
        return await readFile(path, "utf8")
      } catch (error) {
        if (isMissingFile(error)) return undefined
        throw error
      }
    },
    remove: () => rm(path, { force: true }),
    write: async (text) => {
      await mkdir(directory, { mode: 0o700, recursive: true })
      const temporaryPath = `${path}.tmp`
      await rm(temporaryPath, { force: true })
      try {
        await writeFile(temporaryPath, text, { flag: "wx", flush: true, mode: 0o600 })
        await rename(temporaryPath, path)
        await chmod(path, 0o600)
      } catch (error) {
        await rm(temporaryPath, { force: true })
        throw error
      }
    },
  }
}

export const localDataFile = (directory: string): TextStorage =>
  ownerFile(directory, "local-data.json")
