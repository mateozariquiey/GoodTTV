import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { idiomaDelSistema, idiomaEfectivo, idiomaStore } from "./idioma"

describe("idioma de la TV", () => {
  let carpeta = ""
  beforeEach(async () => {
    carpeta = await mkdtemp(join(tmpdir(), "goodttv-idioma-"))
  })
  afterEach(() => rm(carpeta, { force: true, recursive: true }))

  it("sin nada guardado, o con algo raro, sigue al sistema", async () => {
    expect(idiomaStore(carpeta).elegido()).toBe("sistema")
    await writeFile(join(carpeta, "idioma.json"), '{"idioma":"klingon"}')
    expect(idiomaStore(carpeta).elegido()).toBe("sistema")
    await writeFile(join(carpeta, "idioma.json"), "{roto")
    expect(idiomaStore(carpeta).elegido()).toBe("sistema")
  })

  it("guarda lo elegido y lo lee al volver a abrir", async () => {
    const store = idiomaStore(carpeta)
    await store.elegir("en")
    expect(store.elegido()).toBe("en")
    expect(JSON.parse(await readFile(join(carpeta, "idioma.json"), "utf8"))).toEqual({
      idioma: "en",
    })
    expect(idiomaStore(carpeta).elegido()).toBe("en")
  })

  it("el del sistema es el primero de los preferidos, y si no hay, el de Chromium", () => {
    expect(idiomaDelSistema(["es-ES", "en-US"], "en-US")).toBe("es-ES")
    expect(idiomaDelSistema([], "en-US")).toBe("en-US")
    expect(idiomaEfectivo("sistema", "es-MX")).toBe("es")
    expect(idiomaEfectivo("sistema", "de-DE")).toBe("en")
    expect(idiomaEfectivo("es", "de-DE")).toBe("es")
  })
})
