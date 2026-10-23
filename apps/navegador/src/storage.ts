import { StoredTokenSchema, type TextStorage, type TokenStore } from "@goodttv/servicios"

// Lo que la extensión guarda va en chrome.storage.local, dentro del perfil del navegador y sin cifrar (Ajustes lo
// avisa, como la tele cuando no hay llavero del sistema).
type Area = Pick<chrome.storage.StorageArea, "get" | "remove" | "set">

// Varias pestañas comparten lo guardado: lo que lee, cambia y escribe (los recientes, renovar el token) va en un
// bloqueo del navegador común a todas, uno por clave.
const exclusiveFor =
  (key: string) =>
  <Result>(operation: () => Promise<Result>): Promise<Result> =>
    navigator.locks.request(`goodttv-${key}`, operation)

export const storageText = (area: Area, key: string): TextStorage => ({
  exclusive: exclusiveFor(key),
  read: async () => {
    const value = (await area.get(key))[key]
    return typeof value === "string" ? value : undefined
  },
  write: (text) => area.set({ [key]: text }),
})

export const storageTokens = (area: Area, key: string): TokenStore => ({
  clear: () => area.remove(key),
  exclusive: exclusiveFor(key),
  isSecure: false,
  load: async () => {
    const value = (await area.get(key))[key]
    return value === undefined ? undefined : StoredTokenSchema.parse(value)
  },
  save: async (token) => area.set({ [key]: StoredTokenSchema.parse(token) }),
})
