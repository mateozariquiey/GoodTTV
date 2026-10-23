import {
  type AppApi,
  type ChannelCard,
  type ChatBadge,
  type ChatBatch,
  ChatOpenInputSchema,
  ChatSendInputSchema,
  type ChatSendResult,
  type LiveArchive,
  type ReplayMessage,
  SearchInputSchema,
  type Storyboard,
  type VideoDetail,
  type VideoList,
} from "@goodttv/contratos"
import { EmoteCatalog } from "./chat/emote-catalog"
import { EventSubChat } from "./chat/eventsub-chat"
import { readableUserColor, tokenizeFragments } from "./chat/tokenize"
import { LocalStore, type TextStorage } from "./local-store"
import { forgetHome, readSavedHome, saveHome } from "./page-home"
import type { PublicSettings, SettingsSource } from "./settings"
import type { TokenStore } from "./tokens"
import { TwitchService } from "./twitch-service"

// Lo que pone cada plataforma: dónde guarda la sesión y sus datos, y lo que solo ella sabe.
export type PageApiOptions = {
  readonly clientId: PublicSettings["clientId"] // resolveClientId (settings.ts)
  readonly tokens: TokenStore
  readonly localData: TextStorage
  // Donde se guardan Inicio de la última vez (page-home.ts) y las fotos de los canales (profile-pictures.ts); undefined si
  // la página no puede usar localStorage.
  readonly homeStorage: Storage | undefined
  readonly version: string
  // Que la pantalla no se apague mientras se ve un directo.
  readonly setWatching: (watching: boolean) => Promise<void>
  // Los permisos que se piden al vincular (TWITCH_CHAT_SCOPES para escribir en el chat); por defecto, solo lectura.
  readonly scopes?: string
  // Los VOD (VOD-1), de @goodttv/sin-anuncios (vods.ts): la página los pide como invitada. Sin ellos, sin VOD.
  readonly vods?: VodSource
  // Buscar canales y ver uno por su nombre como invitada (canales.ts, de @goodttv/sin-anuncios): con la relevancia de
  // twitch.tv y sin cuenta. Sin ellos, la búsqueda de Helix, con cuenta.
  readonly channels?: ChannelSource
}

// Lo que da @goodttv/sin-anuncios de los canales (canales.ts), sin depender de él.
export type ChannelResult = {
  readonly id: string
  readonly login: string
  readonly displayName: string
  readonly avatar: string | null
  readonly followers: number
  readonly title: string
  readonly category: string | null
  readonly viewers: number | null
}
export type ChannelSource = {
  readonly byLogin: (login: string) => Promise<ChannelResult | null>
  readonly search: (query: string, first: number) => Promise<readonly ChannelResult[]>
}

// Twitch siempre da una foto (la de por defecto, si no hay otra); sin ella, la tarjeta no es válida.
const toChannelCard = (result: ChannelResult): ChannelCard | null =>
  result.avatar === null
    ? null
    : {
        category: result.category ?? "",
        displayName: result.displayName,
        followers: result.followers,
        id: result.id,
        isLive: result.viewers !== null,
        login: result.login,
        thumbnailUrl: result.avatar,
        title: result.title,
        ...(result.viewers === null ? {} : { viewerCount: result.viewers }),
      }

// Lo que da @goodttv/sin-anuncios de los VOD, sin depender de él: el chat llega en bruto y aquí se le ponen los
// emotes, las insignias (con cuenta) y el color, como al del directo.
export type ReplayComment = {
  readonly id: string
  readonly offset: number
  readonly userId: string
  readonly login: string
  readonly displayName: string
  readonly color: string | null
  readonly badges: readonly { readonly setId: string; readonly version: string }[]
  readonly fragments: readonly { readonly text: string; readonly emoteId: string | null }[]
}
export type VodSource = {
  readonly archive: (login: string) => Promise<LiveArchive | null>
  readonly comments: (videoId: string, offset: number) => Promise<readonly ReplayComment[]>
  readonly get: (id: string) => Promise<VideoDetail | null>
  readonly list: (login: string) => Promise<VideoList | null>
  readonly playback: (id: string) => Promise<string>
  readonly storyboard: (url: string) => Promise<Storyboard | null>
}

