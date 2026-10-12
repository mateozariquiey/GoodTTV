import { expect, test } from "./support/app"

// Errors must leave the viewer with a focused way out, reachable with the remote.

test.use({ seed: { recents: ["xqc"] } })

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
