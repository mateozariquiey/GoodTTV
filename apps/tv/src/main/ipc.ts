import {
  CategorySlugSchema,
  ChatOpenInputSchema,
  IdiomaElegidoSchema,
  type IdiomaInicial,
  LanguageSchema,
  ListInputSchema,
  LoginSchema,
  LoginsInputSchema,
  PreferencesPatchSchema,
  RecentChannelSchema,
  SavedHomeSchema,
  SearchInputSchema,
} from "@goodttv/contratos"
import type { EventSubChat, guestCatalog, LocalStore, TwitchService } from "@goodttv/servicios"
import {
  app,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
} from "electron"
import { z } from "zod"
import { CHANNELS } from "../shared/channels"
import type { IdiomaStore } from "./idioma"
import type { InputRouter } from "./input-router"
import type { SavedHomeStore } from "./saved-home"

type IpcOptions = {
  readonly chat: Pick<EventSubChat, "close" | "open">
  // Lo que se ve sin cuenta (buscar, un canal por su nombre, los más vistos y el directorio de categorías, D49), como en
  // la extensión y Android.
  readonly guest: ReturnType<typeof guestCatalog>
  readonly home: SavedHomeStore
  readonly idioma: IdiomaStore & { readonly sistema: string }
  readonly input: Pick<InputRouter, "setProbing" | "setTextEntry">
  readonly local: Pick<LocalStore, "addRecent" | "preferences" | "recents" | "updatePreferences">
  readonly mainWindow: BrowserWindow
  readonly rendererOrigin: string
  readonly setWatching: (active: boolean) => void
  readonly twitch: Pick<
    TwitchService,
    "authSnapshot" | "beginAuthorization" | "followed" | "logout" | "status" | "streamsByLogin"
  >
}

export class InvalidIpcSenderError extends Error {
  public constructor() {
    super("IPC call rejected from an unexpected frame")
    this.name = "InvalidIpcSenderError"
  }
}

export const registerIpc = (options: IpcOptions): void => {
  // Only the app's own top-level document may call in; never a subframe.
  const authorize = (event: IpcMainInvokeEvent | IpcMainEvent): void => {
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

  handle(CHANNELS.catalogFollowed, z.tuple([ListInputSchema]), (input) =>
    options.twitch.followed(input),
  )
  handle(CHANNELS.catalogSearch, z.tuple([SearchInputSchema]), (input) =>
    options.guest.search(input),
  )
  handle(CHANNELS.catalogChannel, z.tuple([LoginSchema]), (login) => options.guest.channel(login))
  handle(CHANNELS.catalogPopular, z.tuple([LanguageSchema]), (language) =>
    options.guest.popular(language),
  )
  handle(CHANNELS.catalogCategories, z.tuple([]), () => options.guest.categories())
  handle(CHANNELS.catalogCategory, z.tuple([CategorySlugSchema]), (slug) =>
    options.guest.category(slug),
  )
  handle(CHANNELS.catalogStreamsByLogin, z.tuple([LoginsInputSchema]), (logins) =>
    options.twitch.streamsByLogin(logins),
  )

  handle(CHANNELS.chatOpen, z.tuple([ChatOpenInputSchema]), (input) =>
    options.chat.open(input.broadcasterId),
  )
  handle(CHANNELS.chatClose, none, () => options.chat.close())

  handle(CHANNELS.homeSaved, none, () => options.home.saved())
  handle(CHANNELS.homeSave, z.tuple([SavedHomeSchema]), (home) => options.home.save(home))
  handle(CHANNELS.homeForget, none, () => options.home.forget())

  // Síncrono: la página lo lee al cargar, antes de pintar (preload).
  ipcMain.on(CHANNELS.idiomaInicial, (event) => {
    try {
      authorize(event)
      const inicial: IdiomaInicial = {
        elegido: options.idioma.elegido(),
        sistema: options.idioma.sistema.slice(0, 40),
      }
      event.returnValue = inicial
    } catch {
      event.returnValue = null
    }
  })
  handle(CHANNELS.idiomaElegir, z.tuple([IdiomaElegidoSchema]), (valor) =>
    options.idioma.elegir(valor),
  )

  handle(CHANNELS.inputSetTextEntry, z.tuple([z.boolean()]), (active) =>
    options.input.setTextEntry(active),
  )
  handle(CHANNELS.inputSetProbing, z.tuple([z.boolean()]), (active) =>
    options.input.setProbing(active),
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
