import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { type StoredToken, StoredTokenSchema, type TokenStore } from "@goodttv/servicios"

export interface SecureStorageAdapter {
  readonly backend: () => string
  readonly decrypt: (value: Buffer) => string
  readonly encrypt: (value: string) => Buffer
  readonly isAvailable: () => boolean
}

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT"

const readOptionalFile = async (path: string): Promise<Buffer | undefined> => {
  try {
    return await readFile(path)
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

export class TokenVault implements TokenStore {
  readonly #adapter: SecureStorageAdapter
  readonly #directory: string
  readonly #encryptedPath: string
  readonly #fallbackPath: string
  readonly #secure: boolean
  #operations: Promise<void> = Promise.resolve()
  #sessionToken: StoredToken | undefined

  public constructor(directory: string, adapter: SecureStorageAdapter) {
    this.#adapter = adapter
    this.#directory = directory
    this.#encryptedPath = join(directory, "oauth-token.bin")
    this.#fallbackPath = join(directory, "oauth-token.json")
    this.#secure = adapter.isAvailable() && adapter.backend() !== "basic_text"
  }

  public get isPersistent(): boolean {
    return true
  }

  public get isSecure(): boolean {
    return this.#secure
  }

  public async load(): Promise<StoredToken | undefined> {
    return this.#serialize(async () => {
      if (this.#sessionToken !== undefined) {
        return this.#sessionToken
      }
      const fallback = await this.#loadFallback()
      if (fallback !== undefined) {
        if (this.#secure) {
          await this.#persist(fallback)
        }
        this.#sessionToken = fallback
        return fallback
      }
      if (!this.#secure) return undefined

      const encrypted = await readOptionalFile(this.#encryptedPath)
      if (encrypted !== undefined) {
        this.#sessionToken = StoredTokenSchema.parse(JSON.parse(this.#adapter.decrypt(encrypted)))
        return this.#sessionToken
      }
      return undefined
    })
  }

  public async save(token: StoredToken): Promise<void> {
    await this.#serialize(async () => {
      const parsed = StoredTokenSchema.parse(token)
      await this.#persist(parsed)
      this.#sessionToken = parsed
    })
  }

  public async clear(): Promise<void> {
    await this.#serialize(async () => {
      this.#sessionToken = undefined
      await Promise.all([
        rm(this.#encryptedPath, { force: true }),
        rm(`${this.#encryptedPath}.tmp`, { force: true }),
        rm(this.#fallbackPath, { force: true }),
        rm(`${this.#fallbackPath}.tmp`, { force: true }),
      ])
    })
  }

  async #loadFallback(): Promise<StoredToken | undefined> {
    const fallback = await readOptionalFile(this.#fallbackPath)
    return fallback === undefined
      ? undefined
      : StoredTokenSchema.parse(JSON.parse(fallback.toString()))
  }

  async #persist(token: StoredToken): Promise<void> {
    await mkdir(this.#directory, { mode: 0o700, recursive: true })
    const serialized = JSON.stringify(token)
    if (!this.#secure) {
      await this.#writeAtomically(this.#fallbackPath, `${serialized}\n`)
      await rm(this.#encryptedPath, { force: true })
      return
    }

    const encrypted = this.#adapter.encrypt(serialized)
    const fallbackExists = (await readOptionalFile(this.#fallbackPath)) !== undefined
    if (fallbackExists) {
      await this.#writeAtomically(this.#fallbackPath, `${serialized}\n`)
    }
    await this.#writeAtomically(this.#encryptedPath, encrypted)
    await rm(this.#fallbackPath, { force: true })
  }

  async #writeAtomically(path: string, payload: string | Buffer): Promise<void> {
    const temporaryPath = `${path}.tmp`
    await rm(temporaryPath, { force: true })
    try {
      await writeFile(temporaryPath, payload, { flag: "wx", flush: true, mode: 0o600 })
      await rename(temporaryPath, path)
      await chmod(path, 0o600)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
  }

  async #serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#operations.then(operation, operation)
    this.#operations = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
