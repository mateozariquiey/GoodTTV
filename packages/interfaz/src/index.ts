/// <reference path="./global.d.ts" />
// La interfaz de GoodTTV (docs/arquitectura.md). Cada versión define window.api (AppApi, @goodttv/contratos) antes
// de montar App, e importa las fuentes y "@goodttv/interfaz/styles.css". La versión de escritorio de la extensión no
// usa App: monta sus propias pantallas con las piezas de abajo (reproductor, chat, datos).
export { App } from "./App"
export {
  type Channel,
  fromRecent,
  fromSearch,
  fromStream,
  initials,
  previewAt,
  toRecent,
} from "./channel"
export {
  formatUptime,
  formatViewers,
  type Home,
  type HomeData,
  loadHome,
  type Resource,
  searchChannels,
  useAppStatus,
  useAuth,
  useHome,
  usePreferences,
  useResource,
} from "./data"
export { type Platform, PlatformContext, TV_PLATFORM } from "./platform"
export { CHAT_STATUS_TEXT, Message } from "./player/ChatPanel"
export { type ChatView, useChat } from "./player/useChat"
export { useChatAtBottom } from "./player/useChatAtBottom"
export {
  prewarmStream,
  TWITCH_VIEWER_LATENCY,
  useBehind,
  useHlsPlayer,
  usePrewarm,
} from "./player/useHlsPlayer"
export type { PlayerPhase, PlayerState } from "./player/useTwitchPlayer"
export { LATENCY_MODES, LATENCY_ORDER } from "./screens/AccountScreen"
