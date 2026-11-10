import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { EN } from "../../../../packages/interfaz/src/idioma-en"
import { expect, type Remote, test } from "./support/app"

// El idioma (D35) con el mando, sin cuenta ni red de Twitch: «Sistema» sigue a LANG, y OK en el ajuste pasa a English,
// Español y otra vez Sistema, sin recargar.

// Las frases en español que en inglés se escriben de otra forma: ninguna debe verse con la app en inglés.
const SOLO_ESPANOL = Object.entries(EN)
  .filter(
    ([espanol, english]) => espanol !== english && espanol.length > 3 && !espanol.includes("{"),
  )
  .map(([espanol]) => espanol)

// Como palabras enteras: «ayer» no cuenta dentro de «player».
const espanolALaVista = (page: Page) =>
  page.evaluate((frases) => {
    const texto = document.body.innerText
    const escapar = (frase: string) => frase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return frases.filter((frase) =>
      new RegExp(`(?<![\\p{L}])${escapar(frase)}(?![\\p{L}])`, "u").test(texto),
    )
  }, SOLO_ESPANOL)

const toSettings = async (remote: Remote) => {
  await remote.waitForFocus("home-link")
  await remote.press("Up", "Right", "Right", "Return")
  await remote.waitForFocus("account-link")
}

// Debajo de la cuenta, en la columna de la izquierda.
const toLanguage = async (remote: Remote) => {
  await remote.press("Down")
  await remote.waitForFocus("setting-language")
}

test.describe("con el sistema en inglés", () => {
  test.use({ lang: "en_US.UTF-8" })

  test("starts in English and changes language with OK, without reloading", async ({
    app,
    page,
    remote,
  }) => {
    await expect(page.locator(".tabs")).toContainText("Following")
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en")
    expect(await espanolALaVista(page)).toEqual([])
    await toSettings(remote)
    expect(await espanolALaVista(page)).toEqual([])
    await toLanguage(remote)
    const setting = page.locator('[data-nav-id="setting-language"]')
    await expect(setting).toContainText("System (English)")
    const loaded = await page.evaluate(() => performance.timeOrigin)

    await remote.press("Return")
    await expect(setting).toContainText("English")
    await remote.press("Return")
    await expect(setting).toContainText("Español")
    await expect(page.locator(".tabs")).toContainText("Siguiendo")
    await expect(page.locator(".settings")).toContainText("Retraso del directo")
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("es")
    // Sin recargar, y el foco sigue en el ajuste.
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(loaded)
    expect(await remote.focusId()).toBe("setting-language")
    const profile = await app.evaluate(({ app: electron }) => electron.getPath("userData"))
    expect(JSON.parse(await readFile(join(profile, "idioma.json"), "utf8"))).toEqual({
      idioma: "es",
    })

    await remote.press("Return")
    await expect(setting).toContainText("System (English)")
    await expect(page.locator(".tabs")).toContainText("Following")
    expect(JSON.parse(await readFile(join(profile, "idioma.json"), "utf8"))).toEqual({
      idioma: "sistema",
    })

    // Buscar, en inglés también.
    await remote.press("Up")
    await remote.waitForFocus("account-link")
    await remote.press("Up", "Left", "Return")
    await remote.waitForFocus("key-a")
    await expect(page.locator(".search")).toContainText("Type at least two letters.")
    expect(await espanolALaVista(page)).toEqual([])
  })
})

test.describe("con el sistema en español", () => {
  test("«Sistema» es español", async ({ page, remote }) => {
    await expect(page.locator(".tabs")).toContainText("Siguiendo")
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("es")
    await toSettings(remote)
    await toLanguage(remote)
    await expect(page.locator('[data-nav-id="setting-language"]')).toContainText(
      "Sistema (Español)",
    )
  })
})
