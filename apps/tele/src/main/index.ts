import { X509Certificate } from "node:crypto"
import { join } from "node:path"
import { EmoteCatalog, EventSubChat, LocalStore, TwitchService } from "@goodttv/servicios"
import { app, BrowserWindow, dialog, Menu, powerSaveBlocker, safeStorage, session } from "electron"
import { CHANNELS } from "../shared/channels"
import { type StaticHttpsServer, startStaticHttpsServer } from "./https-server"
import { createInputRouter } from "./input-router"
import { registerIpc } from "./ipc"
import { localDataFile } from "./local-store"
import { createPlayerInteraction } from "./player-interaction"
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

let staticServer: StaticHttpsServer | undefined
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

const isTwitchPlayerOrigin = (value: string): boolean =>
  URL.canParse(value) && new URL(value).origin === "https://player.twitch.tv"

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

  const { ELECTRON_RENDERER_URL: developmentRendererUrl } = process.env
  const rendererUrl = app.isPackaged ? undefined : developmentRendererUrl
  let rendererOrigin: string
  if (rendererUrl !== undefined) {
    rendererOrigin = new URL(rendererUrl).origin
  } else {
    const certificatesPath = app.isPackaged
      ? join(process.resourcesPath, "certs")
      : join(app.getAppPath(), "resources/certs")
    // Directo sin anuncios del reproductor propio (docs/decisiones.md, D11), en el mismo origen que la interfaz.
    streamService = createStreamService(
      process.env["GOODTTV_REGISTRO_EMPALME"] === "1" ? logStreamEvent : undefined,
    )
    const stream = streamService
    staticServer = await startStaticHttpsServer({
      assetsPath: join(app.getAppPath(), "out/renderer"),
      certificatePath: join(certificatesPath, "localhost-cert.pem"),
      dynamic: (request, response, pathname) => stream.handle(request, response, pathname),
      keyPath: join(certificatesPath, "localhost-key.pem"),
    })
    rendererOrigin = staticServer.origin

    app.on("certificate-error", (event, webContents, url, error, certificate, callback) => {
      const trustsCertificate =
        webContents.id === mainWindow.webContents.id &&
        URL.canParse(url) &&
        new URL(url).origin === staticServer?.origin &&
        error === "net::ERR_CERT_AUTHORITY_INVALID" &&
        new X509Certificate(certificate.data).fingerprint256 ===
          staticServer?.certificateFingerprint

      if (trustsCertificate) {
        event.preventDefault()
        callback(true)
        return
      }
      callback(false)
    })
  }

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
  const player = createPlayerInteraction(mainWindow, input)
  // Keep the TV awake while a stream plays; Twitch pauses an embed whose page gets hidden.
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
  mainWindow.on("blur", player.windowBlurred)
  mainWindow.on("closed", stopSessionWork)
  mainWindow.webContents.on("render-process-gone", stopSessionWork)
  mainWindow.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame) stopSessionWork()
  })
  registerIpc({
    chat,
    home: savedHomeStore(app.getPath("userData")),
    input,
    local: new LocalStore(localDataFile(app.getPath("userData"))),
    mainWindow,
    player,
    rendererOrigin,
    setWatching,
    twitch,
  })

  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) =>
      webContents !== null &&
      webContents.id === mainWindow.webContents.id &&
      permission === "fullscreen" &&
      isTwitchPlayerOrigin(requestingOrigin),
  )
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        webContents.id === mainWindow.webContents.id &&
          permission === "fullscreen" &&
          isTwitchPlayerOrigin(details.requestingUrl),
      )
    },
  )

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const permitsNavigation = URL.canParse(url) && new URL(url).origin === rendererOrigin
    if (!permitsNavigation) {
      event.preventDefault()
    }
  })

  await mainWindow.loadURL(rendererUrl ?? rendererOrigin)
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
      dialog.showErrorBox(`${app.getName()} could not start`, message)
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
