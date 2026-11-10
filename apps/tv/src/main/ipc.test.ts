import type { AppApi } from "@goodttv/contratos"
import type { BrowserWindow, IpcMainInvokeEvent } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CHANNELS } from "../shared/channels"
import { InvalidIpcSenderError, registerIpc } from "./ipc"

type Handler = (event: IpcMainInvokeEvent, ...input: unknown[]) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
type SyncEvent = { returnValue?: unknown; sender: unknown; senderFrame: unknown }
const syncHandlers = vi.hoisted(() => new Map<string, (event: SyncEvent) => void>())
const preload = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(name: string, api: AppApi) => void>(),
  invoke: vi.fn<(channel: string, ...input: unknown[]) => Promise<unknown>>(),
  on: vi.fn(),
  removeListener: vi.fn(),
  sendSync: vi.fn<(channel: string) => unknown>(() => ({ elegido: "en", sistema: "es-ES" })),
}))

vi.mock("electron", () => ({
  app: { getGPUFeatureStatus: () => ({ video_decode: "enabled" }), getVersion: () => "0.1.0" },
  contextBridge: { exposeInMainWorld: preload.exposeInMainWorld },
  ipcMain: {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    on: (channel: string, listener: (event: SyncEvent) => void) =>
      syncHandlers.set(channel, listener),
  },
  ipcRenderer: {
    invoke: preload.invoke,
    on: preload.on,
    removeListener: preload.removeListener,
    sendSync: preload.sendSync,
  },
}))

const mainFrame = { url: "https://localhost:1234/" }
const webContents = { id: 1, mainFrame }
const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent

const chat = { close: vi.fn(), open: vi.fn(() => 3) }
const guest = {
  channel: vi.fn(async () => null),
  popularSinCuenta: vi.fn(async () => []),
  search: vi.fn(async () => ({ cursor: undefined, items: [] })),
}
const idioma = {
  elegido: vi.fn(() => "en" as const),
  elegir: vi.fn(async () => undefined),
  sistema: "es-ES",
}
const home = {
  forget: vi.fn(async () => undefined),
  save: vi.fn(async () => undefined),
  saved: vi.fn(async () => null),
}
const input = { setProbing: vi.fn(), setTextEntry: vi.fn() }
const local = {
  addRecent: vi.fn(async () => []),
  preferences: vi.fn(async () => ({
    chatScale: "normal" as const,
    chatVisible: true,
    latencyMode: "adaptativo" as const,
  })),
  recents: vi.fn(async () => []),
  updatePreferences: vi.fn(async () => ({
    chatScale: "large" as const,
    chatVisible: true,
    latencyMode: "adaptativo" as const,
  })),
}
const player = { begin: vi.fn(() => 1), end: vi.fn() }
const setWatching = vi.fn()
const page = { cursor: undefined, items: [] }
const twitch = {
  authSnapshot: vi.fn(async () => ({ kind: "guest" as const })),
  beginAuthorization: vi.fn(),
  followed: vi.fn(async () => page),
  live: vi.fn(async () => page),
  logout: vi.fn(async () => undefined),
  search: vi.fn(async () => page),
  status: vi.fn(() => ({ secureStorage: false })),
  streamsByLogin: vi.fn(async () => []),
}

const call = (channel: string, sender: IpcMainInvokeEvent, ...args: unknown[]) => {
  const handler = handlers.get(channel)
  if (handler === undefined) throw new Error(`Missing handler ${channel}`)
  return Promise.resolve(handler(sender, ...args))
}

beforeEach(() => {
  handlers.clear()
  syncHandlers.clear()
  vi.clearAllMocks()
  registerIpc({
    chat,
    guest,
    home,
    idioma,
    input,
    local,
    mainWindow: { webContents } as unknown as BrowserWindow,
    player,
    rendererOrigin: "https://localhost:1234",
    setWatching,
    twitch,
  })
})

