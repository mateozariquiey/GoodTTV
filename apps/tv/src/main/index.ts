import { join } from "node:path"
import {
  EmoteCatalog,
  EventSubChat,
  guestCatalog,
  LocalStore,
  TwitchService,
} from "@goodttv/servicios"
import { guestChannels } from "@goodttv/sin-anuncios"
import { app, BrowserWindow, dialog, Menu, powerSaveBlocker, safeStorage, session } from "electron"
import { CHANNELS } from "../shared/channels"
import { idiomaDelSistema, idiomaEfectivo, idiomaStore } from "./idioma"
import { createInputRouter } from "./input-router"
import { registerIpc } from "./ipc"
import { type LocalServer, startLocalServer } from "./local-server"
import { localDataFile } from "./local-store"
import { savedHomeStore } from "./saved-home"
import { SettingsStore } from "./settings-store"
import { createStreamService, type StreamService } from "./stream/stream-service"
import { TokenVault } from "./token-vault"

// Laboratorio (GOODTTV_REGISTRO_EMPALME=1): eventos del empalme por la salida estándar, solo con estos campos; los
// errores y las URL pueden llevar el token de Twitch.
const STREAM_LOG_FIELDS = [
  "canal",
  "duracionS",
  "ev",
  "fragmentosVod",
  "motivo",
  "ms",
  "publicados",
  "saltoS",
  "segundos",
  "seq",
  "type",
]
const logStreamEvent = (event: Record<string, unknown>): void => {
  const fields = STREAM_LOG_FIELDS.filter((name) => event[name] !== undefined)
  const safe = Object.fromEntries(fields.map((name) => [name, event[name]]))
  console.log(JSON.stringify({ src: "empalme", t: +(Date.now() / 1000).toFixed(2), ...safe }))
}

let staticServer: LocalServer | undefined
let streamService: StreamService | undefined
let primaryWindow: BrowserWindow | undefined
let activationRequested = false

const activateWindow = (): void => {
  if (primaryWindow === undefined) {
    activationRequested = true
    return
  }
  activationRequested = false
  if (primaryWindow.isMinimized()) primaryWindow.restore()
  primaryWindow.show()
  primaryWindow.focus()
}

// On the TV the app runs full screen (`--fullscreen` in the launcher); windowed for development.
const startsFullscreen = (): boolean => process.argv.includes("--fullscreen")

const createWindow = async (): Promise<void> => {
  // No menu bar: it costs space on a TV and its accelerators (reload, zoom) are not wanted.
  Menu.setApplicationMenu(null)
  // Happy Eyeballs: prueba IPv6 e IPv4 a la vez. En una red que anuncia ruta IPv6 sin dar una dirección pública (la del
  // laboratorio), cada conexión nueva perdía 300 ms esperando a IPv6 antes de pasar a IPv4; así tarda ~10 ms.
  app.configureHostResolver({ enableHappyEyeballs: true })
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#0b0b0d",
    fullscreen: startsFullscreen(),
    show: false,
    title: app.getName(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
    },
  })

  primaryWindow = mainWindow
  mainWindow.on("closed", () => {
    primaryWindow = undefined
  })

  // Directo sin anuncios del reproductor propio (docs/decisiones.md, D11), en el mismo origen que la interfaz.
  const stream = createStreamService(
    process.env["GOODTTV_REGISTRO_EMPALME"] === "1" ? logStreamEvent : undefined,
  )
  streamService = stream
  staticServer = await startLocalServer({
    assetsPath: join(app.getAppPath(), "out/renderer"),
    dynamic: (request, response, pathname) => stream.handle(request, response, pathname),
  })
  const rendererOrigin = staticServer.origin

  const tokenVault = new TokenVault(app.getPath("userData"), {
    backend: () => safeStorage.getSelectedStorageBackend(),
    decrypt: (value) => safeStorage.decryptString(value),
    encrypt: (value) => safeStorage.encryptString(value),
    isAvailable: () => safeStorage.isEncryptionAvailable(),
  })
  if (!tokenVault.isSecure) {
    console.warn("Secure OAuth token storage unavailable; using mode-0600 file fallback")
  }
  const twitch = new TwitchService(new SettingsStore(), tokenVault)
  const emotes = new EmoteCatalog()
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
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CHANNELS.chatBatch, batch)
    },
  })
  const input = createInputRouter(mainWindow.webContents)
  // Keep the TV awake while a stream plays.
  let displayBlocker: number | undefined
  const setWatching = (active: boolean): void => {
    if (active && displayBlocker === undefined) {
      displayBlocker = powerSaveBlocker.start("prevent-display-sleep")
    } else if (!active && displayBlocker !== undefined) {
      powerSaveBlocker.stop(displayBlocker)
      displayBlocker = undefined
    }
  }
  const stopSessionWork = (): void => {
    chat.close()
    setWatching(false)
  }
  mainWindow.on("closed", stopSessionWork)
  mainWindow.webContents.on("render-process-gone", stopSessionWork)
  mainWindow.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame) stopSessionWork()
  })
  registerIpc({
    chat,
    // Como invitado, desde main (con su red, sin CORS): buscar, un canal por su nombre y los más vistos.
    guest: guestCatalog(guestChannels),
    home: savedHomeStore(app.getPath("userData")),
    idioma: Object.assign(idiomaStore(app.getPath("userData")), {
      sistema: idiomaDelSistema(app.getPreferredSystemLanguages(), app.getLocale()),
    }),
    input,
    local: new LocalStore(localDataFile(app.getPath("userData"))),
    mainWindow,
    rendererOrigin,
    setWatching,
    twitch,
  })

  // The app needs no web permission (the window itself goes full screen): every one is refused.
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  )

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const permitsNavigation = URL.canParse(url) && new URL(url).origin === rendererOrigin
    if (!permitsNavigation) {
      event.preventDefault()
    }
  })

  await mainWindow.loadURL(rendererOrigin)
  // Keys only reach this window while it has system focus; take it once at start.
  mainWindow.show()
  mainWindow.focus()
  if (activationRequested) activateWindow()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // A second launch may only reactivate this window, never supply navigation arguments.
  app.on("second-instance", activateWindow)

  app
    .whenReady()
    .then(createWindow)
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown startup failure"
      const idioma = idiomaEfectivo(
        idiomaStore(app.getPath("userData")).elegido(),
        idiomaDelSistema(app.getPreferredSystemLanguages(), app.getLocale()),
      )
      dialog.showErrorBox(
        idioma === "es"
          ? `${app.getName()} no ha podido arrancar`
          : `${app.getName()} could not start`,
        message,
      )
      await staticServer?.close()
      app.exit(1)
    })

  app.on("window-all-closed", () => {
    app.quit()
  })

  app.on("will-quit", () => {
    streamService?.stop()
    void staticServer?.close()
  })
}
