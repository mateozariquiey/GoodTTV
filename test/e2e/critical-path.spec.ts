import type { Page } from "@playwright/test"
import { expect, playerCompliance, type Remote, test, videoSample } from "./support/app"

// The critical path against real Twitch, guest mode, keys only:
// open a channel → it plays → pause/resume → back to the list → open another channel.
// Needs network and live channels; candidates come from E2E_CHANNELS.

const CANDIDATES = (process.env["E2E_CHANNELS"] ?? "xqc,hasanabi,zackrawrr,jynxzi,summit1g,caseoh_")
  .split(",")
  .map((login) => login.trim().toLowerCase())
  .filter(Boolean)

test.use({ seed: { recents: CANDIDATES } })
test.setTimeout(300_000)

type Outcome = "playing" | "offline" | "gate" | "timeout"

// Waits until the embed reports moving video, an offline channel or Twitch's content gate.
const waitForPlayback = async (page: Page): Promise<Outcome> => {
  const deadline = Date.now() + 30_000
  let first: number | undefined
  while (Date.now() < deadline) {
    // No auto-waiting here: once playback starts there is no notice at all.
    const notice = await page.evaluate(
      () => document.querySelector(".player__notice")?.textContent ?? null,
    )
    if (notice?.includes("no está en directo") === true) return "offline"
    if ((await page.locator('[data-nav-id="player-gate"]').count()) > 0) return "gate"
    const sample = await videoSample(page).catch((error: unknown) => {
      if (process.env["E2E_DEBUG"] !== undefined) console.log("probe failed", String(error))
      return undefined
    })
    if (process.env["E2E_DEBUG"] !== undefined) {
      console.log(
        notice,
        JSON.stringify(sample),
        page.frames().map((frame) => frame.url().slice(0, 50)),
      )
    }
    if (sample !== undefined && !sample.paused) {
      if (first === undefined) first = sample.time
      else if (sample.time - first > 1) return "playing"
    }
    await page.waitForTimeout(1_000)
  }
  return "timeout"
}

// Accepts Twitch's content gate the way a viewer would: through "Controles de Twitch".
const acceptGate = async (page: Page, remote: Remote): Promise<void> => {
  await remote.waitForFocus("player-gate")
  await remote.press("Return")
  await expect(page.locator(".player__notice")).toContainText("Controles de Twitch")
  // Tab order in the gate: the settings link, then "Start Watching".
  await remote.press("Down", "Down", "Return")
  await page.waitForTimeout(2_000)
  await remote.press("Escape")
  await remote.waitForFocus("player-twitch")
}

// Moves focus row by row with Up/Down until it reaches the wanted row. Recents reorder after
// watching (the channel just watched moves to the top), so positions are not fixed.
const goToRow = async (page: Page, remote: Remote, rowId: string): Promise<void> => {
  for (let step = 0; step < 30; step += 1) {
    const { current, rows } = await page.evaluate(() => ({
      current: (document.activeElement as HTMLElement | null)?.dataset["navId"] ?? "",
      rows: [...document.querySelectorAll<HTMLElement>('[data-nav-id^="home-recents-"]')].map(
        (row) => row.dataset["navId"] ?? "",
      ),
    }))
    if (current === rowId) return
    const from = rows.indexOf(current)
    await remote.press(from < 0 || from < rows.indexOf(rowId) ? "Down" : "Up")
  }
  throw new Error(`Could not reach ${rowId}`)
}

// Opens recent channels in order until one plays, skipping offline ones.
const openNextLiveChannel = async (page: Page, remote: Remote, from: number) => {
  for (let index = from; index < CANDIDATES.length; index += 1) {
    const login = CANDIDATES[index] ?? ""
    const rowId = `home-recents-${login}`
    await goToRow(page, remote, rowId)
    await remote.press("Return")
    await expect(page.locator(".player")).toBeVisible()
    let outcome = await waitForPlayback(page)
    if (outcome === "gate") {
      await acceptGate(page, remote)
      outcome = await waitForPlayback(page)
    }
    console.log(`${login}: ${outcome}`)
    if (outcome === "playing") return { index, login, rowId }
    await remote.press("Escape")
    await remote.waitForFocus(rowId)
  }
  throw new Error(`None of ${CANDIDATES.join(", ")} was playable`)
}

