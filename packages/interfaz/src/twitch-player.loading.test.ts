// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const currentScript = (): HTMLScriptElement => {
  const script = document.head.querySelector<HTMLScriptElement>(
    'script[src="https://player.twitch.tv/js/embed/v1.js"]',
  )
  if (script === null) throw new Error("Missing SDK request")
  return script
}

const publishApi = () => {
  const api = { Player: vi.fn() }
  Object.defineProperty(window, "Twitch", { configurable: true, value: api })
  return api
}

beforeEach(() => {
  vi.resetModules()
  delete window.Twitch
})

afterEach(() => {
  document.head.replaceChildren()
  delete window.Twitch
  vi.restoreAllMocks()
})

describe("Twitch SDK loading", () => {
  it.each(["error", "load"] as const)(
    "cleans up a failed %s event and retries with a new promise and script request",
    async (event) => {
      const { loadTwitchPlayerApi } = await import("./twitch-player")
      const requests = vi.spyOn(document.head, "append")
      const first = loadTwitchPlayerApi()
      const failedScript = currentScript()
      const removeListener = vi.spyOn(failedScript, "removeEventListener")
      const rejected = expect(first).rejects.toBeInstanceOf(TypeError)
      expect(requests).toHaveBeenCalledTimes(1)
      failedScript.dispatchEvent(new Event(event))
      await rejected
      expect(failedScript.isConnected).toBe(false)
      expect(removeListener.mock.calls.map(([name]) => name).sort()).toEqual(["error", "load"])

      const replacement = loadTwitchPlayerApi()
      expect(replacement).not.toBe(first)
      expect(loadTwitchPlayerApi()).toBe(replacement)
      expect(requests).toHaveBeenCalledTimes(2)
      const replacementScript = currentScript()
      expect(replacementScript).not.toBe(failedScript)
      // Detached attempts must not reject, remove or release the replacement's slot.
      failedScript.dispatchEvent(new Event("error"))
      failedScript.dispatchEvent(new Event("load"))
      expect(loadTwitchPlayerApi()).toBe(replacement)
      expect(replacementScript.isConnected).toBe(true)
      expect(requests).toHaveBeenCalledTimes(2)

      const api = publishApi()
      replacementScript.dispatchEvent(new Event("load"))
      await expect(replacement).resolves.toBe(api)
      failedScript.dispatchEvent(new Event("error"))
      expect(loadTwitchPlayerApi()).toBe(replacement)
      expect(requests).toHaveBeenCalledTimes(2)
    },
  )

  it("shares one pending promise and exactly one script request among concurrent callers", async () => {
    const { loadTwitchPlayerApi } = await import("./twitch-player")
    const requests = vi.spyOn(document.head, "append")
    const first = loadTwitchPlayerApi()
    const second = loadTwitchPlayerApi()
    const third = loadTwitchPlayerApi()
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(requests).toHaveBeenCalledTimes(1)
    const api = publishApi()
    currentScript().dispatchEvent(new Event("load"))
    await expect(Promise.all([first, second, third])).resolves.toEqual([api, api, api])
    expect(requests).toHaveBeenCalledTimes(1)
  })

  it("reuses the successful promise without a second request or live script listeners", async () => {
    const { loadTwitchPlayerApi } = await import("./twitch-player")
    const requests = vi.spyOn(document.head, "append")
    const first = loadTwitchPlayerApi()
    const script = currentScript()
    const removeListener = vi.spyOn(script, "removeEventListener")
    const api = publishApi()
    script.dispatchEvent(new Event("load"))
    await expect(first).resolves.toBe(api)
    expect(removeListener.mock.calls.map(([name]) => name).sort()).toEqual(["error", "load"])
    script.dispatchEvent(new Event("error"))
    script.dispatchEvent(new Event("load"))
    const second = loadTwitchPlayerApi()
    expect(second).toBe(first)
    await expect(second).resolves.toBe(api)
    expect(requests).toHaveBeenCalledTimes(1)
  })

  it("gives up on a download that never finishes so a retry starts a new one", async () => {
    vi.useFakeTimers()
    try {
      const { loadTwitchPlayerApi, SDK_TIMEOUT_MS } = await import("./twitch-player")
      const requests = vi.spyOn(document.head, "append")
      const first = loadTwitchPlayerApi()
      const rejected = expect(first).rejects.toThrow("timed out")
      await vi.advanceTimersByTimeAsync(SDK_TIMEOUT_MS)
      await rejected
      expect(document.head.querySelector("script")).toBeNull()
      const second = loadTwitchPlayerApi()
      expect(second).not.toBe(first)
      expect(requests).toHaveBeenCalledTimes(2)
      second.catch(() => undefined)
    } finally {
      vi.useRealTimers()
    }
  })
})