const VIDEO_ID = /^\d{1,20}$/
const STORYBOARD_URL =
  /^https:\/\/[a-z0-9.-]+\.(cloudfront\.net|twitch\.tv|ttvnw\.net|jtvnw\.net)\/[^?#]*\.json$/
const LOGIN = /^[a-z0-9_]{1,25}$/

// window.api en una página privilegiada (la extensión; más adelante, Android): lo mismo que en la tele hacen el
// proceso principal y su IPC (apps/tele/src/main/ipc.ts), pero en la propia página. Los tokens se quedan en los
// servicios; la interfaz solo recibe datos.
export const createPageApi = ({
  channels,
  clientId,
  homeStorage,
  localData,
  scopes,
  setWatching,
  tokens,
  version,
  vods,
}: PageApiOptions): AppApi => {
  const settings: SettingsSource = { load: async () => ({ clientId }) }
  // Las fotos de los canales, en el mismo localStorage que Inicio (profile-pictures.ts).
  const twitch = new TwitchService(settings, tokens, {
    ...(homeStorage === undefined ? {} : { pictures: homeStorage }),
    ...(scopes === undefined ? {} : { scopes }),
  })
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
  const local = new LocalStore(localData)

  return {
    app: {
      // videoDecode vacío: la página no lo sabe (Ajustes no muestra la línea).
      status: async () => ({ ...twitch.status(), version, videoDecode: "" }),
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
      search: async (input) => {
        if (channels === undefined) return twitch.search(input)
        const { first, query } = SearchInputSchema.parse(input)
        const items = (await channels.search(query, first)).flatMap((result) => {
          const card = toChannelCard(result)
          return card === null ? [] : [card]
        })
        return { cursor: undefined, items }
      },
      streamsByLogin: (logins) => twitch.streamsByLogin(logins),
      follows: (broadcasterId) => twitch.follows(broadcasterId),
      ...(channels === undefined
        ? {}
        : {
            channel: async (login: string) => {
              const result = await channels.byLogin(login)
              return result === null ? null : toChannelCard(result)
            },
          }),
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
      // Lo enviado se enseña ya, con sus emotes y el color de la persona; el de EventSub, que llega después (con las
      // insignias), lo sustituye.
      send: async (input): Promise<ChatSendResult> => {
        const { broadcasterId, message } = ChatSendInputSchema.parse(input)
        const sent = await twitch.sendChatMessage(broadcasterId, message)
        if (!sent.sent) return sent
        // Ya está enviado: lo que sigue solo lo adorna, y si falla no puede convertirlo en un fallo (se reenviaría).
        const [color, others, own, account] = await Promise.all([
          twitch.chatColor(sent.userId),
          emotes.forChannel(broadcasterId).catch(() => new Map()),
          // Los de Twitch, ya pedidos al escribir (emotes, abajo): para Twitch mandan sobre los de 7TV, BTTV y FFZ.
          twitch.userEmotes(broadcasterId).catch(() => []),
          twitch.authSnapshot().catch(() => undefined),
        ])
        const lookup = new Map(others)
        for (const emote of own) lookup.set(emote.name, emote)
        return {
          message: {
            action: false,
            badges: [],
            color: readableUserColor(color, sent.userId),
            displayName: (account?.kind === "authenticated"
              ? account.displayName
              : sent.login
            ).slice(0, 60),
            id: sent.id.slice(0, 64),
            tokens: tokenizeFragments([{ text: message, type: "text" }], lookup).slice(0, 600),
            userId: sent.userId,
          },
          sent: true,
        }
      },
      emotes: async (input) => {
        const { broadcasterId } = ChatOpenInputSchema.parse(input)
        const [own, others] = await Promise.all([
          twitch.userEmotes(broadcasterId).catch(() => []),
          emotes.listForChannel(broadcasterId),
        ])
        return { channel: others.channel, global: others.global, twitch: own }
      },
    },
    home: {
      forget: async () => forgetHome(homeStorage),
      save: async (home) => saveHome(homeStorage, home),
      saved: async () => readSavedHome(homeStorage),
    },
    // Sin mando: las pantallas atienden el teclado o el dedo ellas mismas.
    input: {
      onAction: () => () => undefined,
      onProbe: () => () => undefined,
      setProbing: async () => undefined,
      setTextEntry: async () => undefined,
    },
    player: {
      beginInteraction: () =>
        Promise.reject(new Error("Sin el reproductor de Twitch en la página")),
      endInteraction: async () => undefined,
      onInteractionEnded: () => () => undefined,
      setWatching,
    },
    preferences: {
      get: () => local.preferences(),
      update: (patch) => local.updatePreferences(patch),
    },
    recents: {
      add: (channel) => local.addRecent(channel),
      list: () => local.recents(),
    },
    ...(vods === undefined
      ? {}
      : {
          vods: {
            archive: async (login) =>
              LOGIN.test(login.toLowerCase()) ? vods.archive(login) : null,
            comments: async ({ channelId, offset, videoId }): Promise<readonly ReplayMessage[]> => {
              if (!VIDEO_ID.test(videoId) || !VIDEO_ID.test(channelId)) return []
              if (!Number.isFinite(offset) || offset < 0) return []
              const [comments, lookup, badges] = await Promise.all([
                vods.comments(videoId, offset),
                emotes.forChannel(channelId).catch(() => new Map()),
                // Las insignias se piden a Helix: con cuenta.
                twitch.badges(channelId).catch(() => new Map<string, ChatBadge>()),
              ])
              return comments.map((comment) => ({
                action: false,
                badges: comment.badges.flatMap(
                  (badge) => badges.get(`${badge.setId}/${badge.version}`) ?? [],
                ),
                color: readableUserColor(comment.color ?? "", comment.userId),
                displayName: (comment.displayName || comment.login).slice(0, 60),
                id: comment.id.slice(0, 64),
                offset: comment.offset,
                tokens: tokenizeFragments(
                  comment.fragments.map((fragment) =>
                    fragment.emoteId === null
                      ? { text: fragment.text, type: "text" }
                      : { emote: { id: fragment.emoteId }, text: fragment.text, type: "emote" },
                  ),
                  lookup,
                ).slice(0, 600),
                userId: comment.userId.slice(0, 64),
              }))
            },
            get: async (id) => (VIDEO_ID.test(id) ? vods.get(id) : null),
            list: async (login) => (LOGIN.test(login.toLowerCase()) ? vods.list(login) : null),
            playback: async (id) => {
              if (!VIDEO_ID.test(id)) throw new Error("vídeo no válido")
              return vods.playback(id)
            },
            // Solo las miniaturas que da Twitch (seekPreviewsURL), en su CDN.
            storyboard: async (url) => (STORYBOARD_URL.test(url) ? vods.storyboard(url) : null),
          },
        }),
  }
}
