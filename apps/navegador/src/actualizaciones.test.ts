import { describe, expect, it } from "vitest"
import updates from "../../../updates.json"
import manifest from "../public/manifest.json"

// Firefox busca versiones nuevas en updates.json, en la raíz del repo público (gecko.update_url del manifiesto), y
// descarga el .xpi firmado de la release (PUB-4). Al subir de versión, los dos cambian a la vez.
describe("updates.json", () => {
  const gecko = manifest.browser_specific_settings.gecko

  it("es el que dice el manifiesto", () => {
    expect(gecko.update_url).toBe(
      "https://raw.githubusercontent.com/mateozariquiey/GoodTTV/main/updates.json",
    )
  })

  it("anuncia la versión del manifiesto, con el .xpi de su release", () => {
    const entries = Object.entries(updates.addons)
    expect(entries.map(([id]) => id)).toEqual([gecko.id])
    expect(entries[0]?.[1].updates).toEqual([
      {
        update_link: `https://github.com/mateozariquiey/GoodTTV/releases/download/v${manifest.version}/goodttv-${manifest.version}.xpi`,
        version: manifest.version,
      },
    ])
  })
})
