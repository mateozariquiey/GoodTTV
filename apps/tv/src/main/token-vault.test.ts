import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { type SecureStorageAdapter, TokenVault } from "./token-vault"

const token = {
  accessToken: "access",
  expiresAt: "2026-09-05T20:00:00.000Z",
  refreshToken: "refresh",
}

const replacementToken = {
  accessToken: "replacement-access",
  expiresAt: "2026-09-06T20:00:00.000Z",
  refreshToken: "replacement-refresh",
}

describe("token vault", () => {
  let directory = ""

  afterEach(async () => {
    if (directory !== "") {
      await rm(directory, { recursive: true })
    }
  })

  it("round-trips tokens when a secure Linux backend is available", async () => {
    // Given an application data directory and an encrypted storage adapter
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-token-"))
    const adapter: SecureStorageAdapter = {
      backend: () => "gnome_libsecret",
      decrypt: (value) => value.toString("utf8"),
      encrypt: (value) => Buffer.from(value),
      isAvailable: () => true,
    }
    const vault = new TokenVault(directory, adapter)

    // When a rotating OAuth token is saved
    await vault.save(token)

    // Then a later app session can recover it through the same secure boundary
    await expect(new TokenVault(directory, adapter).load()).resolves.toEqual(token)
  })

  it("persists a mode-0600 JSON fallback when secure storage is unavailable", async () => {
    // Given a Linux backend that would only obfuscate plaintext
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-token-"))
    const adapter: SecureStorageAdapter = {
      backend: () => "basic_text",
      decrypt: (value) => value.toString("utf8"),
      encrypt: (value) => Buffer.from(value),
      isAvailable: () => true,
    }
    const vault = new TokenVault(directory, adapter)

    // When a token is saved and a later app session loads it
    await vault.save(token)
    const restored = await new TokenVault(directory, adapter).load()
    const fallbackPath = join(directory, "oauth-token.json")

    // Then the token persists in the Flatpak-private directory with owner-only access
    expect(vault.isPersistent).toBe(true)
    expect(vault.isSecure).toBe(false)
    expect(restored).toEqual(token)
    expect(JSON.parse(await readFile(fallbackPath, "utf8"))).toEqual(token)
    expect((await stat(fallbackPath)).mode & 0o777).toBe(0o600)
  })

  it("does not let an in-flight load restore a cleared token", async () => {
    // Given an encrypted token persisted by a previous vault instance
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-token-"))
    const adapter: SecureStorageAdapter = {
      backend: () => "gnome_libsecret",
      decrypt: (value) => value.toString("utf8"),
      encrypt: (value) => Buffer.from(value),
      isAvailable: () => true,
    }
    await new TokenVault(directory, adapter).save(token)
    const vault = new TokenVault(directory, adapter)

    // When disk loading and logout clearing overlap
    const loading = vault.load()
    const clearing = vault.clear()
    await Promise.allSettled([loading, clearing])

    // Then later reads cannot observe a resurrected session token
    await expect(vault.load()).resolves.toBeUndefined()
  })

  it("treats a fallback token as authoritative during secure-storage migration", async () => {
    // Given an older encrypted token and a newer fallback token left by an interrupted transition
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-token-"))
    const adapter: SecureStorageAdapter = {
      backend: () => "gnome_libsecret",
      decrypt: (value) => value.toString("utf8"),
      encrypt: (value) => Buffer.from(value),
      isAvailable: () => true,
    }
    await new TokenVault(directory, adapter).save(token)
    const fallbackPath = join(directory, "oauth-token.json")
    await writeFile(fallbackPath, JSON.stringify(replacementToken), { mode: 0o600 })

    // When secure storage becomes available after the interrupted transition
    const restored = await new TokenVault(directory, adapter).load()

    // Then the newer fallback wins and is migrated out of plaintext storage
    expect(restored).toEqual(replacementToken)
    await expect(readFile(fallbackPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("removes temporary token files during logout", async () => {
    // Given failed writes left encrypted and fallback temporary files behind
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-token-"))
    const adapter: SecureStorageAdapter = {
      backend: () => "gnome_libsecret",
      decrypt: (value) => value.toString("utf8"),
      encrypt: (value) => Buffer.from(value),
      isAvailable: () => true,
    }
    const temporaryPaths = [
      join(directory, "oauth-token.bin.tmp"),
      join(directory, "oauth-token.json.tmp"),
    ]
    await Promise.all(temporaryPaths.map((path) => writeFile(path, "token", { mode: 0o600 })))

    // When the account is logged out
    await new TokenVault(directory, adapter).clear()

    // Then no complete token payload remains in temporary storage
    await Promise.all(
      temporaryPaths.map((path) =>
        expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" }),
      ),
    )
  })

  it("does not cache a token when secure persistence fails", async () => {
    // Given a secure backend that rejects encryption
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-token-"))
    const adapter: SecureStorageAdapter = {
      backend: () => "gnome_libsecret",
      decrypt: (value) => value.toString("utf8"),
      encrypt: () => {
        throw new TypeError("Encryption failed")
      },
      isAvailable: () => true,
    }
    const vault = new TokenVault(directory, adapter)

    // When saving the token fails before it reaches disk
    await expect(vault.save(token)).rejects.toThrow("Encryption failed")

    // Then the failed token is not observable as a valid session
    await expect(vault.load()).resolves.toBeUndefined()
  })
})
