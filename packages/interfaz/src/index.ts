/// <reference path="./global.d.ts" />
// Lo común de la interfaz de GoodTTV (docs/arquitectura.md): datos, reproductor, chat, idioma y direcciones. Cada
// versión define window.api (AppApi, @goodttv/contratos) y monta sus propias pantallas con estas piezas: las de la TV,
// con su navegación por mando, están en apps/tv/src/renderer/src.
export {
  avatarAt,
  type Channel,
  fromRecent,
  fromSearch,
  fromStream,
  initials,
  previewAt,
  toRecent,
} from "./channel"
export { useChannelDetails, useFollowing, useRecentChannel } from "./channel-details"
export {
  type ChannelSearch,
  channelSearchDetail,
  typedChannel,
  useChannelSearch,
} from "./channel-search"
export {
  type AuthState,
  formatUptime,
  formatViewers,
  type Home,
  type HomeData,
  type HomeSketch,
  type Resource,
  searchChannels,
  useAppStatus,
  useAuth,
  useGuestPopular,
  useHome,
  usePreferences,
  useRefreshWhileVisible,
  useResource,
} from "./data"
export {
  channelToShow,
  type HomeChannels,
  lineupOf,
  useHomeChannels,
  useRefreshOnReturnHome,
} from "./home-channels"
export {
  activarIdioma,
  type Clave,
  elegirIdioma,
  type Idioma,
  type IdiomaElegido,
  idiomaActual,
  idiomaElegido,
  t,
  tMensaje,
  useIdioma,
} from "./idioma"
export { LATENCY_MODES, LATENCY_ORDER } from "./latency-modes"
export {
  archiveMoment,
  type LiveBar,
  type LiveRewind,
  liveBar,
  useLiveArchive,
} from "./live-archive"
export { pageStorage, readStored, removeStored, writeStored } from "./page-storage"
export { usePageVisible } from "./page-visible"
export { type Platform, PlatformContext } from "./platform"
export { chatDelayOf, TWITCH_VIEWER_LATENCY, useBehind } from "./player/behind"
export { CHAT_STATUS_TEXT, ChatPanel, Message } from "./player/ChatPanel"
export {
  emoteThumb,
  insertAt,
  NO_EMOTES,
  replaceWord,
  suggestEmotes,
  wordAt,
} from "./player/emote-complete"
export {
  type ChatEmoteInfo,
  chatEmoteDetails,
  chatEmoteOf,
  EMOTE_PROVIDER,
  type EmoteSection,
  emoteSections,
  useLazyEmoteImages,
} from "./player/emote-list"
export { chosenLiveQuality } from "./player/live-quality"
export { useOpeningPrewarm } from "./player/opening-prewarm"
export { prewarmStream, usePrewarm } from "./player/prewarm"
export { type ChatView, useChat } from "./player/useChat"
export { useChatAtBottom } from "./player/useChatAtBottom"
export { useChatCompose } from "./player/useChatCompose"
export { useChatEmotes } from "./player/useChatEmotes"
export { type PlayerPhase, type PlayerState, useHlsPlayer } from "./player/useHlsPlayer"
export { useReplayChat } from "./player/useReplayChat"
export { chooseVolume, chosenVolume, type Volume } from "./player/volume"
export {
  type CommonRoute,
  commonRouteHash,
  LOGIN_PATTERN,
  parseCommonRoute,
  routeParts,
  useHash,
} from "./routes"
export {
  prefetchedVodMaster,
  prefetchVod,
  prefetchVodMaster,
  renewVod,
  VOD_WARM_MS,
  type VodMaster,
  vodDetail,
  vodPlayback,
} from "./vod-cache"
export {
  useChannelVods,
  useStoryboard,
  useUnfinishedVods,
  useVodDetail,
  type VodListLoad,
  type VodLoad,
} from "./vod-data"
export { formatAgo, formatClock } from "./vod-format"
export {
  isSeen,
  resumeAt,
  saveVodProgress,
  unfinishedVods,
  vodProgress,
  vodTileProgress,
} from "./vod-progress"
export {
  addWatchMinute,
  type FollowedOrder,
  sortFollowed,
  useFollowedOrder,
  useWatchTime,
} from "./watch-time"
