// Empaqueta la extensión compilada (dist/) en dos archivos de out/:
//   - goodttv-<versión>.xpi: el que se instala en la familia Firefox (Zen incluida) o se sube a AMO para firmarlo;
//   - goodttv-<versión>-chrome.zip: el de Chrome (cargarlo descomprimido o subirlo a la Chrome Web Store), sin tener
//     que cambiarle la extensión. Su manifiesto no lleva lo que solo usa Firefox (browser_specific_settings, con la
//     dirección de sus actualizaciones, y background.scripts): Chrome 155 lo ignora sin avisar, pero así la tienda
//     no ve nada que no sea de Chrome.
// Los dos son un ZIP con manifest.json en la raíz; se escriben a mano con zlib para no añadir dependencias. Fechas
// fijas: el mismo dist/ da los mismos archivos.
// Uso, con la extensión compilada: node empaquetar.mjs (o bun run pack:navegador desde la raíz, que compila antes).
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"
import { crc32, deflateRawSync } from "node:zlib"

const dist = resolve(import.meta.dirname, "dist")
const out = resolve(import.meta.dirname, "out")

const UTF8_NAMES = 0x0800
const DEFLATE = 8
const DOS_DATE = (0 << 9) | (1 << 5) | 1 // 1 de enero de 1980, la primera fecha que admite el formato

// entries: [nombre, contenido], en el orden en que van.
const zip = (entries) => {
  const records = []
  const directory = []
  let offset = 0
  for (const [name, data] of entries) {
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
  end.writeUInt16LE(entries.length, 8) // entradas en este disco
  end.writeUInt16LE(entries.length, 10) // entradas en total
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...records, centralDirectory, end])
}

const names = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join("/"))
  .sort()
const entries = await Promise.all(
  names.map(async (name) => [name, await readFile(join(dist, name))]),
)
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"))
const { browser_specific_settings: _firefox, ...forChrome } = manifest
const { scripts: _scripts, ...background } = manifest.background
const chromeManifest = Buffer.from(`${JSON.stringify({ ...forChrome, background }, null, 2)}\n`)

await mkdir(out, { recursive: true })
const write = async (file, contents) => {
  const target = join(out, file)
  await writeFile(target, contents)
  console.log(`${relative(process.cwd(), target)}: ${entries.length} archivos`)
}
await write(`goodttv-${manifest.version}.xpi`, zip(entries))
await write(
  `goodttv-${manifest.version}-chrome.zip`,
  zip(entries.map(([name, data]) => [name, name === "manifest.json" ? chromeManifest : data])),
)
