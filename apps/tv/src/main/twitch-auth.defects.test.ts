import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TwitchAuth } from "@goodttv/servicios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsStore } from "./settings-store"
import { type SecureStorageAdapter, TokenVault } from "./token-vault"

const network = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock("ky", () => ({ default: network }))

const adapter: SecureStorageAdapter = {
  backend: () => "gnome_libsecret",
  decrypt: (value) => value.toString("utf8"),
  encrypt: (value) => Buffer.from(value),
  isAvailable: () => true,
}

const deviceResponse = (userCode: string, deviceCode: string) => ({
  device_code: deviceCode,
  expires_in: 600,
  interval: 1,
  user_code: userCode,
  verification_uri: "https://www.twitch.tv/activate",
})

describe("Twitch authorization defect regressions", () => {
  let directory = ""

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    network.post.mockReset()
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (directory !== "") await rm(directory, { force: true, recursive: true })
  })

  it.fails("D-cycle-22-1 keeps the newer authorization pending when an older begin reply arrives last", async () => {
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-auth-"))
    const auth = new TwitchAuth(
      new SettingsStore(undefined, "abcdefghijklmnopqrstuvwxyz1234"),
      new TokenVault(directory, adapter),
    )
    let resolveOlderResponse: (response: ReturnType<typeof deviceResponse>) => void = () =>
      undefined
    let markOlderRequestStarted: () => void = () => undefined
    const olderRequestStarted = new Promise<void>((resolve) => {
      markOlderRequestStarted = resolve
    })
    const olderResponse = new Promise<ReturnType<typeof deviceResponse>>((resolve) => {
      resolveOlderResponse = resolve
    })
    network.post
      .mockImplementationOnce(() => {
        markOlderRequestStarted()
        return { json: () => olderResponse }
      })
      .mockReturnValueOnce({
        json: () => Promise.resolve(deviceResponse("CODE0002", "device-code-2")),
      })

    const olderBegin = auth.begin()
    await olderRequestStarted
    await auth.begin()

    await expect(auth.snapshot()).resolves.toMatchObject({
      challenge: { userCode: "CODE0002" },
      kind: "authorizing",
    })

    resolveOlderResponse(deviceResponse("CODE0001", "device-code-1"))
    await olderBegin

    await expect(auth.snapshot()).resolves.toMatchObject({
      challenge: { userCode: "CODE0002" },
      kind: "authorizing",
    })
  })
})
