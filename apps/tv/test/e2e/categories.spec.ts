import { expect, test } from "./support/app"

// El directorio de categorías (D49) con el mando, sin cuenta. Necesita red: las categorías son las de Twitch ahora.

test("the category directory: the most watched, the streams of one, and Back to where it was", async ({
  page,
  remote,
}, testInfo) => {
  await remote.waitForFocus("home-link")
  await remote.press("Up", "Right", "Right")
  expect(await remote.focusId()).toBe("tab-categories")
  await remote.press("Return")
  // Al llegar la lista, el foco pasa de la pestaña a la categoría con más espectadores.
  await expect.poll(() => remote.focusId(), { timeout: 15_000 }).toMatch(/^category-[a-z0-9-]+$/)
  const first = await remote.focusId()
  await expect(page.locator(".category-preview .preview__title")).toHaveText(
    (await page.locator(`[data-nav-id="${first}"] .row__name`).textContent()) ?? "",
  )
  await page.screenshot({ path: testInfo.outputPath("categorias.png") })
  await remote.press("Down")
  const second = await remote.focusId()
  expect(second).toMatch(/^category-[a-z0-9-]+$/)
  expect(second).not.toBe(first)
  // OK abre sus directos, con el foco en el más visto.
  await remote.press("Return")
  await expect
    .poll(() => remote.focusId(), { timeout: 15_000 })
    .toMatch(/^category-stream-[a-z0-9_]+$/)
  await expect(page.locator(".guide__heading").filter({ visible: true })).toContainText(
    (await page.locator(`[data-nav-id="${second}"] .row__name`).textContent()) ?? "",
  )
  await page.screenshot({ path: testInfo.outputPath("categoria.png") })
  // Atrás vuelve a la lista, en la categoría de la que se salió; y otra vez, a Inicio.
  await remote.press("Escape")
  await remote.waitForFocus(second ?? "")
  await remote.press("Escape")
  await remote.waitForFocus("home-link")
})
