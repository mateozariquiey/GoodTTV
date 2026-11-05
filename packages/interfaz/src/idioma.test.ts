import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EN } from "./idioma-en"

// El módulo guarda el idioma elegido, así que cada prueba lo carga de nuevo.
const cargar = async (lenguaje: string, guardado?: string) => {
  vi.resetModules()
  const almacen = new Map(guardado === undefined ? [] : [["goodttv-idioma", guardado]])
  vi.stubGlobal("navigator", { language: lenguaje })
  vi.stubGlobal("document", { documentElement: { lang: "" } })
  vi.stubGlobal("addEventListener", () => undefined)
  vi.stubGlobal("localStorage", {
    getItem: (clave: string) => almacen.get(clave) ?? null,
    removeItem: (clave: string) => almacen.delete(clave),
    setItem: (clave: string, valor: string) => almacen.set(clave, valor),
  })
  return { ...(await import("./idioma")), almacen }
}

describe("idioma", () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it("sin activar sigue en español, como la tele, aunque el sistema vaya en inglés", async () => {
    const { t } = await cargar("en-US")
    expect(t("Ajustes")).toBe("Ajustes")
  })

  it("sigue al sistema: español si lo es, y si no, inglés", async () => {
    const espanol = await cargar("es-MX")
    espanol.activarIdioma()
    expect(espanol.t("Ajustes")).toBe("Ajustes")
    const aleman = await cargar("de-DE")
    aleman.activarIdioma()
    expect(aleman.t("Ajustes")).toBe("Settings")
    expect(document.documentElement.lang).toBe("en")
  })

  it("lo elegido gana al sistema, se recuerda y se puede volver a seguirlo", async () => {
    const { activarIdioma, almacen, elegirIdioma, t } = await cargar("es-ES")
    activarIdioma()
    elegirIdioma("en")
    expect(t("Ajustes")).toBe("Settings")
    expect(almacen.get("goodttv-idioma")).toBe("en")

    const otraVez = await cargar("es-ES", "en")
    otraVez.activarIdioma()
    expect(otraVez.idiomaElegido()).toBe("en")
    expect(otraVez.t("Ajustes")).toBe("Settings")

    otraVez.elegirIdioma("sistema")
    expect(otraVez.idiomaElegido()).toBe("sistema")
    expect(otraVez.almacen.has("goodttv-idioma")).toBe(false)
    expect(otraVez.t("Ajustes")).toBe("Ajustes")
  })

  it("no se fía de lo guardado: un valor raro es seguir al sistema", async () => {
    const { activarIdioma, idiomaElegido } = await cargar("es-ES", "klingon")
    activarIdioma()
    expect(idiomaElegido()).toBe("sistema")
  })

  it("rellena los valores en la traducción", async () => {
    const { activarIdioma, elegirIdioma, t } = await cargar("es-ES")
    activarIdioma()
    expect(t("hace {n} días", { n: 3 })).toBe("hace 3 días")
    elegirIdioma("en")
    expect(t("hace {n} días", { n: 3 })).toBe("3 days ago")
  })

  it("traduce lo que llega de servicios, con su código, y deja lo demás como viene", async () => {
    const { activarIdioma, elegirIdioma, tMensaje } = await cargar("es-ES")
    activarIdioma()
    expect(tMensaje("El mensaje es demasiado largo.")).toBe("El mensaje es demasiado largo.")
    elegirIdioma("en")
    expect(tMensaje("El mensaje es demasiado largo.")).toBe("The message is too long.")
    expect(tMensaje("Twitch ha dado un error 503")).toBe("Twitch returned error 503")
    expect(tMensaje("Followers-only mode")).toBe("Followers-only mode")
    expect(tMensaje("Failed to fetch 2")).toBe("Failed to fetch 2")
  })

  it("«Populares» va en el idioma elegido, y si no, en el del sistema aunque no esté traducido", async () => {
    const { activarIdioma, elegirIdioma, idiomaDelCatalogo } = await cargar("de-DE")
    activarIdioma()
    expect(idiomaDelCatalogo()).toBe("de")
    elegirIdioma("es")
    expect(idiomaDelCatalogo()).toBe("es")
  })
})

