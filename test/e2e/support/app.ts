import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  test as base,
  type ElectronApplication,
  _electron as electron,
  type Frame,
  type Page,
} from "@playwright/test"

const XDOTOOL = process.env["E2E_XDOTOOL"] ?? "xdotool"
const xdotool = (...args: string[]): string =>
  execFileSync(XDOTOOL, args, {
    encoding: "utf8",
    env: { ...process.env, LD_LIBRARY_PATH: process.env["E2E_LD_LIBRARY_PATH"] ?? "" },
  }).trim()

export type Seed = { readonly recents?: readonly string[] }

export type Remote = {
  // Real key presses through X11, like a remote that sends standard keys.
  press(...keys: string[]): Promise<void>
  focusId(): Promise<string>
  waitForFocus(id: string, timeout?: number): Promise<void>
}

type Fixtures = {
  app: ElectronApplication
  page: Page
  remote: Remote
  seed: Seed
}

const writeSeed = async (directory: string, seed: Seed): Promise<void> => {
  if (seed.recents === undefined) return
  const recents = seed.recents.map((login, index) => ({
    displayName: login,
    login,
    watchedAt: 1_000 - index,
  }))
  await writeFile(
    join(directory, "local-data.json"),
    JSON.stringify({
      preferences: { chatScale: "normal", chatVisible: true },
      recents,
      version: 1,
    }),
  )
}

// Xvfb has no window manager: place the window over the whole screen and give it X focus.
const fitWindow = (pid: number): void => {
  const windows = xdotool("search", "--pid", String(pid)).split("\n").filter(Boolean)
  for (const id of windows) {
    const geometry = xdotool("getwindowgeometry", id)
    if (/Geometry: (10x10|200x200)/.test(geometry)) continue
    xdotool("windowmove", id, "0", "0", "windowsize", id, "1920", "1080", "windowfocus", id)
    xdotool("mousemove", "1919", "1079")
    return
  }
  throw new Error("App window not found")
}

export const test = base.extend<Fixtures>({
  app: async ({ seed }, use) => {
    const profile = await mkdtemp(join(tmpdir(), "twitch-port-e2e-"))
    await writeSeed(profile, seed)
    const env = { ...process.env }
    delete env["ELECTRON_RUN_AS_NODE"]
    delete env["WAYLAND_DISPLAY"]
    const app = await electron.launch({
      args: [".", "--ozone-platform=x11", `--user-data-dir=${profile}`, "--mute-audio"],
      env: { ...env, XDG_SESSION_TYPE: "x11" },
    })
    await use(app)
    await app.close().catch(() => undefined)
    await rm(profile, { force: true, recursive: true })
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForLoadState("domcontentloaded")
    await page.waitForSelector("[data-nav]")
    // The X window belongs to Electron's main (browser) process.
    fitWindow(app.process().pid ?? 0)
    await page.waitForTimeout(500)
    await use(page)
  },
  remote: async ({ page }, use) => {
    const focusId = () =>
      page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.dataset["navId"] ?? "NONE",
      )
    await use({
      focusId,
      press: async (...keys) => {
        for (const key of keys) {
          xdotool("key", key)
          await page.waitForTimeout(250)
        }
      },
      waitForFocus: async (id, timeout = 10_000) => {
        await page.waitForFunction(
          (expected) =>
            (document.activeElement as HTMLElement | null)?.dataset["navId"] === expected,
          id,
          { timeout },
        )
      },
    })
  },
  seed: [{}, { option: true }],
})

export { expect } from "@playwright/test"

export const playerFrame = (page: Page): Frame | undefined =>
  page.frames().find((frame) => frame.url().startsWith("https://player.twitch.tv/"))

// Test-only probe of Twitch's <video>. The app itself never scripts Twitch frames.
export const videoSample = async (page: Page) => {
  const frame = playerFrame(page)
  if (frame === undefined) return undefined
  return frame.evaluate(() => {
    const video = document.querySelector("video")
    return video === null
      ? undefined
      : {
          height: video.videoHeight,
          muted: video.muted,
          paused: video.paused,
          time: video.currentTime,
          width: video.videoWidth,
        }
  })
}

// Twitch disables autoplay when anything covers the embed. Check geometry and what Chromium
// itself reports (IntersectionObserver v2) from the app's side.
export const playerCompliance = (page: Page) =>
  page.evaluate(async () => {
    const iframe = document.querySelector<HTMLIFrameElement>(".player__video iframe")
    if (iframe === null) return { reason: "no iframe" }
    const box = iframe.getBoundingClientRect()
    const overlapping = [...document.body.querySelectorAll<HTMLElement>("*")].filter((element) => {
      if (element === iframe || element.contains(iframe) || iframe.contains(element)) return false
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return false
      return (
        rect.left < box.right &&
        rect.right > box.left &&
        rect.top < box.bottom &&
        rect.bottom > box.top
      )
    })
    const visible = await new Promise<boolean>((resolve) => {
      const observer = new IntersectionObserver(
        (entries) => {
          observer.disconnect()
          // IntersectionObserver v2 field; not yet in TypeScript's DOM types.
          const entry = entries.at(-1) as
            | (IntersectionObserverEntry & { isVisible?: boolean })
            | undefined
          resolve(entry?.isVisible === true)
        },
        { delay: 100, threshold: [1], trackVisibility: true } as IntersectionObserverInit,
      )
      observer.observe(iframe)
    })
    return {
      height: box.height,
      overlapping: overlapping.map((element) => element.className || element.tagName),
      visible,
      width: box.width,
    }
  })
