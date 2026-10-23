// window.api de Android (createPageApi, de @goodttv/servicios), como el de la extensión: la cuenta, Helix y el chat
// corren en la página, y lo que no puede pedir a Twitch desde su origen sale por la red nativa (red-nativa.ts). Lo propio
// de Android lo da la app por el puente de MainActivity.kt:
//   - la sesión de Twitch, cifrada con el Keystore (Sesion.kt);
//   - la versión y que la pantalla no se apague mientras se ve un directo.
// Las preferencias, los recientes e Inicio de la última vez, en el localStorage de la WebView.
import type { AppApi } from "@goodttv/contratos"
import {
  createPageApi,
  pageStorage,
  resolveClientId,
  StoredTokenSchema,
  type TextStorage,
  type TokenStore,
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

// Lo que expone MainActivity.kt a la página (addJavascriptInterface). Las llamadas son síncronas, y un null de Kotlin
// llega como undefined. El vídeo del canal o del VOD (Media3: canal…, vod…) contesta con el evento «goodttv-reproductor»
// (media3.ts). La pausa, la esquina y la pantalla completa valen para los dos.
export type Android = {
  mantenerPantalla(activa: boolean): void
  canalAbrir(canal: string, modo: string): void
  canalMinimizar(): void
  canalPantallaCompleta(activa: boolean): void
  canalReintentar(): void
  canalPausar(pausa: boolean): void
  canalSaltar(segundos: number): void
  canalAlDirecto(): void
  canalPrecalentar(canal: string, modo: string): void
  vodPreparar(id: string): boolean
  vodAbrir(id: string, lista: string, desde: number): void
  vodIrA(segundos: number): void
  vodVelocidad(valor: number): void
  vodCalidad(nombre: string): void
  reproductorDatos(clave: string, titulo: string, texto: string, foto: string): void
  videoZona(x: number, y: number, ancho: number, alto: number): void
  barraZona(x: number, y: number, ancho: number, alto: number): void
  sesionLeer(): string | undefined
  sesionGuardar(texto: string): void
  sesionBorrar(): void
  version(): string
  copiar(texto: string): void
}

// El puente con la app: sin ella, la página no funciona.
const puente = (globalThis as { GoodTTVAndroid?: Android }).GoodTTVAndroid
if (puente === undefined) throw new Error("GoodTTV necesita la app de Android (MainActivity)")
export const android: Android = puente

// Lo que no se pueda leer o no tenga la forma de una sesión cuenta como no haberla iniciado.
const sesion = (android: Android): TokenStore => ({
  clear: async () => android.sesionBorrar(),
  isSecure: true,
  load: async () => {
    const texto = android.sesionLeer()
    if (texto === undefined) return undefined
    try {
      const token = StoredTokenSchema.safeParse(JSON.parse(texto))
      return token.success ? token.data : undefined
    } catch {
      return undefined
    }
  },
  save: async (token) => android.sesionGuardar(JSON.stringify(StoredTokenSchema.parse(token))),
})

const localData = (storage: Storage | undefined, key: string): TextStorage => ({
  read: async () => storage?.getItem(key) ?? undefined,
  write: async (text) => storage?.setItem(key, text),
})

export const createAndroidApi = (android: Android): AppApi => {
  const storage = pageStorage()
  return createPageApi({
    // Buscar canales con la relevancia de twitch.tv y sin cuenta, como invitado y por la red nativa, como la extensión.
    channels: {
      byLogin: (login) => channelByLogin(login),
      search: (query, first) => searchChannels(query, { first }),
    },
    // Un fork compila con VITE_TWITCH_CLIENT_ID; si no, el del proyecto.
    clientId: resolveClientId(undefined, import.meta.env["VITE_TWITCH_CLIENT_ID"]),
    homeStorage: storage,
    localData: localData(storage, "datos-locales"),
    // También escribe en el chat (CHAT-1, D24).
    scopes: TWITCH_CHAT_SCOPES,
    setWatching: async (watching) => android.mantenerPantalla(watching),
    tokens: sesion(android),
    version: android.version(),
    // Los VOD (VOD-1), como invitado y por la red nativa (red-nativa.ts).
    vods: {
      archive: (login) => liveArchive(login),
      comments: (videoId, offset) => commentsFrom(videoId, offset),
      get: (id) => videoById(id),
      list: (login) => videosOf(login),
      playback: (id) => vodMasterUrl(id),
      storyboard: (url) => storyboardOf(url),
    },
  })
}
