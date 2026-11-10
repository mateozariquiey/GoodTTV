import { readFileSync } from "node:fs"
import { join } from "node:path"
import { IdiomaElegidoSchema, type IdiomaInicial } from "@goodttv/contratos"
import { ownerFile } from "./local-store"

// El idioma elegido en la TV (D35), en idioma.json de la carpeta de datos. No va en el localStorage de la página, como
// en la extensión: el origen de la interfaz cambia de puerto en cada arranque. Se lee una vez al abrir, sin esperar, para
// que la página lo tenga antes de pintar nada; lo que no se entienda cuenta como «sistema».
type Elegido = IdiomaInicial["elegido"]

export type IdiomaStore = {
  readonly elegido: () => Elegido
  readonly elegir: (valor: Elegido) => Promise<void>
}

const NOMBRE = "idioma.json"

export const idiomaStore = (directory: string): IdiomaStore => {
  let elegido: Elegido = "sistema"
  try {
    const guardado: unknown = JSON.parse(readFileSync(join(directory, NOMBRE), "utf8"))
    const valor = typeof guardado === "object" && guardado !== null && "idioma" in guardado
    const parsed = IdiomaElegidoSchema.safeParse(valor ? guardado.idioma : undefined)
    if (parsed.success) elegido = parsed.data
  } catch {
    // Sin archivo (la primera vez) o roto: se sigue al sistema.
  }
  const file = ownerFile(directory, NOMBRE)
  let operations: Promise<unknown> = Promise.resolve()
  return {
    elegido: () => elegido,
    elegir: (valor) => {
      elegido = IdiomaElegidoSchema.parse(valor)
      const write = () => file.write(`${JSON.stringify({ idioma: elegido })}\n`)
      const result = operations.then(write, write)
      operations = result.catch(() => undefined)
      return result
    },
  }
}

// El idioma del sistema: el primero de los preferidos (en Linux, LANGUAGE, LC_ALL, LC_MESSAGES y LANG, por ese orden), y
// si no hay ninguno, el de Chromium.
export const idiomaDelSistema = (preferidos: readonly string[], locale: string): string =>
  preferidos[0] ?? locale

// Lo poco que pinta el proceso principal: el aviso si la app no puede arrancar.
export const idiomaEfectivo = (elegido: Elegido, sistema: string): "es" | "en" =>
  elegido !== "sistema" ? elegido : sistema.toLowerCase().startsWith("es") ? "es" : "en"
