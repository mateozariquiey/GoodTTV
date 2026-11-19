import { pageStorage, readStored, removeStored, writeStored } from "../page-storage"

// Calidad elegida a mano (null: automática, la mejor que dé el canal). Se queda hasta que se elija otra: el canal
// siguiente se pide con ella, también tras retroceder al VOD y volver al directo (otro reproductor) o abrirlo desde
// Inicio, y se precalienta con ella. Como el volumen (volume.ts) y en twitch.tv, se guarda en el localStorage de la
// página: una pestaña nueva, o GoodTTV al volver a abrirlo, empieza con la última que se eligió. Una pestaña abierta
// sigue con la suya aunque se elija otra en otra.
const QUALITY_KEY = "calidad-directo"
const QUALITY_ID = /^\d+x\d+@\d+$/ // como la pide el directo: resolución@fps

let chosenQuality: string | null | undefined // la de esta pestaña; undefined hasta leerla

export const chosenLiveQuality = (storage = pageStorage()): string | null => {
  if (chosenQuality === undefined) {
    const saved = readStored(QUALITY_KEY, storage)
    chosenQuality = saved !== null && QUALITY_ID.test(saved) ? saved : null
  }
  return chosenQuality
}

// Sin sitio, vale para esta pestaña.
export const chooseQuality = (quality: string | null, storage = pageStorage()): void => {
  chosenQuality = quality
  if (quality === null) removeStored(QUALITY_KEY, storage)
  else writeStored(QUALITY_KEY, quality, storage)
}
