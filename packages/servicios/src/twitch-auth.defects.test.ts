import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { memoryTokens, testSettings } from "./dobles"
import { TwitchAuth } from "./twitch-auth"

const network = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock("ky", () => ({ default: network }))

const deviceResponse = (userCode: string, deviceCode: string) => ({
  device_code: deviceCode,
  expires_in: 600,
  interval: 1,
  user_code: userCode,
  verification_uri: "https://www.twitch.tv/activate",
})

describe("Twitch authorization defect regressions", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    network.post.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.fails("D-cycle-22-1 keeps the newer authorization pending when an older begin reply arrives last", async () => {
    const auth = new TwitchAuth(testSettings(), memoryTokens())
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
