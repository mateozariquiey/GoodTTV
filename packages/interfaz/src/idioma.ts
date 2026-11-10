import { useSyncExternalStore } from "react"
import { EN } from "./idioma-en"

// El idioma de las tres versiones (issue #1 del repo público). El texto sigue escrito en español en el código, y esa frase
// es la clave de su traducción en idioma-en.ts: t("Ajustes") da «Settings» en inglés. Hasta que la versión llama a
// activarIdioma, t() devuelve la frase tal cual.

export type Idioma = "es" | "en"
export type IdiomaElegido = "sistema" | Idioma
export type Clave = keyof typeof EN

// Dónde se guarda lo elegido y cuál es el idioma del sistema. Por defecto, el localStorage de la página y el idioma del
// navegador (la extensión y Android). La TV lo guarda en su carpeta de datos, porque el origen de su página cambia de
// puerto en cada arranque, y el del sistema se lo da el proceso principal (window.api.idioma).
export type FuenteIdioma = {
  readonly leer: () => string | null
  readonly guardar: (valor: IdiomaElegido) => void
  readonly sistema: () => string // BCP 47, como navigator.language
  // Avisa cuando otra página cambia lo elegido (el evento «storage» entre pestañas, EXT-5).
  readonly alCambiar?: (aviso: () => void) => void
}

// Una sola por navegador o teléfono, y se lee sin esperar, para no pintar Inicio primero en el idioma que no toca.
const CLAVE_GUARDADA = "goodttv-idioma"

const DE_LA_PAGINA: FuenteIdioma = {
  alCambiar: (aviso) =>
    addEventListener("storage", (evento) => {
      if (evento.key === CLAVE_GUARDADA || evento.key === null) aviso()
    }),
  guardar: (valor) => {
    try {
      if (valor === "sistema") localStorage.removeItem(CLAVE_GUARDADA)
      else localStorage.setItem(CLAVE_GUARDADA, valor)
    } catch {
      // Sin acceso al almacén: vale para esta página aunque no se recuerde.
    }
  },
  leer: () => {
    try {
      return localStorage.getItem(CLAVE_GUARDADA)
    } catch {
      return null // se sigue al sistema, y el cambio dura hasta recargar
    }
  },
  sistema: () => navigator.language,
}

let activo = false
let fuente: FuenteIdioma = DE_LA_PAGINA
let elegido: IdiomaElegido = "sistema"
let actual: Idioma = "es"
const avisos = new Set<() => void>()

const delSistema = (): Idioma => (fuente.sistema().toLowerCase().startsWith("es") ? "es" : "en")

const validar = (valor: string | null): IdiomaElegido =>
  valor === "es" || valor === "en" ? valor : "sistema"

const leer = (): IdiomaElegido => validar(fuente.leer())

const aplicar = (valor: IdiomaElegido): void => {
  elegido = valor
  actual = valor === "sistema" ? delSistema() : valor
  document.documentElement.lang = actual
  for (const aviso of avisos) aviso()
}

// Al arrancar la página, antes de pintar nada.
export const activarIdioma = (otra?: FuenteIdioma): void => {
  if (activo) return
  activo = true
  if (otra !== undefined) fuente = otra
  aplicar(leer())
  fuente.alCambiar?.(() => aplicar(leer()))
  addEventListener("languagechange", () => {
    if (elegido === "sistema") aplicar("sistema")
  })
}

export const elegirIdioma = (valor: IdiomaElegido): void => {
  fuente.guardar(valor)
  aplicar(valor)
}

export const idiomaActual = (): Idioma => actual
export const idiomaElegido = (): IdiomaElegido => elegido

// El idioma de los directos de «Populares»: el elegido, y si no, el del sistema, sea el que sea (aunque la interfaz no
// esté traducida a él).
export const idiomaDelCatalogo = (): string =>
  elegido === "sistema" ? fuente.sistema().slice(0, 2).toLowerCase() || "es" : elegido

const suscribir = (aviso: () => void): (() => void) => {
  avisos.add(aviso)
  return () => avisos.delete(aviso)
}

// Vuelve a pintar el componente al cambiar el idioma, también si lo cambia otra pestaña. Basta en la raíz, porque todo
// lo que cuelga de ella se pinta otra vez, y en los componentes con memo.
export const useIdioma = (): Idioma => {
  useSyncExternalStore(suscribir, idiomaElegido) // «Sistema» y «Español» pueden dar el mismo idioma: el selector cambia igual
  return useSyncExternalStore(suscribir, idiomaActual)
}

// Lo que llega ya escrito de @goodttv/servicios: errores de la cuenta, de Helix y del envío al chat. Va en español, como
// el resto del código, y se traduce al pintarlo, porque servicios no conoce el idioma (en la TV corre en el proceso
// principal). Lo que no sea de los nuestros, como lo que responda Twitch o la red, se deja como viene.
export const tMensaje = (mensaje: string): string => {
  if (actual !== "en") return mensaje
  const traducciones: Readonly<Record<string, string>> = EN
  const conEstado = /^(.*) (\d+)$/.exec(mensaje)
  const conMarca = conEstado && traducciones[`${conEstado[1]} {estado}`]
  if (conEstado !== null && conMarca) return conMarca.replace("{estado}", conEstado[2] ?? "")
  return traducciones[mensaje] ?? mensaje
}

export const t = (clave: Clave, valores?: Readonly<Record<string, number | string>>): string => {
  const texto: string = actual === "en" ? EN[clave] : clave
  if (valores === undefined) return texto
  return texto.replace(/\{(\w+)\}/g, (marca, nombre: string) => String(valores[nombre] ?? marca))
}
