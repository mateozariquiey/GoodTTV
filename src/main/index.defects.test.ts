import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

type Deferred<Value> = {
  promise: Promise<Value>
  reject: (reason: unknown) => void
  resolve: (value: Value) => void
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: (value: Value) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<Value>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, reject, resolve }
}

const setup = () => {
  vi.resetModules()
  vi.stubEnv("ELECTRON_RENDERER_URL", undefined)

  const ready = deferred<void>()
  const loaded = deferred<void>()
  const exited = deferred<void>()
  const closeStarted = deferred<void>()
  const closeResult = deferred<void>()
  const whenReady = vi.fn(() => ({
    // biome-ignore lint/suspicious/noThenProperty: Model Electron's promise chain while consuming its rejected result.
    then: (onFulfilled: () => unknown) => ({
      catch: (onRejected: (reason: unknown) => unknown) => {
        const result = ready.promise.then(onFulfilled).catch(onRejected)
        result.catch(() => undefined)
        return result
      },
    }),
  }))
  const app = Object.assign(new EventEmitter(), {
    exit: vi.fn(() => exited.resolve()),
    getAppPath: vi.fn(() => "/application"),
    getName: vi.fn(() => "App"),
    getPath: vi.fn(() => "/profile"),
    isPackaged: false,
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady,
  })
  const loadURL = vi.fn(async (_url: string) => {
    loaded.resolve()
  })
  class MockWindow extends EventEmitter {
    public readonly focus = vi.fn()
    public readonly loadURL = loadURL
    public readonly show = vi.fn()
    public readonly webContents = Object.assign(new EventEmitter(), {
      id: 1,
      setWindowOpenHandler: vi.fn(),
    })
  }
  const BrowserWindow = vi.fn(MockWindow)
  const server = {
    certificateFingerprint: "fingerprint",
    close: vi.fn(async (): Promise<void> => undefined),
    origin: "https://localhost:1234",
  }
  const startStaticHttpsServer = vi.fn(async () => server)
  const createInputRouter = vi.fn(() => ({}))
  const createPlayerInteraction = vi.fn(() => ({ windowBlurred: vi.fn() }))
  const registerIpc = vi.fn()
  const LocalStore = vi.fn(class {})
  const EmoteCatalog = vi.fn(class {})
  const EventSubChat = vi.fn(
    class {
      public readonly close = vi.fn()
    },
  )
  const SettingsStore = vi.fn(class {})
  const TokenVault = vi.fn(
    class {
      public readonly isSecure = true
    },
  )
  const TwitchService = vi.fn(class {})
  const showErrorBox = vi.fn()
  const defaultSession = {
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
  }

  vi.doMock("electron", () => ({
    app,
    BrowserWindow,
    dialog: { showErrorBox },
    Menu: { setApplicationMenu: vi.fn() },
    powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
    safeStorage: {},
    session: { defaultSession },
  }))
  vi.doMock("./chat/emote-catalog", () => ({ EmoteCatalog }))
  vi.doMock("./chat/eventsub-chat", () => ({ EventSubChat }))
  vi.doMock("./https-server", () => ({ startStaticHttpsServer }))
  vi.doMock("./input-router", () => ({ createInputRouter }))
  vi.doMock("./ipc", () => ({ registerIpc }))
  vi.doMock("./local-store", () => ({ LocalStore }))
  vi.doMock("./player-interaction", () => ({ createPlayerInteraction }))
  vi.doMock("./settings-store", () => ({ SettingsStore }))
  vi.doMock("./token-vault", () => ({ TokenVault }))
  vi.doMock("./twitch-service", () => ({ TwitchService }))

  return {
    app,
    closeResult,
    closeStarted,
    exited,
    loaded,
    loadURL,
    server,
    showErrorBox,
    ready,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("main shutdown defect regressions", () => {
  it.fails("D-cycle-20-2 exits after startup cleanup rejects", async () => {
    const fixture = setup()
    const rendererFailure = new Error("Renderer load failed")
    const cleanupFailure = new Error("HTTPS cleanup failed")
    fixture.loadURL.mockRejectedValueOnce(rendererFailure)
    fixture.server.close.mockImplementationOnce(() => {
      fixture.closeStarted.resolve()
      return fixture.closeResult.promise
    })

    await import("./index")
    fixture.ready.resolve()
    await fixture.closeStarted.promise
    fixture.closeResult.reject(cleanupFailure)
    await fixture.closeResult.promise.catch(() => undefined)

    expect(fixture.app.exit).toHaveBeenCalledExactlyOnceWith(1)
  }, 5000)

  it.fails("D-cycle-20-3 reports a normal-shutdown cleanup rejection", async () => {
    const fixture = setup()
    const cleanupFailure = new Error("HTTPS cleanup failed")
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined)
    fixture.server.close.mockImplementationOnce(() => {
      fixture.closeStarted.resolve()
      fixture.closeResult.promise.catch(() => undefined)
      return fixture.closeResult.promise
    })

    await import("./index")
    fixture.ready.resolve()
    await fixture.loaded.promise
    fixture.app.emit("will-quit")
    await fixture.closeStarted.promise
    fixture.closeResult.reject(cleanupFailure)
    await fixture.closeResult.promise.catch(() => undefined)

    expect(errorLog.mock.calls.flat()).toContain(cleanupFailure)
  })
})
