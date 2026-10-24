// Listas HLS de Twitch: la maestra (variantes y emisión) y la de medios (fragmentos, prefetch y anuncios).

// Atributos «CLAVE=valor» de una etiqueta HLS (con o sin comillas).
export const attrs = (text: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    [...text.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map(([, key = "", value = ""]) => [
      key,
      value.replace(/^"|"$/g, ""),
    ]),
  )

export type Variant = {
  readonly bandwidth: number
  readonly fps: number
  readonly name: string
  readonly resolution: string
  readonly url: string
}

export type Want = { readonly fps: number; readonly resolution: string }

// Solo audio (VIDEO="audio_only" en la lista maestra, sin resolución): lo que pide Android con la pantalla apagada, unos
// 160 kbit/s en vez de varios Mbit/s. Se pide como las demás, «audio_only@0».
export const AUDIO_ONLY = "audio_only"
export const AUDIO_ONLY_WANT: Want = { fps: 0, resolution: AUDIO_ONLY }

// Variantes de vídeo de la lista maestra (sin «solo audio»), de más a menos ancho de banda.
export const listVariants = (master: string): readonly Variant[] => {
  const names = new Map<string, string>()
  const variants: Variant[] = []
  let pending: Readonly<Record<string, string>> | null = null
  for (const line of master.split("\n")) {
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const media = attrs(line.slice(13))
      if (media["GROUP-ID"] !== undefined && media["NAME"] !== undefined) {
        names.set(media["GROUP-ID"], media["NAME"])
      }
    } else if (line.startsWith("#EXT-X-STREAM-INF:")) pending = attrs(line.slice(18))
    else if (pending !== null && line !== "" && !line.startsWith("#")) {
      const resolution = pending["RESOLUTION"]
      if (resolution !== undefined) {
        variants.push({
          bandwidth: Number(pending["BANDWIDTH"] ?? 0),
          fps: Math.round(Number(pending["FRAME-RATE"] ?? 30)),
          name: names.get(pending["VIDEO"] ?? "") ?? resolution,
          resolution,
          url: line.trim(),
        })
      }
      pending = null
    }
  }
  return variants.sort((a, b) => b.bandwidth - a.bandwidth)
}

const heightOf = (resolution: string): number => Number(resolution.split("x")[1] ?? 0)

// La variante de solo audio de la lista maestra, si la trae.
const audioOnlyVariant = (master: string): Variant | undefined => {
  let pending: Readonly<Record<string, string>> | null = null
  for (const line of master.split("\n")) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) pending = attrs(line.slice(18))
    else if (pending !== null && line !== "" && !line.startsWith("#")) {
      if (pending["RESOLUTION"] === undefined && pending["VIDEO"] === AUDIO_ONLY) {
        return {
          bandwidth: Number(pending["BANDWIDTH"] ?? 0),
          fps: 0,
          name: AUDIO_ONLY,
          resolution: AUDIO_ONLY,
          url: line.trim(),
        }
      }
      pending = null
    }
  }
  return undefined
}

// La variante pedida. Si el canal no la tiene (se eligió en otro canal), la misma resolución con otros fotogramas por
// segundo o, si no, la mejor que no pase de esa resolución: no gasta más de lo que se eligió. Sin nada de eso, o sin
// calidad pedida, la de más ancho de banda. Todas las sesiones eligen así la misma.
export const pickVariant = (master: string, want: Want | null): Variant | undefined => {
  const variants = listVariants(master)
  if (want === null) return variants[0]
  // Solo audio; si el canal no lo da, el vídeo que menos gasta.
  if (want.resolution === AUDIO_ONLY) return audioOnlyVariant(master) ?? variants.at(-1)
  return (
    variants.find((v) => v.resolution === want.resolution && v.fps === want.fps) ??
    variants.find((v) => v.resolution === want.resolution) ??
    variants.find((v) => heightOf(v.resolution) <= heightOf(want.resolution)) ??
    variants[0]
  )
}