test("open, play, pause, resume, go back and open another channel with the remote", async ({
  page,
  remote,
}, testInfo) => {
  await remote.waitForFocus("home-link")
  const first = await openNextLiveChannel(page, remote, 0)

  // Nothing overlaps the official player and it keeps Twitch's minimum size, in every layout
  // the viewer can reach: with chat, with the quality chooser open and with chat hidden.
  const expectUnobstructed = async (layout: string) => {
    const compliance = await playerCompliance(page)
    expect(compliance, layout).toMatchObject({ overlapping: [], visible: true })
    expect(compliance.width, layout).toBeGreaterThanOrEqual(400)
    expect(compliance.height, layout).toBeGreaterThanOrEqual(300)
  }
  await expectUnobstructed("chat visible")
  await page.screenshot({ path: testInfo.outputPath("playing.png") })

  await remote.waitForFocus("player-playback")
  await remote.press("Right", "Right")
  await remote.waitForFocus("player-quality")
  await remote.press("Return")
  await expect(page.locator(".player__qualities")).toBeVisible()
  await expectUnobstructed("quality chooser open")
  // Play/Pause keeps working while the chooser is open.
  await remote.press("space")
  await expect.poll(async () => (await videoSample(page))?.paused).toBe(true)
  await remote.press("space")
  await expect.poll(async () => (await videoSample(page))?.paused).toBe(false)
  await remote.press("Escape")
  await remote.waitForFocus("player-quality")

  await remote.press("Right", "Return")
  await expect(page.locator(".chat")).toHaveCount(0)
  await expectUnobstructed("chat hidden")
  await remote.press("Return")
  await expect(page.locator(".chat")).toHaveCount(1)

  // Twitch picks the resolution (ABR); record the largest one seen, without demanding 1080p.
  let largest = { height: 0, width: 0 }
  for (let sample = 0; sample < 5; sample += 1) {
    const video = await videoSample(page)
    if ((video?.height ?? 0) > largest.height)
      largest = { height: video?.height ?? 0, width: video?.width ?? 0 }
    await page.waitForTimeout(1_000)
  }
  const playing = await videoSample(page)
  testInfo.annotations.push({
    description: `${first.login}: hasta ${largest.width}x${largest.height}, muted=${playing?.muted}`,
    type: "playback",
  })

  // Space pauses through the official API; the shell shows it.
  await remote.press("space")
  await expect(page.locator('[data-nav-id="player-playback"]')).toContainText("Reanudar")
  const paused = await videoSample(page)
  await page.waitForTimeout(1_500)
  expect((await videoSample(page))?.time).toBeCloseTo(paused?.time ?? -1, 0)

  // The media Play key resumes.
  await remote.press("XF86AudioPlay")
  await expect(page.locator('[data-nav-id="player-playback"]')).toContainText("Pausa")
  const resumed = await videoSample(page)
  await page.waitForTimeout(2_000)
  expect((await videoSample(page))?.time ?? 0).toBeGreaterThan((resumed?.time ?? 0) + 1)

  // Back returns to the list with focus on the channel we came from.
  await remote.press("Escape")
  await expect(page.locator(".player")).toHaveCount(0)
  await remote.waitForFocus(first.rowId)

  // Another channel, still with the remote only.
  const second = await openNextLiveChannel(page, remote, first.index + 1)
  expect(second.login).not.toBe(first.login)
  await page.screenshot({ path: testInfo.outputPath("second.png") })
  await remote.press("Escape")
  await remote.waitForFocus(second.rowId)
})
