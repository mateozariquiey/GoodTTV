import type { AppApi } from "@goodttv/contratos"
import {
  createPageApi,
  type PageApiOptions,
  pageStorage,
  resolveClientId,
  TWITCH_CHAT_SCOPES,
} from "@goodttv/servicios"
import {
  channelByLogin,
  commentsFrom,
  liveArchive,
  searchChannels,
  storyboardOf,
  videoById,
  videosOf,
  vodMasterUrl,
} from "@goodttv/sin-anuncios"
import { storageText, storageTokens } from "./storage"
import { createWakeLock } from "./wake-lock"

// window.api de la extensión (createPageApi, de @goodttv/servicios): la sesión y los datos en chrome.storage.local,
// Inicio de la última vez en localStorage y la pantalla encendida con la Wake Lock API. lab: la sesión y lo de
// localStorage en otro sitio (la cuenta falsa del laboratorio, twitch-falso.ts).
export const createExtensionApi = (
  lab: Partial<Pick<PageApiOptions, "homeStorage" | "tokens">> = {},
): AppApi =>
  createPageApi({
    // Buscar canales con la relevancia de twitch.tv y sin cuenta, como invitado.
    channels: {
      byLogin: (login) => channelByLogin(login),
      search: (query, first) => searchChannels(query, { first }),
    },
    // Un fork compila con VITE_TWITCH_CLIENT_ID; si no, el del proyecto.
    clientId: resolveClientId(undefined, import.meta.env["VITE_TWITCH_CLIENT_ID"]),
    homeStorage: pageStorage(),
    localData: storageText(chrome.storage.local, "local-data"),
    // También escribe en el chat (CHAT-1, D24).
    scopes: TWITCH_CHAT_SCOPES,
    setWatching: createWakeLock().setWatching,
    tokens: storageTokens(chrome.storage.local, "twitch-token"),
    version: chrome.runtime.getManifest().version,
    // Los VOD (VOD-1), como invitado: la página no está sujeta a CORS con los permisos de la extensión.
    vods: {
      archive: (login) => liveArchive(login),
      comments: (videoId, offset) => commentsFrom(videoId, offset),
      get: (id) => videoById(id),
      list: (login) => videosOf(login),
      playback: (id) => vodMasterUrl(id),
      storyboard: (url) => storyboardOf(url),
    },
    ...lab,
  })
