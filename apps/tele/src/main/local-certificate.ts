import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
} from "node:crypto"
import { ownerFile } from "./local-store"

// El certificado del servidor HTTPS de localhost (https-server.ts). Cada instalación crea el suyo y lo guarda en su
// carpeta de datos: la clave no viaja con la app ni está en el repo. No hace falta que nadie confíe en él, porque el
// proceso principal lo acepta solo por su huella (index.ts), así que basta con que sea un certificado final válido.
// Node sabe firmar pero no crear certificados, y para esto no merece la pena una dependencia: es DER a mano.

export type LocalCertificate = {
  readonly certificate: string
  readonly key: string
}

const FILE_NAME = "localhost-certificate.json"
const DAY = 24 * 60 * 60 * 1000
const VALID_YEARS = 10

const lengthBytes = (length: number): Buffer => {
  if (length < 0x80) return Buffer.of(length)
  const bytes: number[] = []
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256)
  return Buffer.of(0x80 | bytes.length, ...bytes)
}

const der = (tag: number, ...contents: readonly Buffer[]): Buffer => {
  const body = Buffer.concat(contents)
  return Buffer.concat([Buffer.of(tag), lengthBytes(body.length), body])
}

const sequence = (...contents: readonly Buffer[]): Buffer => der(0x30, ...contents)
const bitString = (bytes: Buffer): Buffer => der(0x03, Buffer.of(0), bytes)

const oid = (dotted: string): Buffer => {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number)
  const bytes = [first * 40 + second]
  for (const arc of rest) {
    const groups = [arc % 128]
    for (let high = arc >> 7; high > 0; high >>= 7) groups.unshift((high % 128) | 0x80)
    bytes.push(...groups)
  }
  return der(0x06, Buffer.from(bytes))
}

// RFC 5280: UTCTime hasta 2049 y GeneralizedTime desde 2050.
const time = (date: Date): Buffer => {
  const text = `${date.toISOString().replaceAll(/[-:T]/g, "").slice(0, 14)}Z`
  return date.getUTCFullYear() < 2050
    ? der(0x17, Buffer.from(text.slice(2), "ascii"))
    : der(0x18, Buffer.from(text, "ascii"))
}

const extension = (id: string, critical: boolean, value: Buffer): Buffer =>
  sequence(oid(id), ...(critical ? [der(0x01, Buffer.of(0xff))] : []), der(0x04, value))

const pem = (label: string, body: Buffer): string =>
  `-----BEGIN ${label}-----\n${body.toString("base64").replaceAll(/.{64}/g, "$&\n").trimEnd()}\n-----END ${label}-----\n`

export const createLocalCertificate = (now = new Date()): LocalCertificate => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  const name = sequence(der(0x31, sequence(oid("2.5.4.3"), der(0x0c, Buffer.from("localhost")))))
  const signatureAlgorithm = sequence(oid("1.2.840.10045.4.3.2")) // ecdsa-with-SHA256

  // Número de serie positivo y sin ceros de relleno: el primer byte queda entre 0x40 y 0x7f.
  const serial = randomBytes(16)
  serial.writeUInt8((serial.readUInt8(0) & 0x3f) | 0x40, 0)

  const notAfter = new Date(now)
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + VALID_YEARS)

  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.of(2))), // X.509 v3
    der(0x02, serial),
    signatureAlgorithm,
    name,
    sequence(time(new Date(now.getTime() - DAY)), time(notAfter)),
    name,
    publicKey.export({ format: "der", type: "spki" }),
    der(
      0xa3,
      sequence(
        extension("2.5.29.19", true, sequence()), // basicConstraints: sin CA:TRUE
        extension("2.5.29.15", true, der(0x03, Buffer.of(7, 0x80))), // keyUsage: digitalSignature
        extension("2.5.29.37", false, sequence(oid("1.3.6.1.5.5.7.3.1"))), // extKeyUsage: serverAuth
        extension(
          "2.5.29.17",
          false,
          sequence(der(0x82, Buffer.from("localhost")), der(0x87, Buffer.of(127, 0, 0, 1))),
        ), // subjectAltName
      ),
    ),
  )

  return {
    certificate: pem(
      "CERTIFICATE",
      sequence(tbs, signatureAlgorithm, bitString(sign("sha256", tbs, privateKey))),
    ),
    key: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  }
}

// Cualquier cosa que no sirva (archivo roto, clave que no es la suya, fuera de fechas) se resuelve creando otro: nada
// depende de que se conserve, porque la huella se calcula en cada arranque. Las fechas se miran con el mismo reloj que
// usa Chromium, y así un reloj que se ha movido no deja la app sin arrancar.
const parseUsable = (text: string, now: Date): LocalCertificate | undefined => {
  try {
    const { certificate, key } = JSON.parse(text) as Partial<LocalCertificate>
    if (typeof certificate !== "string" || typeof key !== "string") return undefined
    const parsed = new X509Certificate(certificate)
    const inDate =
      Date.parse(parsed.validFrom) <= now.getTime() && now.getTime() < Date.parse(parsed.validTo)
    return inDate && parsed.checkPrivateKey(createPrivateKey(key))
      ? { certificate, key }
      : undefined
  } catch {
    return undefined
  }
}

export const loadLocalCertificate = async (
  directory: string,
  now = new Date(),
): Promise<LocalCertificate> => {
  const file = ownerFile(directory, FILE_NAME)
  const saved = await file.read().catch(() => undefined)
  const usable = saved === undefined ? undefined : parseUsable(saved, now)
  if (usable !== undefined) return usable

  const created = createLocalCertificate(now)
  try {
    await file.write(JSON.stringify(created))
  } catch (error) {
    // Sin poder guardarlo, la app funciona igual con este y creará otro en el próximo arranque.
    console.warn("Could not save the localhost certificate", error)
  }
  return created
}
