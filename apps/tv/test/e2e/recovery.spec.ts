import { access, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ElectronApplication } from "@playwright/test"
import { expect, test } from "./support/app"

// Errors must leave the viewer with a focused way out, reachable with the remote.

test.use({ seed: { recents: ["xqc"] } })

const stream = (login: string) => ({
  category: "Just Chatting",
  id: `s-${login}`,
  startedAt: new Date().toISOString(),
  tags: [],
  thumbnailUrl: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-{width}x{height}.jpg`,
  title: `Directo de ${login}`,
  userId: "123",
  userLogin: login,
  userName: login,
  viewerCount: 1000,
})
const ACCOUNT = { displayName: "Prueba", kind: "authenticated", login: "prueba" } as const

// Main's answers replaced, as with a stored session (EXT-4). Without network, checking the account throws, as
// TwitchAuth does when Twitch does not answer, until signing out (without a session it needs no network); with it, the
// account and its follows, with no tokens or Twitch involved.
const withoutNetwork = (app: ElectronApplication) =>
  app.evaluate(({ ipcMain }) => {
    let signedOut = false
    for (const channel of ["auth:snapshot", "auth:logout"]) ipcMain.removeHandler(channel)
    ipcMain.handle("auth:snapshot", () => {
      if (signedOut) return { kind: "guest" }
      throw new TypeError("fetch failed")
    })
    ipcMain.handle("auth:logout", () => {
      signedOut = true
    })
  })
const withNetwork = (app: ElectronApplication) =>
  app.evaluate(
    ({ ipcMain }, { account, following }) => {
      for (const channel of [
        "auth:snapshot",
        "catalog:followed",
        "catalog:live",
        "catalog:streams-by-login",
      ])
        ipcMain.removeHandler(channel)
      ipcMain.handle("auth:snapshot", () => account)
      ipcMain.handle("catalog:followed", () => ({ cursor: undefined, items: following }))
      ipcMain.handle("catalog:live", () => ({ cursor: undefined, items: [] }))
      ipcMain.handle("catalog:streams-by-login", () => [])
    },
    { account: ACCOUNT, following: [stream("nuevo1")] },
  )
// Home as last seen with that account. The first start, without an account, forgets it: written afterwards.
const saveHome = async (app: ElectronApplication): Promise<void> => {
  const profile = await app.evaluate(({ app: electron }) => electron.getPath("userData"))
  const home = {
    account: ACCOUNT,
    following: [stream("guardado1"), stream("guardado2")],
    popular: [],
    recentLive: [],
    recents: [],
    savedAt: Date.now() - 3_600_000,
  }
  await writeFile(join(profile, "saved-home.json"), JSON.stringify(home), { mode: 0o600 })
}

test("without network to check the account, the saved Home and Retry, never the welcome", async ({
  app,
  page,
  remote,
}) => {
  await remote.waitForFocus("home-link")
  await saveHome(app)
  await withoutNetwork(app)
  await page.reload()
  const notice = page.locator('.guide [role="alert"]')
  await expect(notice).toContainText("No se pudo comprobar tu cuenta")
  await expect(notice).toContainText("Lo que ves es de la última vez (fetch failed).")
  // Focus on the list, as always; Retry is one step up.
  await remote.waitForFocus("home-following-guardado1")
  await expect(page.locator(".topbar__account")).toContainText("Prueba")
  await expect(page.locator(".guide__intro")).toHaveCount(0)
  await remote.press("Up")
  await remote.waitForFocus("home-account-retry")
  // Back on Home keeps the place.
  await remote.press("Escape")
  expect(await remote.focusId()).toBe("home-account-retry")

  await withNetwork(app)
  await remote.press("Return")
  await expect(page.locator('[data-nav-id="home-following-nuevo1"]')).toBeVisible()
  await expect(notice).toHaveCount(0)
  await expect(page.locator(".guide__intro")).toHaveCount(0)
  // Retry is gone: focus comes back to the list.
  await remote.waitForFocus("home-following-nuevo1")
})

test("without network and nothing saved, only Retry, with focus", async ({ app, page, remote }) => {
  await remote.waitForFocus("home-link")
  await withoutNetwork(app)
  await page.reload()
  await remote.waitForFocus("home-account-retry")
  await expect(page.locator('.guide [role="alert"]')).toContainText(
    "La sesión no se ha cerrado (fetch failed).",
  )
  await expect(page.locator(".guide__intro")).toHaveCount(0)
  await expect(page.getByText("Cargando canales")).toHaveCount(0)
  // Settings says the same and offers Retry too.
  await remote.press("Up", "Right", "Right", "Return")
  await remote.waitForFocus("account-retry")
  await expect(page.locator(".account")).toContainText("La sesión no se ha cerrado")

  await withNetwork(app)
  await remote.press("Return")
  await expect(page.locator(".account")).toContainText("Conectado como Prueba")
  await remote.press("Escape")
  await expect(page.locator('[data-nav-id="home-following-nuevo1"]')).toBeVisible()
})

test("without network, Settings can still sign out, never by default", async ({
  app,
  page,
  remote,
}) => {
  await remote.waitForFocus("home-link")
  await saveHome(app)
  await withoutNetwork(app)
  await page.reload()
  await remote.waitForFocus("home-following-guardado1")
  await remote.press("Up", "Up", "Right", "Right", "Return")
  // Settings enters on Retry; signing out is one step to the right.
  await remote.waitForFocus("account-retry")
  await remote.press("Right")
  await remote.waitForFocus("account-logout")
  await remote.press("Return")
  await expect(page.locator(".account")).toContainText("Vincula tu cuenta")
  await remote.press("Escape")
  // Home without an account: the welcome, and what was saved is gone.
  await remote.waitForFocus("home-link")
  await expect(page.locator('[data-nav-id="home-following-guardado1"]')).toHaveCount(0)
  const profile = await app.evaluate(({ app: electron }) => electron.getPath("userData"))
  await expect
    .poll(() =>
      access(join(profile, "saved-home.json")).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false)
})

test("a failed load offers Twitch's player, then Retry, with focus, and Retry recovers", async ({
  app,
  page,
  remote,
}) => {
  await remote.waitForFocus("home-link")
  // Simulate a connection problem for both players: the ad-free stream that main serves under
  // /stream/ (own player, D11) and Twitch's player script.
  await app.evaluate(({ session }) =>
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      callback({
        cancel:
          (url.hostname === "localhost" && url.pathname.startsWith("/stream/")) ||
          details.url.startsWith("https://player.twitch.tv/js/"),
      })
    }),
  )
  await remote.press("Down")
  await remote.waitForFocus("home-recents-xqc")
  await remote.press("Return")
  // The own player fails first and offers Twitch's, which fails too and offers Retry.
  await expect(page.locator(".player__notice")).toContainText(
    "No se pudo preparar el directo sin anuncios",
  )
  await remote.waitForFocus("player-retry")
  await remote.press("Return")
  await expect(page.locator(".player__notice")).toContainText("No se pudo cargar el reproductor")
  await remote.waitForFocus("player-retry")

  await app.evaluate(({ session }) => session.defaultSession.webRequest.onBeforeRequest(null))
  await remote.press("Return")
  await expect(page.locator(".player__video iframe")).toHaveCount(1, { timeout: 20_000 })

  // Back still works from the recovered player and keeps the list position.
  await remote.press("Escape")
  await remote.waitForFocus("home-recents-xqc")
})

test("Back always leaves the player, even while it is still loading", async ({ page, remote }) => {
  await remote.waitForFocus("home-link")
  await remote.press("Down", "Return")
  await expect(page.locator(".player")).toBeVisible()
  await remote.press("Escape")
  await expect(page.locator(".player")).toHaveCount(0)
  await remote.waitForFocus("home-recents-xqc")
})
