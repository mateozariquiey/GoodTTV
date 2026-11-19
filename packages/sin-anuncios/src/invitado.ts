import {
  categoryStreams,
  channelByLogin,
  popularStreams,
  searchChannels,
  topCategories,
} from "./canales"
import { commentsFrom, liveArchive, storyboardOf, videoById, videosOf, vodMasterUrl } from "./vods"

// Lo que cada app pide a Twitch como invitada, con la forma que esperan los servicios (ChannelSource y VodSource, en
// @goodttv/servicios, que no depende de este paquete): la extensión y Android se los dan a createPageApi; la TV, los
// canales a guestCatalog en su proceso principal. Cada uno pide por la red que tenga el fetch global de quien lo usa (en
// Android, la red nativa; en la extensión, sin CORS por sus permisos).

// Buscar canales con la relevancia de twitch.tv, un canal por su nombre, los directos más vistos y el directorio (D49).
export const guestChannels = {
  byLogin: (login: string) => channelByLogin(login),
  categories: () => topCategories(),
  category: (slug: string) => categoryStreams(slug),
  popular: (language: string) => popularStreams({ language }),
  search: (query: string, first: number) => searchChannels(query, { first }),
}

// Los VOD (VOD-1): los de un canal, uno por su id, su lista maestra, las miniaturas de la barra, el chat del vídeo y el
// VOD que graba la emisión en curso (DVR-1).
export const guestVods = {
  archive: (login: string) => liveArchive(login),
  comments: (videoId: string, offset: number) => commentsFrom(videoId, offset),
  get: (id: string) => videoById(id),
  list: (login: string) => videosOf(login),
  playback: (id: string) => vodMasterUrl(id),
  storyboard: (url: string) => storyboardOf(url),
}
