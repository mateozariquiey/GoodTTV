// Plugin de Vite que añade a la compilación `LICENSE` (la del proyecto, con la atribución de VacuumStream) y
// `TERCEROS.txt`, con la licencia de cada paquete de npm que acaba dentro (código y fuentes). Las licencias MIT y OFL
// piden que viajen con lo que se distribuye: la extensión (.xpi) y la app de la tele (AppImage).
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = dirname(fileURLToPath(import.meta.url))
const NODE_MODULES = `${sep}node_modules${sep}`

// La carpeta del paquete al que pertenece un módulo o un recurso: lo que va tras el último node_modules/.
const carpetaDelPaquete = (id) => {
  const ruta = id.replace(/^\0/, "").split("?")[0]
  const i = ruta.lastIndexOf(NODE_MODULES)
  if (i === -1) return undefined
  const [primero, segundo] = ruta.slice(i + NODE_MODULES.length).split(sep)
  const nombre = primero.startsWith("@") ? join(primero, segundo) : primero
  return join(ruta.slice(0, i + NODE_MODULES.length), nombre)
}

const textoDeLicencia = (carpeta) => {
  const archivo = readdirSync(carpeta).find((each) =>
    /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(each),
  )
  return archivo === undefined ? undefined : readFileSync(join(carpeta, archivo), "utf8").trim()
}

export const licencias = () => {
  let raiz = process.cwd()
  return {
    apply: "build",
    name: "goodttv-licencias",
    // Las rutas originales de los recursos (las fuentes) son relativas a la raíz de Vite.
    configResolved(config) {
      raiz = config.root
    },
    generateBundle(_options, bundle) {
      const carpetas = new Set()
      for (const item of Object.values(bundle)) {
        const ids =
          item.type === "chunk"
            ? (item.moduleIds ?? Object.keys(item.modules ?? {}))
            : (item.originalFileNames ?? [])
        for (const id of ids) {
          const carpeta = carpetaDelPaquete(id.startsWith("\0") ? id : resolve(raiz, id))
          if (carpeta !== undefined && existsSync(join(carpeta, "package.json")))
            carpetas.add(carpeta)
        }
      }
      const paquetes = [...carpetas]
        .map((carpeta) => ({
          carpeta,
          ...JSON.parse(readFileSync(join(carpeta, "package.json"), "utf8")),
        }))
        .filter((paquete) => !paquete.name.startsWith("@goodttv/"))
        .sort((a, b) => a.name.localeCompare(b.name))
      const secciones = paquetes.map((paquete) => {
        const texto =
          textoDeLicencia(paquete.carpeta) ?? "(El paquete no trae el texto de su licencia.)"
        return `${paquete.name} ${paquete.version}, licencia ${paquete.license ?? "sin indicar"}\n\n${texto}`
      })
      this.emitFile({
        fileName: "LICENSE",
        source: readFileSync(join(RAIZ, "LICENSE"), "utf8"),
        type: "asset",
      })
      if (paquetes.length === 0) return
      this.emitFile({
        fileName: "TERCEROS.txt",
        source: `Licencias de los paquetes de terceros incluidos en esta compilación de GoodTTV.\n\n${secciones.join(
          `\n\n${"-".repeat(78)}\n\n`,
        )}\n`,
        type: "asset",
      })
    },
  }
}
