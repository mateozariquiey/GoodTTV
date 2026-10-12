import {
  type AppApi,
  AppStatusSchema,
  AuthSnapshotSchema,
  ChannelCardSchema,
  ChatBatchSchema,
  ChatOpenInputSchema,
  CursorInputSchema,
  DeviceChallengeSchema,
  InputActionSchema,
  KeyProbeSchema,
  LiveInputSchema,
  LoginsInputSchema,
  PageSchema,
  PlayerInteractionEndSchema,
  PreferencesPatchSchema,
  PreferencesSchema,
  RecentChannelSchema,
  RecentsListSchema,
  SearchInputSchema,
  StreamCardSchema,
} from "@goodttv/contratos"
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron"
import { z } from "zod"
import { CHANNELS } from "../shared/channels"

// Every value is validated on the way in and again on the way out of main.
const invoke = <Schema extends z.ZodType>(schema: Schema, channel: string, ...input: unknown[]) =>
  ipcRenderer.invoke(channel, ...input).then((value): z.infer<Schema> => schema.parse(value))

const subscribe = <Args extends unknown[]>(
  channel: string,
  parse: (...values: unknown[]) => Args,
  listener: (...args: Args) => void,
): (() => void) => {
  const onMessage = (_event: IpcRendererEvent, ...values: unknown[]): void => {
    const parsed = (() => {
      try {
        return parse(...values)
      } catch {
        return undefined
      }
    })()
    if (parsed !== undefined) listener(...parsed)
  }
  ipcRenderer.on(channel, onMessage)
  return () => {
    ipcRenderer.removeListener(channel, onMessage)
  }
}

const api: AppApi = {
  app: {
    status: () => invoke(AppStatusSchema, CHANNELS.appStatus),
  },
  auth: {
    begin: () => invoke(DeviceChallengeSchema, CHANNELS.authBegin),
    logout: () => invoke(z.undefined(), CHANNELS.authLogout),
    snapshot: () => invoke(AuthSnapshotSchema, CHANNELS.authSnapshot),
  },
  catalog: {
    followed: (input) =>
      invoke(
        PageSchema(StreamCardSchema),
        CHANNELS.catalogFollowed,
        CursorInputSchema.parse(input),
      ),
    live: (input) =>
      invoke(PageSchema(StreamCardSchema), CHANNELS.catalogLive, LiveInputSchema.parse(input)),
    search: (input) =>
      invoke(PageSchema(ChannelCardSchema), CHANNELS.catalogSearch, SearchInputSchema.parse(input)),
    streamsByLogin: (logins) =>
      invoke(
        z.array(StreamCardSchema),
        CHANNELS.catalogStreamsByLogin,
        LoginsInputSchema.parse(logins),
      ),
  },
  chat: {
    close: () => invoke(z.undefined(), CHANNELS.chatClose),
    onBatch: (listener) =>
      subscribe(CHANNELS.chatBatch, (batch) => [ChatBatchSchema.parse(batch)] as const, listener),
    open: (input) =>
      invoke(z.number().int().nonnegative(), CHANNELS.chatOpen, ChatOpenInputSchema.parse(input)),
  },
  input: {
    onAction: (listener) =>
      subscribe(
        CHANNELS.inputAction,
        (action) => [InputActionSchema.parse(action)] as const,
        listener,
      ),
    onProbe: (listener) =>
      subscribe(CHANNELS.inputProbe, (probe) => [KeyProbeSchema.parse(probe)] as const, listener),
    setProbing: (active) =>
      invoke(z.undefined(), CHANNELS.inputSetProbing, z.boolean().parse(active)),
    setTextEntry: (active) =>
      invoke(z.undefined(), CHANNELS.inputSetTextEntry, z.boolean().parse(active)),
  },
  player: {
    beginInteraction: () => invoke(z.number().int().positive(), CHANNELS.playerBeginInteraction),
    endInteraction: (id) =>
      invoke(z.undefined(), CHANNELS.playerEndInteraction, z.number().int().positive().parse(id)),
    onInteractionEnded: (listener) =>
      subscribe(
        CHANNELS.playerInteractionEnded,
        (id, reason) =>
          [
            z.number().int().positive().parse(id),
            PlayerInteractionEndSchema.parse(reason),
          ] as const,
        listener,
      ),
    setWatching: (active) =>
      invoke(z.undefined(), CHANNELS.playerSetWatching, z.boolean().parse(active)),
  },
  preferences: {
    get: () => invoke(PreferencesSchema, CHANNELS.preferencesGet),
    update: (patch) =>
      invoke(PreferencesSchema, CHANNELS.preferencesUpdate, PreferencesPatchSchema.parse(patch)),
  },
  recents: {
    add: (channel) =>
      invoke(RecentsListSchema, CHANNELS.recentsAdd, RecentChannelSchema.parse(channel)),
    list: () => invoke(RecentsListSchema, CHANNELS.recentsList),
  },
}

contextBridge.exposeInMainWorld("api", api)
