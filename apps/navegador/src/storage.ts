import { StoredTokenSchema, type TextStorage, type TokenStore } from "@goodttv/servicios"

// Lo que la extensión guarda va en chrome.storage.local, dentro del perfil del navegador y sin cifrar (Ajustes lo
// avisa, como la tele cuando no hay llavero del sistema).
type Area = Pick<chrome.storage.StorageArea, "get" | "remove" | "set">

export const storageText = (area: Area, key: string): TextStorage => ({
  read: async () => {
    const value = (await area.get(key))[key]
    return typeof value === "string" ? value : undefined
  },
  write: (text) => area.set({ [key]: text }),
})

export const storageTokens = (area: Area, key: string): TokenStore => ({
  clear: () => area.remove(key),
  isSecure: false,
  load: async () => {
    const value = (await area.get(key))[key]
    return value === undefined ? undefined : StoredTokenSchema.parse(value)
  },
  save: async (token) => area.set({ [key]: StoredTokenSchema.parse(token) }),
})