// BROADCAST-ID identifica la emisión: cambia si el canal termina y vuelve a emitir.
export const broadcastIdOf = (master: string): string | null => {
  const info = master.split("\n").find((line) => line.startsWith("#EXT-X-TWITCH-INFO:"))
  return info === undefined ? null : (attrs(info.slice(19))["BROADCAST-ID"] ?? null)
}

export type MediaSegment = {
  ad: boolean
  readonly duration: number
  readonly map: string | null
  readonly pdt: string | null
  readonly prefetch: boolean
  readonly seq: number
  readonly title: string
  readonly url: string
}

export type MediaPlaylist = {
  readonly liveSequence: number | null
  readonly segments: readonly MediaSegment[]
}

// Lista de medios. Con prefetch, los #EXT-X-TWITCH-PREFETCH (baja latencia) se añaden al final como fragmentos.
// Anuncio: título distinto de "live" (Twitch pone "Amazon|…") o fecha dentro de un DATERANGE twitch-stitched-ad.
// Un prefetch es anuncio si hay una discontinuidad tras el último fragmento normal (Twitch la pone justo antes del
// anuncio) o si el anterior ya lo era, como en Streamlink. liveSequence: #EXT-X-TWITCH-LIVE-SEQUENCE, la numeración
// común del primer fragmento en directo de la lista.
export const parseMedia = (text: string, prefetch = false): MediaPlaylist => {
  const segments: MediaSegment[] = []
  const adRanges: (readonly [number, number])[] = []
  let seq = 0
  let duration = 0
  let title = ""
  let pdt: string | null = null
  let map: string | null = null
  let discontinuity = false
  let liveSequence: number | null = null
  for (const line of text.split("\n")) {
    if (prefetch && line.startsWith("#EXT-X-TWITCH-PREFETCH:")) {
      const last = segments.at(-1)
      const guess =
        last?.pdt == null
          ? null
          : new Date(Date.parse(last.pdt) + last.duration * 1000).toISOString()
      segments.push({
        ad: discontinuity || last?.ad === true,
        duration: last?.duration ?? 2,
        map,
        pdt: guess,
        prefetch: true,
        seq,
        title: "",
        url: line.slice(23).trim(),
      })
      seq++
      continue
    }
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) seq = Number(line.slice(22))
    else if (line.startsWith("#EXT-X-TWITCH-LIVE-SEQUENCE:")) liveSequence = Number(line.slice(28))
    else if (line.startsWith("#EXT-X-MAP:")) map = attrs(line.slice(11))["URI"] ?? null
    else if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) pdt = line.slice(25).trim()
    else if (
      line.startsWith("#EXT-X-DISCONTINUITY") &&
      !line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE")
    ) {
      discontinuity = true
    } else if (line.startsWith("#EXT-X-DATERANGE:")) {
      const range = attrs(line.slice(17))
      if (range["CLASS"] === "twitch-stitched-ad" || range["ID"]?.startsWith("stitched-ad-")) {
        const start = Date.parse(range["START-DATE"] ?? "")
        adRanges.push([start, start + Number(range["DURATION"] ?? 0) * 1000])
      }
    } else if (line.startsWith("#EXTINF:")) {
      const value = line.slice(8)
      const comma = value.indexOf(",")
      duration = Number(value.slice(0, comma))
      title = value.slice(comma + 1).trim()
    } else if (line !== "" && !line.startsWith("#")) {
      segments.push({
        ad: title !== "" && title !== "live",
        duration,
        map,
        pdt,
        prefetch: false,
        seq,
        title,
        url: line.trim(),
      })
      seq++
      title = ""
      pdt = null
      discontinuity = false
    }
  }
  // Los DATERANGE pueden venir después de los fragmentos que cubren: se aplican al final.
  for (const segment of segments) {
    const date = segment.pdt === null ? Number.NaN : Date.parse(segment.pdt)
    if (adRanges.some(([start, end]) => date >= start && date < end)) segment.ad = true
  }
  return { liveSequence, segments }
}
