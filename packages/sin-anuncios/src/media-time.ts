// Tiempo del contenido de los fragmentos (PTS en MPEG-TS, tfdt en fMP4) y recorte de trozos del VOD.
// Es el reloj que comparten el directo y el VOD de Twitch; el PDT y ELAPSED-SECS no sirven porque los anuncios
// los desplazan en cada sesión.

export type Bytes = Uint8Array

// El PTS de TS da la vuelta cada 2^33 / 90 000 s (~26,5 h): se lleva al valor más cercano a la referencia.
export const PTS_WRAP = 2 ** 33 / 90_000
export const unwrap = (time: number, ref: number): number =>
  time + Math.round((ref - time) / PTS_WRAP) * PTS_WRAP

const at = (bytes: Bytes, index: number): number => bytes[index] ?? 0
const pidOf = (bytes: Bytes, i: number): number =>
  ((at(bytes, i + 1) & 0x1f) << 8) | at(bytes, i + 2)

// PTS (s) del paquete TS que empieza en i si abre un PES de vídeo; si no, null.
const videoPesPts = (bytes: Bytes, i: number): number | null => {
  if (at(bytes, i) !== 0x47 || !(at(bytes, i + 1) & 0x40)) return null
  const control = (at(bytes, i + 3) >> 4) & 3
  let p = i + 4
  if (control & 2) p += 1 + at(bytes, p)
  if (!(control & 1) || p + 14 > i + 188) return null
  const pes = at(bytes, p) === 0 && at(bytes, p + 1) === 0 && at(bytes, p + 2) === 1
  const stream = at(bytes, p + 3)
  if (!pes || stream < 0xe0 || stream > 0xef || !(at(bytes, p + 7) & 0x80)) return null
  const b = (k: number): number => at(bytes, p + 9 + k)
  return (
    (((b(0) >> 1) & 7) * 2 ** 30 +
      b(1) * 2 ** 22 +
      (b(2) >> 1) * 2 ** 15 +
      b(3) * 2 ** 7 +
      (b(4) >> 1)) /
    90_000
  )
}

// PTS (s) del primer PES de vídeo de un fragmento MPEG-TS.
export const firstVideoPts = (bytes: Bytes): number | null => {
  for (let i = bytes.indexOf(0x47); i >= 0 && i + 188 <= bytes.length; i += 188) {
    const pts = videoPesPts(bytes, i)
    if (pts !== null) return pts
  }
  return null
}

// ¿Abre el paquete i un fotograma independiente? Indicador de acceso aleatorio del TS, o una unidad IDR (tipo 5)
// en la carga del PES, que puede seguir en paquetes del mismo PID (tras AUD, SPS, PPS o SEI).
const isKeyframe = (bytes: Bytes, i: number): boolean => {
  const control = (at(bytes, i + 3) >> 4) & 3
  if (control & 2 && at(bytes, i + 4) > 0 && at(bytes, i + 5) & 0x40) return true
  const pid = pidOf(bytes, i)
  let p = i + 4 + (control & 2 ? 1 + at(bytes, i + 4) : 0)
  p += 9 + at(bytes, p + 8)
  const parts: Bytes[] = [bytes.subarray(p, i + 188)]
  for (let j = i + 188, n = 0; j + 188 <= bytes.length && n < 30; j += 188) {
    if (pidOf(bytes, j) !== pid) continue
    if (at(bytes, j + 1) & 0x40) break
    const c = (at(bytes, j + 3) >> 4) & 3
    if (c & 1) parts.push(bytes.subarray(j + 4 + (c & 2 ? 1 + at(bytes, j + 4) : 0), j + 188))
    n++
  }
  const payload = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) {
    payload.set(part, offset)
    offset += part.length
  }
  for (let k = 0; k + 3 < payload.length; k++) {
    if (at(payload, k) === 0 && at(payload, k + 1) === 0 && at(payload, k + 2) === 1) {
      const type = at(payload, k + 3) & 0x1f
      if (type === 5) return true
      if (type === 1) return false
    }
  }
  return false
}

