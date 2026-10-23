import { type SavedHome, SavedHomeSchema } from "@goodttv/contratos"

// Inicio de la última vez en una página (la extensión): window.api.home (page-api.ts) y la plataforma, que lo lee al
// abrir (apps/navegador/src/goodttv.tsx). En localStorage y no en el almacén de la plataforma (chrome.storage.local)
// porque se lee sin esperar, así que sale ya en la primera imagen. Sin tokens: solo lo que se ve (SavedHomeSchema).
const KEY = "inicio"
const VERSION = 1

// localStorage puede lanzar solo con mirarlo (un navegador que lo bloquea): entonces, sin Inicio guardado.
export const pageStorage = (): Storage | undefined => {
  try {
    return localStorage
  } catch {
    return undefined
  }
}

// Otra versión, algo roto o un navegador que no deja usar localStorage: como si no hubiera nada.
export const readSavedHome = (storage: Pick<Storage, "getItem"> | undefined): SavedHome | null => {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? "null")
    if (saved?.version !== VERSION) return null
    const parsed = SavedHomeSchema.safeParse(saved)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const saveHome = (storage: Pick<Storage, "setItem"> | undefined, home: SavedHome) => {
  try {
    storage?.setItem(KEY, JSON.stringify({ ...SavedHomeSchema.parse(home), version: VERSION }))
  } catch {
    // Sin sitio, sin localStorage o algo que no cuadra: la próxima vez se espera a Twitch.
  }
}

export const forgetHome = (storage: Pick<Storage, "removeItem"> | undefined) => {
  try {
    storage?.removeItem(KEY)
  } catch {
    // Igual que al guardar.
  }
}
