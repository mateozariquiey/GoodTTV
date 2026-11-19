import { pageStorage, readStored, writeStored } from "../page-storage"

// El volumen y el silencio que elige la persona: un reproductor nuevo empieza con ellos. En la extensión, el directo y
// su VOD son pantallas distintas, cada una con su <video>, y al retroceder al VOD o volver con «Ir al directo» el
// volumen subía al máximo.
// Cuenta lo que elige la persona (toggleMuted y setVolume de los reproductores).
// Como en twitch.tv, se guarda en el localStorage de la página: una pestaña nueva, o GoodTTV al volver a abrirlo,
// empieza con lo último que se eligió. Una pestaña abierta sigue con lo suyo aunque se elija otro volumen en otra: si
// no, retroceder en ella cambiaría el volumen.
export type Volume = { readonly muted: boolean; readonly volume: number }

const KEY = "volumen"
const DEFAULT: Volume = { muted: false, volume: 1 }

const read = (storage: Storage | undefined): Volume => {
  try {
    const parsed: unknown = JSON.parse(readStored(KEY, storage) ?? "null")
    if (typeof parsed !== "object" || parsed === null) return DEFAULT
    const { muted, volume } = parsed as Record<keyof Volume, unknown>
    return typeof muted === "boolean" && typeof volume === "number" && volume >= 0 && volume <= 1
      ? { muted, volume }
      : DEFAULT
  } catch {
    return DEFAULT
  }
}

let chosen: Volume | undefined // el de esta pestaña

export const chosenVolume = (storage = pageStorage()): Volume => {
  chosen ??= read(storage)
  return chosen
}

// Lo que ha quedado en el <video> tras elegirlo la persona.
export const chooseVolume = (media: Volume, storage = pageStorage()): void => {
  chosen = { muted: media.muted, volume: media.volume }
  writeStored(KEY, JSON.stringify(chosen), storage)
}
