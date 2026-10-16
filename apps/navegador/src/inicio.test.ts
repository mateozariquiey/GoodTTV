// @vitest-environment jsdom

// useHome (@goodttv/interfaz), el Inicio de la tele y de la extensión: lo guardado sale mientras se comprueba la cuenta,
// se sustituye por lo de ahora y deja de valer con otra cuenta. Va aquí porque este paquete trae react-dom y jsdom.
import type { AuthSnapshot, SavedHome, StreamCard } from "@goodttv/contratos"
import { type Home, type Platform, PlatformContext, useHome } from "@goodttv/interfaz"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const stream = (login: string): StreamCard => ({
  category: "Just Chatting",
  id: `s-${login}`,
  startedAt: "2026-10-16T14:00:00Z",
  tags: [],
  thumbnailUrl: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-{width}x{height}.jpg`,
  title: `Directo de ${login}`,
  userId: "123",
  userLogin: login,
  userName: login,
  viewerCount: 1000,
})

const MATEO = { displayName: "Mateo", kind: "authenticated", login: "mateo" } as const
const SAVED: SavedHome = {
  account: MATEO,
  following: [stream("illojuan")],
  popular: [],
  recentLive: [],
  recents: [],
  savedAt: 1,
}

let home: Home | undefined
const Probe = ({ auth }: { readonly auth: AuthSnapshot | undefined }) => {
  home = useHome(auth)
  return null
}

let root: Root | undefined
let platform: Platform = { hls: {} }
const show = async (auth: AuthSnapshot | undefined): Promise<void> => {
  await act(async () =>
    root?.render(
      createElement(PlatformContext, { value: platform }, createElement(Probe, { auth })),
    ),
  )
}
const following = (): readonly string[] =>
  home?.resource.kind === "ready" ? home.resource.value.following.map((each) => each.userLogin) : []

const api = {
  catalog: {
    followed: vi.fn(async () => ({ cursor: undefined, items: [stream("carola")] })),
    live: vi.fn(async () => ({ cursor: undefined, items: [] })),
    streamsByLogin: vi.fn(async () => []),
  },
  home: {
    forget: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    saved: vi.fn(async (): Promise<SavedHome | null> => SAVED),
  },
  recents: { list: vi.fn(async () => []) },
}

beforeEach(() => {
  vi.clearAllMocks()
  api.home.saved.mockImplementation(async () => SAVED)
  vi.stubGlobal("api", api)
  platform = { hls: {} }
  home = undefined
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => {
  act(() => root?.unmount())
  vi.unstubAllGlobals()
})

describe("Inicio al abrir", () => {
  it("enseña lo guardado mientras se comprueba la cuenta, sin pedir nada a Twitch", async () => {
    await show(undefined)
    expect(home).toMatchObject({ fromSaved: true, known: false, reading: false, signedIn: true })
    expect(home?.auth).toEqual(MATEO)
    expect(following()).toEqual(["illojuan"])
    expect(api.catalog.followed).not.toHaveBeenCalled()
  })

  it("con la misma cuenta, lo sustituye por lo de ahora y lo guarda", async () => {
    await show(undefined)
    await show(MATEO)
    expect(home?.fromSaved).toBe(false)
    expect(following()).toEqual(["carola"])
    expect(api.home.save).toHaveBeenCalledWith(
      expect.objectContaining({ account: MATEO, following: [stream("carola")] }),
    )
  })

  it("con otra cuenta no vale: «cargando» hasta lo de ahora, nunca lo de la otra", async () => {
    await show(undefined)
    api.catalog.followed.mockImplementationOnce(() => new Promise(() => undefined))
    await show({ displayName: "Otra", kind: "authenticated", login: "otra" })
    expect(home?.resource.kind).toBe("loading")
    expect(home?.fromSaved).toBe(false)
  })

  it("sin cuenta lo olvida, y no hay bienvenida hasta saberlo", async () => {
    api.home.saved.mockImplementation(async () => null)
    await show(undefined)
    expect(home).toMatchObject({ known: false, reading: false, signedIn: false })
    expect(home?.resource.kind).toBe("loading")
    expect(api.recents.list).not.toHaveBeenCalled()
    await show({ kind: "guest" })
    expect(home).toMatchObject({ known: true, signedIn: false })
    expect(api.home.forget).toHaveBeenCalled()
  })

  it("un fallo de red al comprobar la cuenta no lo olvida", async () => {
    await show(undefined)
    await show({ kind: "error", message: "sin red" })
    expect(api.home.forget).not.toHaveBeenCalled()
  })

  it("si la cuenta llega antes que lo guardado y es otra, lo guardado no llega a verse", async () => {
    let answer: (saved: SavedHome) => void = () => undefined
    api.home.saved.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    api.catalog.followed.mockImplementationOnce(() => new Promise(() => undefined))
    await show(undefined)
    expect(home).toMatchObject({ reading: true, signedIn: false })
    await show({ displayName: "Otra", kind: "authenticated", login: "otra" })
    await act(async () => answer(SAVED))
    expect(home).toMatchObject({ fromSaved: false, reading: false })
    expect(following()).toEqual([])
  })

  it("si no se puede leer lo guardado, sigue sin ello", async () => {
    api.home.saved.mockImplementation(async () => {
      throw new Error("sin IPC")
    })
    await show(undefined)
    expect(home).toMatchObject({ fromSaved: false, reading: false })
    await show(MATEO)
    expect(following()).toEqual(["carola"])
  })

  it("si falla la primera carga, se sigue viendo lo guardado", async () => {
    api.catalog.followed.mockImplementationOnce(async () => {
      throw new Error("Helix no contesta")
    })
    await show(undefined)
    await show(MATEO)
    expect(home).toMatchObject({ fromSaved: true })
    expect(following()).toEqual(["illojuan"])
  })

  it("si la versión lo lee sin esperar, sale ya en la primera imagen", async () => {
    platform = { hls: {}, savedHome: () => SAVED }
    let first: Home | undefined
    const First = () => {
      const value = useHome(undefined)
      first ??= value
      return null
    }
    await act(async () =>
      root?.render(createElement(PlatformContext, { value: platform }, createElement(First))),
    )
    expect(first).toMatchObject({ fromSaved: true, reading: false })
    expect(api.home.saved).not.toHaveBeenCalled()
  })
})
