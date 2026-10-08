import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsStore } from "./settings-store"
import { type SecureStorageAdapter, TokenVault } from "./token-vault"
import { SessionChangedError } from "./twitch-errors"
import { TwitchSession } from "./twitch-session"

const network = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock("ky", () => ({
  default: network,
  HTTPError: class extends Error {},
}))

const adapter: SecureStorageAdapter = {
  backend: () => "gnome_libsecret",
  decrypt: (value) => value.toString("utf8"),
  encrypt: (value) => Buffer.from(value),
  isAvailable: () => true,
}

describe("Twitch session revisions", () => {
  let directory = ""

  beforeEach(() => {
    network.get.mockReset()
    network.post.mockReset()
  })

  afterEach(async () => {
    if (directory !== "") await rm(directory, { recursive: true })
  })

  it("returns credentials from a successful automatic refresh", async () => {
    // Given an expired token whose refresh and replacement validation succeed
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-session-"))
    const settings = new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234")
    const session = new TwitchSession(settings, new TokenVault(directory, adapter))
    await session.saveToken({
      accessToken: "expired-access",
      expiresAt: "2026-09-05T19:00:00.000Z",
      refreshToken: "old-refresh",
    })
    network.get
      .mockResolvedValueOnce(new Response(undefined, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            client_id: "abcdefghijklmnopqrstuvwxyz1234",
            expires_in: 14_000,
            login: "viewer",
            scopes: ["user:read:follows"],
            user_id: "123",
          }),
          { status: 200 },
        ),
      )
    network.post.mockReturnValueOnce({
      json: () =>
        Promise.resolve({
          access_token: "fresh-access",
          expires_in: 14_000,
          refresh_token: "fresh-refresh",
          scope: ["user:read:follows"],
          token_type: "bearer",
        }),
    })

    // When credentials are requested
    const credentials = await session.credentials()

    // Then the effective refreshed token and validated identity are returned
    expect(credentials.token.accessToken).toBe("fresh-access")
    expect(credentials.identity.login).toBe("viewer")
  })

  it("does not commit stale validation after logout", async () => {
    // Given validation is waiting on a delayed Twitch response
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-session-"))
    const settings = new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234")
    const vault = new TokenVault(directory, adapter)
    const session = new TwitchSession(settings, vault)
    await session.saveToken({
      accessToken: "access",
      expiresAt: "2026-09-05T22:00:00.000Z",
      refreshToken: "refresh",
    })
    let resolveValidation: (response: Response) => void = () => undefined
    let markValidationStarted: () => void = () => undefined
    const validationStarted = new Promise<void>((resolve) => {
      markValidationStarted = resolve
    })
    network.get.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveValidation = resolve
        markValidationStarted()
      }),
    )
    const validation = session.identity()
    const validationRejection = expect(validation).rejects.toBeInstanceOf(SessionChangedError)
    await validationStarted

    // When logout clears the session before validation completes
    await session.clear()
    resolveValidation(
      new Response(
        JSON.stringify({
          client_id: "abcdefghijklmnopqrstuvwxyz1234",
          expires_in: 14_000,
          login: "old-viewer",
          scopes: ["user:read:follows"],
          user_id: "123",
        }),
        { status: 200 },
      ),
    )

    // Then stale validation is rejected and the token stays cleared
    await validationRejection
    await expect(vault.load()).resolves.toBeUndefined()
  })
})
