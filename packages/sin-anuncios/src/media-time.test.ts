import { describe, expect, it } from "vitest"
import {
  firstVideoPts,
  fmp4FirstVideoTime,
  fmp4VideoTrack,
  PTS_WRAP,
  trimFmp4,
  trimTs,
  unwrap,
} from "./media-time"

// --- TS sintético: PAT (PMT en 0x1000), PMT, PES de vídeo con PTS y una NAL, y un PES de audio. ---
const packet = (pid: number, start: boolean, payload: readonly number[] = []): Uint8Array => {
  const p = new Uint8Array(188).fill(0xff)
  p.set([0x47, (start ? 0x40 : 0) | (pid >> 8), pid & 0xff, 0x10, ...payload])
  return p
}
// nal: 0x65 = IDR (fotograma independiente); 0x67 = solo SPS, que no lo demuestra.
const pes = (pts: number, nal: number): number[] => {
  const v = Math.round(pts * 90_000)
  return [
    0,
    0,
    1,
    0xe0,
    0,
    0,
    0x80,
    0x80,
    5,
    0x21 | ((Math.floor(v / 2 ** 30) & 7) << 1),
    (v >> 22) & 0xff,
    ((v >> 14) & 0xfe) | 1,
    (v >> 7) & 0xff,
    ((v << 1) & 0xfe) | 1,
    0,
    0,
    0,
    1,
    0x09,
    0xf0,
    0,
    0,
    0,
    1,
    nal,
  ]
}
const PAT = [0, 0, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xf0, 0x00, 0, 0, 0, 0]
const stream = (nal: number): Uint8Array => {
  const parts = [
    packet(0, true, PAT),
    packet(0x1000, true, [0]),
    packet(0x101, true),
    packet(0x100, true, pes(10, 0x65)),
    packet(0x100, false),
    packet(0x101, true),
    packet(0x100, true, pes(14.167, nal)),
    packet(0x100, false),
    packet(0x100, true, pes(18.333, 0x65)),
  ]
  const ts = new Uint8Array(parts.length * 188)
  for (const [i, part] of parts.entries()) ts.set(part, i * 188)
  return ts
}
const pids = (bytes: Uint8Array): number[] =>
  Array.from(
    { length: bytes.length / 188 },
    (_, k) => (((bytes[k * 188 + 1] ?? 0) & 0x1f) << 8) | (bytes[k * 188 + 2] ?? 0),
  )

describe("MPEG-TS", () => {
  it("lee el PTS del primer PES de vídeo", () => {
    expect(firstVideoPts(stream(0x65))).toBeCloseTo(10, 3)
  })

  it("recorta en el fotograma IDR del borde y deja delante solo PAT y PMT", () => {
    const cut = trimTs(stream(0x65), 14.167)
    expect(cut).not.toBeNull()
    expect(firstVideoPts(cut ?? new Uint8Array())).toBeCloseTo(14.167, 3)
    expect(pids(cut ?? new Uint8Array()).slice(0, 3)).toEqual([0, 0x1000, 0x100])
  })

  it("no acepta un SPS sin IDR como fotograma clave", () => {
    expect(trimTs(stream(0x67), 14.167)).toBeNull()
  })

  it("no vale un fotograma posterior al borde pedido", () => {
    expect(trimTs(stream(0x65), 12)).toBeNull()
  })

  it("ajusta el PTS cuando da la vuelta (~26,5 h)", () => {
    expect(unwrap(3, PTS_WRAP - 5)).toBeCloseTo(PTS_WRAP + 3, 9)
    expect(unwrap(1000, 1003)).toBe(1000)
  })
})

// --- fMP4 sintético ---
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const box = (type: string, ...parts: (readonly number[])[]): number[] => {
  const body = parts.flat()
  return [...u32(8 + body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body]
}
const track = (id: number, handler: string, timescale: number): number[] =>
  box(
    "trak",
    box("tkhd", u32(0), u32(0), u32(0), u32(id)),
    box(
      "mdia",
      box("mdhd", u32(0), u32(0), u32(0), u32(timescale)),
      box(
        "hdlr",
        u32(0),
        u32(0),
        [...handler].map((c) => c.charCodeAt(0)),
      ),
    ),
  )
const init = new Uint8Array(box("moov", track(2, "soun", 48_000), track(1, "vide", 90_000)))
const traf = (id: number, time: number, sync: boolean): number[] =>
  box(
    "traf",
    box("tfhd", u32(0), u32(id)),
    box("tfdt", [1, 0, 0, 0], u32(Math.floor(time / 2 ** 32)), u32(time % 2 ** 32)),
    box("trun", [0, 0, 0, 4], u32(1), u32(sync ? 0x02000000 : 0x01010000)),
  )
const chunk = (seconds: number, sync = false): number[] => [
  ...box(
    "moof",
    box("mfhd", u32(0), u32(1)),
    traf(2, 48_000 * 99, true),
    traf(1, Math.round(90_000 * seconds), sync),
  ),
  ...box("mdat", [1]),
]

describe("fMP4", () => {
  const video = fmp4VideoTrack(init)

  it("encuentra la pista de vídeo y su escala (no la de audio)", () => {
    expect(video).toEqual({ id: 1, timescale: 90_000 })
  })

  it("lee el tiempo del primer fotograma de vídeo", () => {
    if (video === null) throw new Error("sin pista")
    expect(fmp4FirstVideoTime(new Uint8Array(chunk(1234.5)), video)).toBe(1234.5)
  })

  it("recorta en el bloque independiente del borde, conserva emsg y quita sidx", () => {
    if (video === null) throw new Error("sin pista")
    const bytes = new Uint8Array([
      ...box("emsg", [1, 2, 3]),
      ...box("sidx", [0, 0, 0, 0]),
      ...chunk(10, true),
      ...chunk(10.1),
      ...chunk(12, true),
      ...chunk(12.1),
    ])
    const cut = trimFmp4(bytes, video, 12)
    expect(cut).not.toBeNull()
    expect(fmp4FirstVideoTime(cut ?? new Uint8Array(), video)).toBe(12)
    expect(String.fromCharCode(...(cut ?? new Uint8Array()).subarray(4, 8))).toBe("emsg")
    expect(String.fromCharCode(...(cut ?? new Uint8Array()))).not.toContain("sidx")
    expect(trimFmp4(bytes, video, 11)).toBeNull()
    expect(trimFmp4(bytes, video, 12.1)).toBeNull() // bloque no independiente
  })

  it("no se rompe con una caja de 64 bits cortada", () => {
    if (video === null) throw new Error("sin pista")
    const truncated = new Uint8Array([
      0,
      0,
      0,
      1,
      ..."moof".split("").map((c) => c.charCodeAt(0)),
      0,
      0,
    ])
    expect(fmp4FirstVideoTime(truncated, video)).toBeNull()
  })
})
