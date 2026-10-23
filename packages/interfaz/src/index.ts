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
  type AuthState,
  formatUptime,
  formatViewers,
  type Home,
  type HomeData,
  type HomeSketch,
  loadHome,
  type Resource,
  SAVED_HOME_FRESH_MS,
  searchChannels,
  useAppStatus,
  useAuth,
  useHome,
  usePreferences,
  useResource,
} from "./data"
export { type Platform, PlatformContext, TV_PLATFORM } from "./platform"
export { CHAT_STATUS_TEXT, Message } from "./player/ChatPanel"
export {
  emoteThumb,
  insertAt,
  NO_EMOTES,
  replaceWord,
  SUGGESTIONS_MAX,
  suggestEmotes,
  type Word,
  wordAt,
} from "./player/emote-complete"
export { type ChatView, useChat } from "./player/useChat"
export { useChatAtBottom } from "./player/useChatAtBottom"
export { useChatCompose } from "./player/useChatCompose"
export { useChatEmotes } from "./player/useChatEmotes"
export {
  prewarmStream,
  TWITCH_VIEWER_LATENCY,
  useBehind,
  useHlsPlayer,
  usePrewarm,
} from "./player/useHlsPlayer"
export { useReplayChat } from "./player/useReplayChat"
export type { PlayerPhase, PlayerState } from "./player/useTwitchPlayer"
export { LATENCY_MODES, LATENCY_ORDER } from "./screens/AccountScreen"
export { prefetchVod, renewVod, VOD_WARM_MS, vodDetail, vodPlayback } from "./vod-cache"
export { formatAgo, formatClock } from "./vod-format"
export {
  forgetVodProgress,
  isSeen,
  resumeAt,
  saveVodProgress,
  unfinishedVods,
  type VodProgress,
  vodProgress,
} from "./vod-progress"
export {
  addWatchMinute,
  type FollowedOrder,
  sortFollowed,
  useFollowedOrder,
  useWatchTime,
} from "./watch-time"