describe("traducciones", () => {
  const marcas = (texto: string): string[] => (texto.match(/\{\w+\}/g) ?? []).sort()

  it("cada una lleva los mismos valores que su frase en español", () => {
    for (const [espanol, english] of Object.entries(EN)) {
      expect(marcas(english), espanol).toEqual(marcas(espanol))
      expect(english.trim(), espanol).not.toBe("")
    }
  })
})

// Los tipos no ven estos mensajes, porque llegan como texto: se buscan en el código de servicios.
describe("mensajes de @goodttv/servicios", () => {
  const CARPETA = join(import.meta.dirname, "../../servicios/src")
  const MENSAJE =
    /(?:ConfigurationError\(|new Error\(|super\(|kind: "error", message: |\?\? |\|\| |\? |: )"([\p{Lu}\p{Ll}][^"]* [^"]*)"/gu
  // Las de código van con una plantilla, sin más texto que el número al final.
  const CON_ESTADO = /super\(`([^`$]*)\$\{status\}`\)/g

  it("todos están traducidos, y los que llevan un código, con su plantilla", () => {
    const traducciones: Readonly<Record<string, string>> = EN
    const faltan: string[] = []
    let vistos = 0
    for (const archivo of readdirSync(CARPETA, { recursive: true, encoding: "utf8" })) {
      if (!archivo.endsWith(".ts") || archivo.endsWith(".test.ts")) continue
      const codigo = readFileSync(join(CARPETA, archivo), "utf8")
      for (const [, frase = ""] of codigo.matchAll(MENSAJE)) {
        vistos++
        if (traducciones[frase] === undefined) faltan.push(`${archivo}: ${frase}`)
      }
      for (const [, frase = ""] of codigo.matchAll(CON_ESTADO)) {
        vistos++
        if (traducciones[`${frase}{estado}`] === undefined) faltan.push(`${archivo}: ${frase}`)
      }
    }
    expect(faltan).toEqual([])
    expect(vistos).toBeGreaterThan(10)
  })
})

// La guarda contra lo que más fácil se escapa: escribir texto en una pantalla sin pasarlo por t(). Se mira el texto de
// JSX y los atributos que se leen o se oyen (t() ya comprueba en los tipos que la frase esté traducida).
describe("pantallas de la extensión y de Android", () => {
  const RAIZ = join(import.meta.dirname, "../../..")
  const CARPETAS = ["apps/navegador/src/escritorio", "apps/android/web/pantallas"]
  // Igual en los dos idiomas: marcas y palabras que no se traducen.
  const SIN_TRADUCIR = new Set([
    "Chat",
    "Emote",
    "Emotes",
    "GoodTTV",
    "Twitch",
    "Español",
    "English",
  ])

  it("no dejan texto sin traducir", () => {
    const escapados: string[] = []
    for (const carpeta of CARPETAS) {
      for (const archivo of readdirSync(join(RAIZ, carpeta))) {
        if (!archivo.endsWith(".tsx")) continue
        const codigo = readFileSync(join(RAIZ, carpeta, archivo), "utf8").replace(
          /\{\/\*.*?\*\/\}/gs,
          "",
        )
        const atributos = codigo.matchAll(
          /\b(?:aria-label|title|placeholder|label|titulo|videos)="([^"]*\p{L}[^"]*)"/gu,
        )
        const textos = codigo.matchAll(/(?<!=)>\s*([\p{Lu}¿¡][\p{L} ,.:…]*[\p{L}.…])\s*(?:<|\{)/gu)
        // Una plantilla con una palabra junto al valor, como `Avanzar ${n} s` o `${n} visualizaciones`.
        const plantillas = codigo
          .split("\n")
          .filter((linea) => !/className|\bt\(/.test(linea))
          .flatMap((linea) => [
            ...linea.matchAll(/(`[^`]*(?:\p{Ll}{3,} \$\{|\} \p{Ll}{3,})[^`]*`)/gu),
          ])
        for (const [, texto] of [...atributos, ...textos, ...plantillas]) {
          if (texto !== undefined && !SIN_TRADUCIR.has(texto))
            escapados.push(`${archivo}: ${texto}`)
        }
      }
    }
    expect(escapados).toEqual([])
  })
})
