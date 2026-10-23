import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SessionChangedError, type TokenStore, TwitchSession } from "@goodttv/servicios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsStore } from "./settings-store"
import { type SecureStorageAdapter, TokenVault } from "./token-vault"

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
    // La cuenta se guarda con el token en segundo plano, tras validar: puede estar escribiendo todavía.
    if (directory !== "") await rm(directory, { maxRetries: 5, recursive: true, retryDelay: 20 })
  })

  it("returns credentials from a successful automatic refresh", async () => {
    // Given a token Twitch no longer accepts, whose refresh and replacement validation succeed
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-session-"))
    const settings = new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234")
    const session = new TwitchSession(settings, new TokenVault(directory, adapter))
    await session.saveToken({
      accessToken: "expired-access",
      expiresAt: "2099-01-01T00:00:00.000Z",
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
      expiresAt: "2099-01-01T00:00:00.000Z",
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

describe("Twitch session shared by several pages (extension tabs)", () => {
  let directory = ""

  beforeEach(() => {
    network.get.mockReset()
    network.post.mockReset()
  })

  afterEach(async () => {
    // La cuenta se guarda con el token en segundo plano, tras validar: puede estar escribiendo todavía.
    if (directory !== "") await rm(directory, { maxRetries: 5, recursive: true, retryDelay: 20 })
  })

  // Como navigator.locks en la extensión: una operación exclusiva a la vez para todas las páginas.
  const shared = (vault: TokenStore): TokenStore => {
    let tail: Promise<unknown> = Promise.resolve()
    return {
      clear: () => vault.clear(),
      exclusive: <Result>(operation: () => Promise<Result>): Promise<Result> => {
        const result = tail.then(operation, operation)
        tail = result.catch(() => undefined)
        return result
      },
      isSecure: vault.isSecure,
      load: () => vault.load(),
      save: (token) => vault.save(token),
    }
  }

  it("renews once when two pages find the token expired at the same time; the other uses the new one", async () => {
    directory = await mkdtemp(join(tmpdir(), "goodttv-session-"))
    const settings = new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234")
    const store = shared(new TokenVault(directory, adapter))
    const first = new TwitchSession(settings, store)
    const second = new TwitchSession(settings, store)
    await first.saveToken({
      accessToken: "old-access",
      expiresAt: "2026-09-05T19:00:00.000Z",
      refreshToken: "old-refresh",
    })
    // El token viejo ya no vale; el nuevo, sí.
    network.get.mockImplementation(
      async (_url: string, options: { headers: Record<string, string> }) =>
        options.headers["Authorization"] === "OAuth old-access"
          ? new Response(undefined, { status: 401 })
          : new Response(
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
    network.post.mockReturnValue({
      json: () =>
        Promise.resolve({
          access_token: "fresh-access",
          expires_in: 14_000,
          refresh_token: "fresh-refresh",
          scope: ["user:read:follows"],
          token_type: "bearer",
        }),
    })

    const [a, b] = await Promise.all([first.credentials(), second.credentials()])

    expect(network.post).toHaveBeenCalledTimes(1)
    expect(a.token.accessToken).toBe("fresh-access")
    expect(b.token.accessToken).toBe("fresh-access")
    expect((await store.load())?.refreshToken).toBe("fresh-refresh")
  })

  it("signing out in another page while one renews waits for it, and the session stays closed", async () => {
    directory = await mkdtemp(join(tmpdir(), "goodttv-session-"))
    const settings = new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234")
    const store = shared(new TokenVault(directory, adapter))
    const renewing = new TwitchSession(settings, store)
    const other = new TwitchSession(settings, store)
    await renewing.saveToken({
      accessToken: "old-access",
      expiresAt: "2026-09-05T19:00:00.000Z",
      refreshToken: "old-refresh",
    })
    network.get.mockImplementation(
      async (_url: string, options: { headers: Record<string, string> }) =>
        options.headers["Authorization"] === "OAuth old-access"
          ? new Response(undefined, { status: 401 })
          : new Response(
              JSON.stringify({
                client_id: "abcdefghijklmnopqrstuvwxyz1234",
                expires_in: 14_000,
                login: "viewer",
                scopes: [],
                user_id: "123",
              }),
              { status: 200 },
            ),
    )
    let answer: (value: unknown) => void = () => undefined
    let started: () => void = () => undefined
    const refreshStarted = new Promise<void>((done) => (started = done))
    network.post.mockReturnValue({
      json: () => {
        started()
        return new Promise((done) => (answer = done))
      },
    })
    const renewal = renewing.credentials().catch((error: unknown) => error)
    await refreshStarted
    const signOut = other.clear()
    answer({
      access_token: "fresh-access",
      expires_in: 14_000,
      refresh_token: "fresh-refresh",
      scope: [],
      token_type: "bearer",
    })
    await signOut
    await renewal
    expect(await store.load()).toBeUndefined()
  })

  it("does not reuse the identity of another account signed in by another page", async () => {
    directory = await mkdtemp(join(tmpdir(), "goodttv-session-"))
    const settings = new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234")
    const store = shared(new TokenVault(directory, adapter))
    const session = new TwitchSession(settings, store)
    const other = new TwitchSession(settings, store)
    await session.saveToken({
      accessToken: "a-access",
      expiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "a",
    })
    const identity = (login: string, id: string) =>
      new Response(
        JSON.stringify({
          client_id: "abcdefghijklmnopqrstuvwxyz1234",
          expires_in: 14_000,
          login,
          scopes: [],
          user_id: id,
        }),
        { status: 200 },
      )
    network.get.mockImplementation(
      async (_url: string, options: { headers: Record<string, string> }) =>
        options.headers["Authorization"] === "OAuth a-access"
          ? identity("primera", "1")
          : identity("segunda", "2"),
    )
    expect((await session.credentials()).identity.login).toBe("primera")
    await other.saveToken({
      accessToken: "b-access",
      expiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "b",
    })
    expect((await session.credentials()).identity.login).toBe("segunda")
  })

  it("if another page signed out meanwhile, does not renew with the old token", async () => {
    directory = await mkdtemp(join(tmpdir(), "goodttv-session-"))
    const settings = new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234")
    const store = shared(new TokenVault(directory, adapter))
    const session = new TwitchSession(settings, store)
    await session.saveToken({
      accessToken: "old-access",
      expiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "old-refresh",
    })
    network.get.mockImplementation(async () => {
      await store.clear() // la otra pestaña cierra sesión mientras esta valida
      return new Response(undefined, { status: 401 })
    })

    await expect(session.credentials()).rejects.toThrow("Sign in again")
    expect(network.post).not.toHaveBeenCalled()
  })
})

describe("La cuenta guardada con el token: al abrir, Helix no espera a validar", () => {
  let directory = ""

  beforeEach(() => {
    network.get.mockReset()
    network.post.mockReset()
  })

  afterEach(async () => {
    if (directory !== "") await rm(directory, { maxRetries: 5, recursive: true, retryDelay: 20 })
  })

  const validation = (login = "viewer") =>
    new Response(
      JSON.stringify({
        client_id: "abcdefghijklmnopqrstuvwxyz1234",
        expires_in: 14_000,
        login,
        scopes: ["user:read:follows"],
        user_id: "123",
      }),
      { status: 200 },
    )
  const renewal = {
    json: () =>
      Promise.resolve({
        access_token: "fresh-access",
        expires_in: 14_000,
        refresh_token: "fresh-refresh",
        scope: ["user:read:follows"],
        token_type: "bearer",
      }),
  }
  const open = async () => {
    directory = await mkdtemp(join(tmpdir(), "goodttv-session-"))
    const vault = new TokenVault(directory, adapter)
    const settings = new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234")
    return { session: new TwitchSession(settings, vault), settings, vault }
  }
  const identity = { login: "viewer", scopes: ["user:read:follows"], user_id: "123" }

  it("tras validar, guarda la cuenta con el token; al renovarlo, la conserva", async () => {
    const { session, vault } = await open()
    await session.saveToken({
      accessToken: "access",
      expiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "refresh",
    })
    network.get.mockResolvedValue(validation())
    expect((await session.credentials()).identity).toEqual(identity)
    await vi.waitFor(async () => expect((await vault.load())?.identity).toEqual(identity))
    network.post.mockReturnValueOnce(renewal)
    await session.refreshCredentials()
    expect(await vault.load()).toMatchObject({ accessToken: "fresh-access", identity })
  })

  it("con la cuenta guardada, da las credenciales sin esperar a la validación, que va a la vez", async () => {
    const { settings, vault } = await open()
    await vault.save({
      accessToken: "access",
      expiresAt: "2099-01-01T00:00:00.000Z",
      identity,
      refreshToken: "refresh",
    })
    let answer: (response: Response) => void = () => undefined
    network.get.mockReturnValue(new Promise<Response>((done) => (answer = done)))
    // Una página nueva (otra pestaña, o al abrir): sin nada validado en memoria.
    const fresh = new TwitchSession(settings, vault)
    const account = fresh.identity()
    const credentials = await fresh.credentials()
    expect(credentials).toMatchObject({ identity, token: { accessToken: "access" } })
    // La cuenta (auth.snapshot) sí espera a Twitch, y es la misma validación.
    await fresh.credentials()
    expect(network.get).toHaveBeenCalledTimes(1)
    answer(validation())
    expect(await account).toEqual(identity)
  })

  it("un token ya caducado se renueva sin validarlo antes", async () => {
    const { session, vault } = await open()
    await vault.save({
      accessToken: "old-access",
      expiresAt: "2026-09-05T19:00:00.000Z",
      identity,
      refreshToken: "old-refresh",
    })
    network.post.mockReturnValueOnce(renewal)
    network.get.mockResolvedValue(validation())
    const credentials = await session.credentials()
    expect(credentials.token.accessToken).toBe("fresh-access")
    expect(network.post).toHaveBeenCalledTimes(1)
    // Solo se valida el nuevo, y a la vez: el viejo no se llega a probar.
    await vi.waitFor(() => expect(network.get).toHaveBeenCalledTimes(1))
    expect(network.get.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "OAuth fresh-access" },
    })
  })

  it("si Twitch ya no acepta el token guardado, la validación de al lado cierra la sesión", async () => {
    const { session, vault } = await open()
    await vault.save({
      accessToken: "access",
      expiresAt: "2099-01-01T00:00:00.000Z",
      identity,
      refreshToken: "refresh",
    })
    network.get.mockResolvedValue(new Response(undefined, { status: 401 }))
    const { HTTPError } = await import("ky")
    network.post.mockReturnValue({
      // Twitch rechaza la renovación (400), como lo vería ky.
      json: () =>
        Promise.reject(
          Object.assign(Object.create(HTTPError.prototype), { response: { status: 400 } }),
        ),
    })
    // Al abrir, la cuenta (auth.snapshot) y Helix a la vez: Helix va con la cuenta guardada, y la cuenta, que comparte
    // la validación, ve que la sesión ha caducado.
    const account = session.identity()
    const accountRejection = expect(account).rejects.toThrow("Sign in again")
    await expect(session.credentials()).resolves.toMatchObject({ identity })
    await accountRejection
    expect(network.get).toHaveBeenCalledTimes(1)
    expect(await vault.load()).toBeUndefined()
  })

  it("si la validación de al lado renueva el token mientras se leen las credenciales, sigue con el renovado", async () => {
    const { settings, vault } = await open()
    await vault.save({
      accessToken: "access",
      expiresAt: "2099-01-01T00:00:00.000Z",
      identity,
      refreshToken: "refresh",
    })
    // Un almacén cuya siguiente lectura espera a que se le diga, para que la renovación ocurra en medio.
    let hold: Promise<void> | undefined
    const store: TokenStore = {
      clear: () => vault.clear(),
      isSecure: true,
      load: async () => {
        await hold
        return vault.load()
      },
      save: (token) => vault.save(token),
    }
    const session = new TwitchSession(settings, store)
    network.get.mockImplementation(
      async (_url: string, options: { headers: Record<string, string> }) =>
        options.headers["Authorization"] === "OAuth access"
          ? new Response(undefined, { status: 401 })
          : validation(),
    )
    network.post.mockReturnValue(renewal)
    // La primera lectura lanza la validación de fondo (401 y renueva); la segunda queda esperando mientras tanto.
    await session.credentials()
    let release: () => void = () => undefined
    hold = new Promise((done) => (release = done))
    const reading = session.credentials()
    await vi.waitFor(() => expect(network.post).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect((await vault.load())?.accessToken).toBe("fresh-access"))
    hold = undefined
    release()
    await expect(reading).resolves.toMatchObject({ token: { accessToken: "fresh-access" } })
  })
})
