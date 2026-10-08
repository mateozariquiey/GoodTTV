import { expect, test } from "./support/app"

// Errors must leave the viewer with a focused way out, reachable with the remote.

test.use({ seed: { recents: ["xqc"] } })

test("a failed player load offers Retry with focus, and Retry recovers", async ({
  app,
  page,
  remote,
}) => {
  await remote.waitForFocus("home-link")
  // Simulate a connection problem for Twitch's player script only.
  await app.evaluate(({ session }) =>
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["https://player.twitch.tv/js/*"] },
      (_details, callback) => callback({ cancel: true }),
    ),
  )
  await remote.press("Down")
  await remote.waitForFocus("home-recents-xqc")
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
