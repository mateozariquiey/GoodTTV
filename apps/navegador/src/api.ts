import { type AppApi, type ChatBatch, ChatOpenInputSchema } from "@goodttv/contratos"
import {
  EmoteCatalog,
  EventSubChat,
  LocalStore,
  resolveClientId,
  type SettingsSource,
  TwitchService,
} from "@goodttv/servicios"
import { storageText, storageTokens } from "./storage"
import { createWakeLock } from "./wake-lock"

// window.api de la extensión: lo mismo que en la tele hacen el proceso principal y su IPC (apps/tele/src/main/ipc.ts),
// pero en la propia página, que es privilegiada (sin código ajeno, por la CSP de Manifest V3). Los tokens se quedan
// en los servicios; la interfaz solo recibe datos.
export const createExtensionApi = (): AppApi => {
  const settings: SettingsSource = {
    // Un fork compila con VITE_TWITCH_CLIENT_ID; si no, el del proyecto.
    load: async () => ({
      clientId: resolveClientId(undefined, import.meta.env["VITE_TWITCH_CLIENT_ID"]),
    }),
  }
  const twitch = new TwitchService(settings, storageTokens(chrome.storage.local, "twitch-token"))
  const emotes = new EmoteCatalog()
  const batches = new Set<(batch: ChatBatch) => void>()
  const chat = new EventSubChat({
    api: {
      badges: (broadcasterId) => twitch.badges(broadcasterId),
      emotes: (broadcasterId) => emotes.forChannel(broadcasterId),
      subscribe: (type, broadcasterId, userId, sessionId) =>
        twitch.createChatSubscription(type, broadcasterId, userId, sessionId),
      unsubscribe: (subscriptionId) => twitch.deleteSubscription(subscriptionId),
      viewer: () => twitch.viewer(),
    },
    emit: (batch) => {
      for (const listener of batches) listener(batch)
    },
  })
  const local = new LocalStore(storageText(chrome.storage.local, "local-data"))
  const wakeLock = createWakeLock()

  return {
    app: {
      // videoDecode vacío: el navegador no lo dice (Ajustes no muestra la línea).
      status: async () => ({
        ...twitch.status(),
        version: chrome.runtime.getManifest().version,
        videoDecode: "",
      }),
    },
    auth: {
      begin: () => twitch.beginAuthorization(),
      logout: async () => {
        chat.close()
        await twitch.logout()
      },
      snapshot: () => twitch.authSnapshot(),
    },
    catalog: {
      followed: (input) => twitch.followed(input),
      live: (input) => twitch.live(input),
      search: (input) => twitch.search(input),
      streamsByLogin: (logins) => twitch.streamsByLogin(logins),
    },
    chat: {
      close: async () => chat.close(),
      onBatch: (listener) => {
        batches.add(listener)
        return () => {
          batches.delete(listener)
        }
      },
      // Como el IPC de la tele: un identificador que no sea válido no llega a tocar el chat.
      open: async (input) => chat.open(ChatOpenInputSchema.parse(input).broadcasterId),
    },
    // Sin mando: las pantallas de escritorio atienden el teclado ellas mismas (escritorio/shortcuts.ts).
    input: {
      onAction: () => () => undefined,
      onProbe: () => () => undefined,
      setProbing: async () => undefined,
      setTextEntry: async () => undefined,
    },
    player: {
      beginInteraction: () =>
        Promise.reject(new Error("Sin reproductor de Twitch en la extensión")),
      endInteraction: async () => undefined,
      onInteractionEnded: () => () => undefined,
      setWatching: wakeLock.setWatching,
    },
    preferences: {
      get: () => local.preferences(),
      update: (patch) => local.updatePreferences(patch),
    },
    recents: {
      add: (channel) => local.addRecent(channel),
      list: () => local.recents(),
    },
  }
}