describe("registerIpc", () => {
  it("registers exactly the channels the preload uses", () => {
    const listenOnly = new Set<string>([
      CHANNELS.chatBatch,
      CHANNELS.inputAction,
      CHANNELS.inputProbe,
      CHANNELS.playerInteractionEnded,
    ])
    const expected = Object.values(CHANNELS).filter(
      (channel) => !listenOnly.has(channel) && channel !== CHANNELS.idiomaInicial,
    )
    expect([...handlers.keys()].sort()).toEqual([...expected].sort())
    expect([...syncHandlers.keys()]).toEqual([CHANNELS.idiomaInicial])
  })

  it.each([
    ["another webContents", { sender: { id: 2, mainFrame }, senderFrame: mainFrame }],
    ["a subframe", { sender: webContents, senderFrame: { url: "https://localhost:1234/" } }],
    [
      "a Twitch frame",
      { sender: webContents, senderFrame: { url: "https://player.twitch.tv/?parent=localhost" } },
    ],
    ["no frame", { sender: webContents, senderFrame: null }],
  ])("rejects calls from %s", async (_label, sender) => {
    for (const channel of handlers.keys()) {
      await expect(call(channel, sender as unknown as IpcMainInvokeEvent)).rejects.toThrow(
        InvalidIpcSenderError,
      )
    }
    expect(twitch.authSnapshot).not.toHaveBeenCalled()
    expect(player.begin).not.toHaveBeenCalled()
    const sync: SyncEvent = { ...(sender as SyncEvent) }
    syncHandlers.get(CHANNELS.idiomaInicial)?.(sync)
    expect(sync.returnValue).toBeNull()
  })

  it("rejects calls from the right frame on another origin", async () => {
    const foreignFrame = { url: "https://localhost:9999/" }
    const foreign = {
      sender: { id: 1, mainFrame: foreignFrame },
      senderFrame: foreignFrame,
    } as unknown as IpcMainInvokeEvent
    registerIpc({
      chat,
      guest,
      home,
      idioma,
      input,
      local,
      mainWindow: { webContents: { id: 1, mainFrame: foreignFrame } } as unknown as BrowserWindow,
      player,
      rendererOrigin: "https://localhost:1234",
      setWatching,
      twitch,
    })
    await expect(call(CHANNELS.authSnapshot, foreign)).rejects.toThrow(InvalidIpcSenderError)
  })

  it("validates arguments before calling into main", async () => {
    await expect(call(CHANNELS.chatOpen, event, { broadcasterId: "../1" })).rejects.toThrow()
    await expect(call(CHANNELS.catalogSearch, event, { query: "" })).rejects.toThrow()
    await expect(call(CHANNELS.recentsAdd, event, { login: "a b" })).rejects.toThrow()
    await expect(call(CHANNELS.playerSetWatching, event, "yes")).rejects.toThrow()
    await expect(call(CHANNELS.homeSave, event, { account: { kind: "guest" } })).rejects.toThrow()
    await expect(call(CHANNELS.authSnapshot, event, "unexpected")).rejects.toThrow()
    await expect(call(CHANNELS.catalogChannel, event, "a b")).rejects.toThrow()
    await expect(call(CHANNELS.catalogPopularGuest, event, "english")).rejects.toThrow()
    await expect(call(CHANNELS.idiomaElegir, event, "fr")).rejects.toThrow()
    expect(guest.channel).not.toHaveBeenCalled()
    expect(idioma.elegir).not.toHaveBeenCalled()
    expect(chat.open).not.toHaveBeenCalled()
    expect(twitch.search).not.toHaveBeenCalled()
    expect(local.addRecent).not.toHaveBeenCalled()
    expect(home.save).not.toHaveBeenCalled()
  })

  it("passes parsed arguments through", async () => {
    expect(await call(CHANNELS.chatOpen, event, { broadcasterId: "83232866" })).toBe(3)
    expect(chat.open).toHaveBeenCalledWith("83232866")
    await call(CHANNELS.catalogStreamsByLogin, event, ["Ibai", "xqc"])
    expect(twitch.streamsByLogin).toHaveBeenCalledWith(["ibai", "xqc"])
    await call(CHANNELS.playerSetWatching, event, true)
    expect(setWatching).toHaveBeenCalledWith(true)
  })

  it("searches and looks channels up as a guest, without an account", async () => {
    await call(CHANNELS.catalogSearch, event, { query: "ibai" })
    expect(guest.search).toHaveBeenCalledWith({ first: 20, query: "ibai" })
    expect(twitch.search).not.toHaveBeenCalled()
    await call(CHANNELS.catalogChannel, event, "Ibai")
    expect(guest.channel).toHaveBeenCalledWith("ibai")
    await call(CHANNELS.catalogPopularGuest, event, "es")
    expect(guest.popularSinCuenta).toHaveBeenCalledWith("es")
  })

  it("hands the language over synchronously and saves a new choice", async () => {
    const sync: SyncEvent = { sender: webContents, senderFrame: mainFrame }
    syncHandlers.get(CHANNELS.idiomaInicial)?.(sync)
    expect(sync.returnValue).toEqual({ elegido: "en", sistema: "es-ES" })
    await call(CHANNELS.idiomaElegir, event, "sistema")
    expect(idioma.elegir).toHaveBeenCalledWith("sistema")
  })

  it("closes chat when the viewer signs out", async () => {
    await call(CHANNELS.authLogout, event)
    expect(chat.close).toHaveBeenCalled()
    expect(twitch.logout).toHaveBeenCalled()
  })

  it("reports app status without secrets", async () => {
    expect(await call(CHANNELS.appStatus, event)).toEqual({
      secureStorage: false,
      version: "0.1.0",
      videoDecode: "enabled",
    })
  })
})

describe("preload bridge", () => {
  it("exposes only the documented capability object", async () => {
    vi.resetModules()
    await import("../preload/index")
    expect(preload.exposeInMainWorld).toHaveBeenCalledTimes(1)
    const [name, api] = preload.exposeInMainWorld.mock.calls[0] ?? []
    expect(name).toBe("api")
    expect(Object.keys(api ?? {}).sort()).toEqual([
      "app",
      "auth",
      "catalog",
      "chat",
      "home",
      "idioma",
      "input",
      "player",
      "preferences",
      "recents",
    ])
  })

  it("leaves the language to the page when main gives nothing valid", async () => {
    vi.resetModules()
    preload.sendSync.mockReturnValueOnce(null)
    await import("../preload/index")
    const api = preload.exposeInMainWorld.mock.calls[0]?.[1]
    expect(api?.idioma).toBeUndefined()
  })

  it("rejects malformed values coming back from main", async () => {
    vi.resetModules()
    await import("../preload/index")
    const api = preload.exposeInMainWorld.mock.calls[0]?.[1]
    preload.invoke.mockResolvedValueOnce({ kind: "authenticated" })
    await expect(api?.auth.snapshot()).rejects.toThrow()
  })

  it("drops malformed pushed events instead of delivering them", async () => {
    vi.resetModules()
    await import("../preload/index")
    const api = preload.exposeInMainWorld.mock.calls[0]?.[1]
    const listener = vi.fn()
    api?.input.onAction(listener)
    const [, onMessage] =
      preload.on.mock.calls.find(([channel]) => channel === CHANNELS.inputAction) ?? []
    onMessage?.({}, "self-destruct")
    onMessage?.({}, "ok")
    expect(listener).toHaveBeenCalledExactlyOnceWith("ok")
  })
})
