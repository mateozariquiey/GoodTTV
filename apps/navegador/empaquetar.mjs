// Empaqueta la extensión compilada (dist/) en out/goodttv-<versión>.xpi, el archivo que se instala en la familia
// Firefox (Zen incluida) o se sube a AMO para firmarlo. Un .xpi es un ZIP con manifest.json en la raíz; se escribe a
// mano con zlib para no añadir dependencias. Fechas fijas: el mismo dist/ da el mismo archivo.
// Uso, con la extensión compilada: node empaquetar.mjs (o bun run pack:navegador desde la raíz, que compila antes).
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"
import { crc32, deflateRawSync } from "node:zlib"

const dist = resolve(import.meta.dirname, "dist")
const { version } = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"))
const target = resolve(import.meta.dirname, "out", `goodttv-${version}.xpi`)

const UTF8_NAMES = 0x0800
const DEFLATE = 8
const DOS_DATE = (0 << 9) | (1 << 5) | 1 // 1 de enero de 1980, la primera fecha que admite el formato

const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join("/"))
  .sort()

const records = []
const directory = []
let offset = 0
for (const name of files) {
  const data = await readFile(join(dist, name))
  const packed = deflateRawSync(data, { level: 9 })
  const nameBytes = Buffer.from(name, "utf8")
  // Campos comunes a la cabecera local y a la del directorio central, desde «versión necesaria».
  const common = Buffer.alloc(26)
  common.writeUInt16LE(20, 0) // versión necesaria: 2.0 (deflate)
  common.writeUInt16LE(UTF8_NAMES, 2)
  common.writeUInt16LE(DEFLATE, 4)
  common.writeUInt16LE(0, 6) // hora
  common.writeUInt16LE(DOS_DATE, 8)
  common.writeUInt32LE(crc32(data), 10)
  common.writeUInt32LE(packed.length, 14)
  common.writeUInt32LE(data.length, 18)
  common.writeUInt16LE(nameBytes.length, 22)
  common.writeUInt16LE(0, 24) // sin campos extra

  const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), common, nameBytes, packed])
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4) // versión que lo creó
  common.copy(central, 6)
  // Comentario, disco, atributos internos y externos: a cero. Después, dónde empieza la cabecera local.
  central.writeUInt32LE(offset, 42)
  records.push(local)
  directory.push(Buffer.concat([central, nameBytes]))
  offset += local.length
}

const centralDirectory = Buffer.concat(directory)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(files.length, 8) // entradas en este disco
end.writeUInt16LE(files.length, 10) // entradas en total
end.writeUInt32LE(centralDirectory.length, 12)
end.writeUInt32LE(offset, 16)

await mkdir(resolve(import.meta.dirname, "out"), { recursive: true })
await writeFile(target, Buffer.concat([...records, centralDirectory, end]))
console.log(`${relative(process.cwd(), target)}: ${files.length} archivos`)
