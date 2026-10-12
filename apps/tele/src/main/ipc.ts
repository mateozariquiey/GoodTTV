import {
  ChatOpenInputSchema,
  CursorInputSchema,
  LiveInputSchema,
  LoginsInputSchema,
  PreferencesPatchSchema,
  RecentChannelSchema,
  SearchInputSchema,
} from "@goodttv/contratos"
import type { EventSubChat, LocalStore, TwitchService } from "@goodttv/servicios"
import { app, type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron"
import { z } from "zod"
import { CHANNELS } from "../shared/channels"
import type { InputRouter } from "./input-router"
import type { PlayerInteraction } from "./player-interaction"

type IpcOptions = {
  readonly chat: Pick<EventSubChat, "close" | "open">
  readonly input: Pick<InputRouter, "setProbing" | "setTextEntry">
  readonly local: Pick<LocalStore, "addRecent" | "preferences" | "recents" | "updatePreferences">
  readonly mainWindow: BrowserWindow
  readonly player: Pick<PlayerInteraction, "begin" | "end">
  readonly rendererOrigin: string
  readonly setWatching: (active: boolean) => void
  readonly twitch: Pick<
    TwitchService,
    | "authSnapshot"
    | "beginAuthorization"
    | "followed"
    | "live"
    | "logout"
    | "search"
    | "status"
    | "streamsByLogin"
  >
}

export class InvalidIpcSenderError extends Error {
  public constructor() {
    super("IPC call rejected from an unexpected frame")
    this.name = "InvalidIpcSenderError"
  }
}

export const registerIpc = (options: IpcOptions): void => {
  // Only the app's own top-level document may call in; never a Twitch frame.
  const authorize = (event: IpcMainInvokeEvent): void => {
    const senderFrame = event.senderFrame
    if (
      senderFrame === null ||
      event.sender.id !== options.mainWindow.webContents.id ||
      senderFrame !== options.mainWindow.webContents.mainFrame ||
      !URL.canParse(senderFrame.url) ||
      new URL(senderFrame.url).origin !== options.rendererOrigin
    ) {
      throw new InvalidIpcSenderError()
    }
  }
  const handle = <Args extends unknown[], Result>(
    channel: string,
    schema: z.ZodType<Args>,
    run: (...args: Args) => Result,
  ): void => {
    ipcMain.handle(channel, async (event, ...input: unknown[]) => {
      authorize(event)
      return run(...schema.parse(input))
    })
  }
  const none = z.tuple([])

  handle(CHANNELS.appStatus, none, () => ({
    ...options.twitch.status(),
    version: app.getVersion(),
    videoDecode: String(app.getGPUFeatureStatus().video_decode ?? "unknown"),
  }))

  handle(CHANNELS.authSnapshot, none, () => options.twitch.authSnapshot())
  handle(CHANNELS.authBegin, none, () => options.twitch.beginAuthorization())
  handle(CHANNELS.authLogout, none, () => {
    options.chat.close()
    return options.twitch.logout()
  })

  handle(CHANNELS.catalogFollowed, z.tuple([CursorInputSchema]), (input) =>
    options.twitch.followed(input),
  )
  handle(CHANNELS.catalogLive, z.tuple([LiveInputSchema]), (input) => options.twitch.live(input))
  handle(CHANNELS.catalogSearch, z.tuple([SearchInputSchema]), (input) =>
    options.twitch.search(input),
  )
  handle(CHANNELS.catalogStreamsByLogin, z.tuple([LoginsInputSchema]), (logins) =>
    options.twitch.streamsByLogin(logins),
  )

  handle(CHANNELS.chatOpen, z.tuple([ChatOpenInputSchema]), (input) =>
    options.chat.open(input.broadcasterId),
  )
  handle(CHANNELS.chatClose, none, () => options.chat.close())

  handle(CHANNELS.inputSetTextEntry, z.tuple([z.boolean()]), (active) =>
    options.input.setTextEntry(active),
  )
  handle(CHANNELS.inputSetProbing, z.tuple([z.boolean()]), (active) =>
    options.input.setProbing(active),
  )

  handle(CHANNELS.playerBeginInteraction, none, () => options.player.begin())
  handle(CHANNELS.playerEndInteraction, z.tuple([z.number().int().positive()]), (id) =>
    options.player.end(id),
  )
  handle(CHANNELS.playerSetWatching, z.tuple([z.boolean()]), (active) =>
    options.setWatching(active),
  )

  handle(CHANNELS.preferencesGet, none, () => options.local.preferences())
  handle(CHANNELS.preferencesUpdate, z.tuple([PreferencesPatchSchema]), (patch) =>
    options.local.updatePreferences(patch),
  )
  handle(CHANNELS.recentsList, none, () => options.local.recents())
  handle(CHANNELS.recentsAdd, z.tuple([RecentChannelSchema]), (entry) =>
    options.local.addRecent(entry),
  )
}