// PID de la PMT según la PAT (primer programa distinto de 0).
const pmtPid = (bytes: Bytes, start: number): number | null => {
  for (let i = start; i + 188 <= bytes.length; i += 188) {
    if (at(bytes, i) !== 0x47 || pidOf(bytes, i) !== 0 || !(at(bytes, i + 1) & 0x40)) continue
    const control = (at(bytes, i + 3) >> 4) & 3
    let p = i + 4 + (control & 2 ? 1 + at(bytes, i + 4) : 0)
    p += 1 + at(bytes, p)
    const length = ((at(bytes, p + 1) & 0x0f) << 8) | at(bytes, p + 2)
    const end = Math.min(i + 188, p + 3 + length - 4)
    for (let q = p + 8; q + 4 <= end; q += 4) {
      if (((at(bytes, q) << 8) | at(bytes, q + 1)) !== 0) {
        return ((at(bytes, q + 2) & 0x1f) << 8) | at(bytes, q + 3)
      }
    }
    return null
  }
  return null
}

// Recorta un fragmento TS para que empiece en el fotograma independiente cuyo PTS cae en fromPts (±0,1 s). Si no hay
// uno ahí devuelve null: uno posterior no vale, porque la lista anunciaría un comienzo que no es el real. Delante se
// conservan solo PAT y PMT.
export const trimTs = (bytes: Bytes, fromPts: number): Bytes | null => {
  const start = bytes.indexOf(0x47)
  if (start < 0) return null
  let firstVideo = -1
  for (let i = start; i + 188 <= bytes.length; i += 188) {
    const pts = videoPesPts(bytes, i)
    if (pts === null) continue
    if (firstVideo < 0) firstVideo = i
    if (pts < fromPts - 0.1) continue
    if (pts > fromPts + 0.1) return null
    if (!isKeyframe(bytes, i)) continue
    if (i === firstVideo) return bytes.subarray(start)
    const pmt = pmtPid(bytes, start)
    const header: Bytes[] = []
    for (let j = start; j < firstVideo; j += 188) {
      const pid = pidOf(bytes, j)
      if (pid === 0 || pid === pmt) header.push(bytes.subarray(j, j + 188))
    }
    const out = new Uint8Array(header.length * 188 + bytes.length - i)
    for (const [k, packet] of header.entries()) out.set(packet, k * 188)
    out.set(bytes.subarray(i), header.length * 188)
    return out
  }
  return null
}

// fMP4 ----------------------------------------------------------------------------------------------------------

type Box = {
  readonly type: string
  readonly at: number
  readonly start: number
  readonly end: number
}
export type VideoTrack = { readonly id: number; readonly timescale: number }

const u32 = (b: Bytes, p: number): number =>
  at(b, p) * 2 ** 24 + (at(b, p + 1) << 16) + (at(b, p + 2) << 8) + at(b, p + 3)

// Cajas [tamaño, tipo] entre start y end; se detiene en una caja cortada o con una cabecera imposible.
function* boxes(b: Bytes, start = 0, end = b.length): Generator<Box> {
  for (let p = start; p + 8 <= end; ) {
    let size = u32(b, p)
    let header = 8
    if (size === 1) {
      if (p + 16 > end) return
      size = u32(b, p + 8) * 2 ** 32 + u32(b, p + 12)
      header = 16
    } else if (size === 0) size = end - p
    if (size < header || p + size > end) return
    yield {
      at: p,
      end: p + size,
      start: p + header,
      type: String.fromCharCode(...b.subarray(p + 4, p + 8)),
    }
    p += size
  }
}

const child = (b: Bytes, parent: Box, type: string): Box | undefined =>
  [...boxes(b, parent.start, parent.end)].find((box) => box.type === type)
const fits = (box: Box | undefined, size: number): box is Box =>
  box !== undefined && box.end - box.start >= size

// Pista de vídeo de un segmento de inicialización: su número y su escala de tiempo.
export const fmp4VideoTrack = (init: Bytes): VideoTrack | null => {
  const moov = [...boxes(init)].find((box) => box.type === "moov")
  if (moov === undefined) return null
  for (const trak of boxes(init, moov.start, moov.end)) {
    if (trak.type !== "trak") continue
    const mdia = child(init, trak, "mdia")
    const hdlr = mdia && child(init, mdia, "hdlr")
    if (mdia === undefined || !fits(hdlr, 12)) continue
    if (String.fromCharCode(...init.subarray(hdlr.start + 8, hdlr.start + 12)) !== "vide") continue
    const mdhd = child(init, mdia, "mdhd")
    const tkhd = child(init, trak, "tkhd")
    if (mdhd === undefined || tkhd === undefined) return null
    const mdhdAt = at(init, mdhd.start) === 1 ? 20 : 12
    const tkhdAt = at(init, tkhd.start) === 1 ? 20 : 12
    if (!fits(mdhd, mdhdAt + 4) || !fits(tkhd, tkhdAt + 4)) return null
    const timescale = u32(init, mdhd.start + mdhdAt)
    return timescale > 0 ? { id: u32(init, tkhd.start + tkhdAt), timescale } : null
  }
  return null
}

