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

// E2E_WAYLAND=<socket>: the app runs in that Wayland compositor (a headless Weston with the kiosk
// shell, which gives the window the whole output) and keys are sent from main with
// sendInputEvent. They still go through before-input-event like the remote's; only the X11 hop
// is skipped.
const WAYLAND = process.env["E2E_WAYLAND"]
// xdotool names → sendInputEvent key codes. sendInputEvent cannot make BrowserBack (it sends an
// empty key), so the remote's Back becomes Escape, which main maps to the same action.
const ELECTRON_KEYS: Readonly<Record<string, string>> = {
  XF86AudioPlay: "MediaPlayPause",
  XF86Back: "Escape",
  space: "Space",
}

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
      preferences: { chatScale: "normal", chatVisible: true, latencyMode: "adaptativo" },
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
    if (WAYLAND !== undefined) delete env["DISPLAY"]
    const app = await electron.launch({
      args: [
        ".",
        `--ozone-platform=${WAYLAND === undefined ? "x11" : "wayland"}`,
        `--user-data-dir=${profile}`,
        "--mute-audio",
      ],
      env:
        WAYLAND === undefined
          ? { ...env, XDG_SESSION_TYPE: "x11" }
          : { ...env, WAYLAND_DISPLAY: WAYLAND, XDG_SESSION_TYPE: "wayland" },
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
    if (WAYLAND === undefined) fitWindow(app.process().pid ?? 0)
    await page.waitForTimeout(500)
    await use(page)
  },
  remote: async ({ app, page }, use) => {
    const focusId = () =>
      page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.dataset["navId"] ?? "NONE",
      )
    await use({
      focusId,
      press: async (...keys) => {
        for (const key of keys) {
          if (WAYLAND === undefined) xdotool("key", key)
          else
            await app.evaluate(({ BrowserWindow }, keyCode) => {
              const contents = BrowserWindow.getAllWindows()[0]?.webContents
              contents?.sendInputEvent({ keyCode, type: "keyDown" })
              contents?.sendInputEvent({ keyCode, type: "keyUp" })
            }, ELECTRON_KEYS[key] ?? key)
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

// Test-only probe of the playing <video>: the app's own player, or Twitch's inside its frame (the app itself
// never scripts Twitch frames).
// Cinema mode (own player): while playing, the band hides after 4 s without input and a key
// while it is hidden only shows it. Pausing and resuming leaves it visible for another 4 s,
// whatever its state was. Only for a playing player.
export const showControls = async (remote: Remote): Promise<void> => {
  await remote.press("space", "space")
}

export const videoSample = async (page: Page) => {
  const frame =
    (await page.locator(".player__video video").count()) > 0 ? page.mainFrame() : playerFrame(page)
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
    const iframe = document.querySelector<HTMLElement>(
      ".player__video iframe, .player__video video",
    )
    if (iframe === null) return { reason: "no player" }
    // Only Twitch's embed must stay uncovered; the band floats over the own <video> (cinema mode).
    if (iframe.tagName === "VIDEO") return { own: true }
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
