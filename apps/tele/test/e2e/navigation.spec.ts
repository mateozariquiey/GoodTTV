import { expect, type Remote, test } from "./support/app"

// Remote-only navigation that needs no Twitch account or network.

const KEY_ROWS = ["abcdefghij", "klmnopqrst", "uvwxyz_ñ-.", "1234567890"]

const keyPosition = (character: string): [number, number] => {
  const row = KEY_ROWS.findIndex((keys) => keys.includes(character))
  return [row, KEY_ROWS[row]?.indexOf(character) ?? -1]
}

// Types on the on-screen keyboard with arrows and OK, starting on "a".
const typeWithRemote = async (remote: Remote, text: string): Promise<void> => {
  let [row, column] = keyPosition("a")
  for (const character of text) {
    const [targetRow, targetColumn] = keyPosition(character)
    const vertical = targetRow > row ? "Down" : "Up"
    const horizontal = targetColumn > column ? "Right" : "Left"
    await remote.press(
      ...Array<string>(Math.abs(targetRow - row)).fill(vertical),
      ...Array<string>(Math.abs(targetColumn - column)).fill(horizontal),
      "Return",
    )
    ;[row, column] = [targetRow, targetColumn]
  }
}

test("starts on useful content and moves between sections with arrows and OK", async ({
  remote,
}) => {
  await remote.waitForFocus("home-link")
  await remote.press("Up")
  expect(await remote.focusId()).toBe("tab-home")
  await remote.press("Right", "Return")
  // Opening Search lands on the keyboard, ready to type.
  await remote.waitForFocus("key-a")
  await remote.press("Escape")
  // Back from another section returns to Home, where focus was.
  await remote.waitForFocus("home-link")
})

test("searches by name with the on-screen keyboard only", async ({ page, remote }) => {
  await remote.waitForFocus("home-link")
  await remote.press("Up", "Right", "Return")
  await remote.waitForFocus("key-a")
  await typeWithRemote(remote, "ibai_2")
  await expect(page.locator(".search__field input")).toHaveValue("ibai_2")
  await remote.press(...Array<string>(10).fill("Right"))
  await remote.waitForFocus("search-exact")
  await expect(page.locator('[data-nav-id="search-exact"]')).toContainText("ibai_2")
})

test("shows what each remote button sends and closes with Back", async ({ page, remote }) => {
  await remote.waitForFocus("home-link")
  await remote.press("Up", "Right", "Right", "Return")
  // Settings opens on linking the account; the preferences are in the right column.
  await remote.waitForFocus("account-link")
  // → lands on the setting at the same height (text size); ↑ reaches "show chat".
  await remote.press("Right")
  await remote.waitForFocus("setting-chat-scale")
  await remote.press("Up")
  await remote.waitForFocus("setting-chat-visible")
  await remote.press("Down", "Down")
  await remote.waitForFocus("setting-latency")
  await remote.press("Down")
  await remote.waitForFocus("setting-probe")
  await remote.press("Return")
  await expect(page.getByRole("dialog", { name: "Probar el mando" })).toBeVisible()
  await remote.press("XF86AudioPlay", "Return", "Up")
  const rows = page.locator(".probe__table tbody tr")
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText("ArrowUp")
  await expect(rows.nth(1)).toContainText("Enter")
  await expect(rows.nth(2)).toContainText("MediaPlay")
  // OK and arrows were only recorded: the dialog is still open.
  await expect(page.getByRole("dialog")).toBeVisible()
  await remote.press("XF86Back")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await remote.waitForFocus("setting-probe")
})

test("toggles a preference with OK and keeps it", async ({ page, remote }) => {
  await remote.waitForFocus("home-link")
  await remote.press("Up", "Right", "Right", "Return")
  // Settings opens on linking the account; the preferences are in the right column.
  await remote.waitForFocus("account-link")
  // → lands on the setting at the same height (text size); ↑ reaches "show chat".
  await remote.press("Right")
  await remote.waitForFocus("setting-chat-scale")
  await remote.press("Up")
  await remote.waitForFocus("setting-chat-visible")
  const setting = page.locator('[data-nav-id="setting-chat-visible"]')
  await expect(setting).toContainText("Sí")
  await remote.press("Return")
  await expect(setting).toContainText("No")
  expect(await page.evaluate(() => window.api.preferences.get())).toMatchObject({
    chatVisible: false,
  })
  // ← from a setting reaches the account action, never the tabs.
  await remote.press("Left")
  await remote.waitForFocus("account-link")
})