type VideoTraf = { readonly traf: Box; readonly tfhd: Box }

const videoTraf = (b: Bytes, moof: Box, track: VideoTrack): VideoTraf | null => {
  for (const traf of boxes(b, moof.start, moof.end)) {
    if (traf.type !== "traf") continue
    const tfhd = child(b, traf, "tfhd")
    if (fits(tfhd, 8) && u32(b, tfhd.start + 4) === track.id) return { tfhd, traf }
  }
  return null
}

const trafTime = (b: Bytes, { traf }: VideoTraf, track: VideoTrack): number | null => {
  const tfdt = child(b, traf, "tfdt")
  if (tfdt === undefined) return null
  const v1 = at(b, tfdt.start) === 1
  if (!fits(tfdt, v1 ? 12 : 8)) return null
  const units = v1
    ? u32(b, tfdt.start + 4) * 2 ** 32 + u32(b, tfdt.start + 8)
    : u32(b, tfdt.start + 4)
  const time = units / track.timescale
  return Number.isFinite(time) ? time : null
}

// ¿La primera muestra de vídeo del traf es independiente? Marcas de trun o, si no, de tfhd. null si no se sabe.
const trafFirstSampleSync = (b: Bytes, { traf, tfhd }: VideoTraf): boolean | null => {
  const trun = child(b, traf, "trun")
  let flags: number | null = null
  if (fits(trun, 8)) {
    const f = u32(b, trun.start) & 0xffffff
    const p = trun.start + 8 + (f & 1 ? 4 : 0)
    if (f & 4) flags = u32(b, p)
    else if (f & 0x400) flags = u32(b, p + (f & 0x100 ? 4 : 0) + (f & 0x200 ? 4 : 0))
  }
  if (flags === null) {
    const f = u32(b, tfhd.start) & 0xffffff
    if (f & 0x20) {
      const p =
        tfhd.start + 8 + (f & 1 ? 8 : 0) + (f & 2 ? 4 : 0) + (f & 8 ? 4 : 0) + (f & 0x10 ? 4 : 0)
      flags = u32(b, p)
    }
  }
  return flags === null ? null : !(flags & 0x10000)
}

// Instante (s) de decodificación del primer fotograma de vídeo: tfdt del primer moof que lleve la pista de vídeo.
export const fmp4FirstVideoTime = (segment: Bytes, track: VideoTrack): number | null => {
  for (const moof of boxes(segment)) {
    if (moof.type !== "moof") continue
    const video = videoTraf(segment, moof, track)
    if (video !== null) return trafTime(segment, video, track)
  }
  return null
}

// Recorta un trozo fMP4 en el bloque moof cuyo vídeo arranca en fromTime (±20 ms) con una muestra independiente.
// Delante se conservan las cajas anteriores al primer moof salvo sidx (describiría datos quitados).
export const trimFmp4 = (bytes: Bytes, track: VideoTrack, fromTime: number): Bytes | null => {
  const top = [...boxes(bytes)]
  const firstMoof = top.findIndex((box) => box.type === "moof")
  for (const [k, moof] of top.entries()) {
    if (moof.type !== "moof") continue
    const video = videoTraf(bytes, moof, track)
    const time = video === null ? null : trafTime(bytes, video, track)
    if (video === null || time === null || time < fromTime - 0.02) continue
    if (time > fromTime + 0.02 || trafFirstSampleSync(bytes, video) !== true) return null
    if (k === firstMoof) return bytes
    const header = top
      .slice(0, firstMoof)
      .filter((box) => box.type !== "sidx")
      .map((box) => bytes.subarray(box.at, box.end))
    const size = header.reduce((sum, part) => sum + part.length, 0)
    const out = new Uint8Array(size + bytes.length - moof.at)
    let p = 0
    for (const part of header) {
      out.set(part, p)
      p += part.length
    }
    out.set(bytes.subarray(moof.at), p)
    return out
  }
  return null
}
