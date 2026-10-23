// @vitest-environment jsdom

// useHome (@goodttv/interfaz), el Inicio de las tres versiones: con lo guardado de una cuenta, lo de ahora se pide ya,
// sin esperar a comprobarla; mientras llega, lo guardado si es de hace menos de 5 min, y si no, la forma de las listas
// (sketch). Se sustituye por lo de ahora y deja de valer con otra cuenta. Sin poder comprobarla (sin red, EXT-4), sigue
// lo guardado y no sale la bienvenida; useAuth lo distingue de la sesión caducada y vuelve a comprobar. Va aquí porque
// este paquete trae react-dom y jsdom.
import type { SavedHome, StreamCard } from "@goodttv/contratos"
import {
  type AuthState,
  type Home,
  type Platform,
  PlatformContext,
  useAuth,
  useHome,
} from "@goodttv/interfaz"
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
const OFFLINE = { kind: "unreachable", message: "fetch failed" } as const
const EXPIRED = { kind: "error", message: "Your Twitch session expired. Sign in again" } as const
// Lo guardado hace horas, y lo de hace un minuto (otra pestaña).
const SAVED: SavedHome = {
  account: MATEO,
  following: [stream("illojuan")],
  popular: [stream("ibai"), stream("auronplay")],
  recentLive: [],
  recents: [{ displayName: "Illojuan", login: "illojuan", watchedAt: 1 }],
  savedAt: 1,
}
const recent = (): SavedHome => ({ ...SAVED, savedAt: Date.now() - 60_000 })
const never = () => new Promise<never>(() => undefined)

let home: Home | undefined
const Probe = ({ auth }: { readonly auth: AuthState | undefined }) => {
  home = useHome(auth)
  return null
}

let root: Root | undefined
let platform: Platform = { hls: {} }
const show = async (auth: AuthState | undefined): Promise<void> => {
  await act(async () =>
    root?.render(
      createElement(PlatformContext, { value: platform }, createElement(Probe, { auth })),
    ),
  )
}
const following = (): readonly string[] =>
  home?.resource.kind === "ready" ? home.resource.value.following.map((each) => each.userLogin) : []

const api = {
  auth: { snapshot: vi.fn(async (): Promise<AuthState> => MATEO) },
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
  api.auth.snapshot.mockReset().mockImplementation(async () => MATEO)
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
  it("con lo guardado de hace un momento, lo enseña mientras pide ya lo de ahora, sin esperar a la cuenta", async () => {
    api.home.saved.mockImplementation(async () => recent())
    api.catalog.followed.mockImplementationOnce(never)
    await show(undefined)
    expect(home).toMatchObject({ fromSaved: true, known: false, reading: false, signedIn: true })
    expect(home?.auth).toEqual(MATEO)
    expect(home?.sketch).toBeUndefined()
    expect(following()).toEqual(["illojuan"])
    expect(api.catalog.followed).toHaveBeenCalledTimes(1)
  })

  it("lo guardado de hace rato no se enseña: la forma de las listas, vacía, hasta lo de ahora", async () => {
    api.catalog.followed.mockImplementationOnce(never)
    await show(undefined)
    expect(home).toMatchObject({ fromSaved: false, known: false, signedIn: true })
    expect(home?.resource.kind).toBe("loading")
    expect(home?.sketch).toEqual({ following: 1, popular: 2, recents: SAVED.recents })
    await show(MATEO)
    expect(home?.sketch).toEqual({ following: 1, popular: 2, recents: SAVED.recents })
  })

  it("la carga empezada antes de saber la cuenta sigue al llegar: no se pide dos veces", async () => {
    await show(undefined)
    await show(MATEO)
    expect(following()).toEqual(["carola"])
    expect(home?.sketch).toBeUndefined()
    expect(api.catalog.followed).toHaveBeenCalledTimes(1)
  })

  it("si lo pedido antes de saber la cuenta falla, no es un error hasta que la cuenta lo diga", async () => {
    api.catalog.followed.mockImplementationOnce(async () => {
      throw new Error("Your Twitch session expired. Sign in again")
    })
    await show(undefined)
    expect(home?.resource.kind).toBe("loading")
    await show(EXPIRED)
    expect(home).toMatchObject({ known: true, signedIn: false })
    expect(home?.resource.kind).not.toBe("error")
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
    api.home.saved.mockImplementation(async () => recent())
    api.catalog.followed.mockImplementationOnce(never)
    await show(undefined)
    api.catalog.followed.mockImplementationOnce(never)
    await show({ displayName: "Otra", kind: "authenticated", login: "otra" })
    expect(home?.resource.kind).toBe("loading")
    expect(home).toMatchObject({ fromSaved: false, sketch: undefined })
  })

  it("si la cuenta resulta ser otra, lo pedido al abrir no vale: se pide otra vez y no se guarda como suyo", async () => {
    api.home.saved.mockImplementation(async () => recent())
    let first: (page: { cursor: undefined; items: StreamCard[] }) => void = () => undefined
    api.catalog.followed.mockImplementationOnce(() => new Promise((done) => (first = done)))
    await show(undefined)
    const OTRA = { displayName: "Otra", kind: "authenticated", login: "otra" } as const
    await show(OTRA)
    expect(api.catalog.followed).toHaveBeenCalledTimes(2)
    await act(async () => first({ cursor: undefined, items: [stream("de-la-primera")] }))
    expect(following()).toEqual(["carola"])
    expect(api.home.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ following: [stream("de-la-primera")] }),
    )
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

  it("sin poder comprobar la cuenta, sigue lo guardado, aunque sea viejo: ni lo olvida ni pide más a Twitch", async () => {
    api.catalog.followed.mockImplementationOnce(async () => {
      throw new TypeError("fetch failed")
    })
    await show(undefined)
    await show(OFFLINE)
    expect(home).toMatchObject({
      fromSaved: true,
      known: false,
      signedIn: true,
      unreachable: "fetch failed",
    })
    expect(home?.auth).toEqual(MATEO)
    expect(following()).toEqual(["illojuan"])
    expect(api.home.forget).not.toHaveBeenCalled()
    // Solo lo de al abrir, antes de saber que no había red.
    expect(api.catalog.followed).toHaveBeenCalledTimes(1)
  })

  it("sin poder comprobarla y sin nada guardado, no se sabe si hay cuenta: nada de bienvenida", async () => {
    api.home.saved.mockImplementation(async () => null)
    await show(OFFLINE)
    expect(home).toMatchObject({
      known: false,
      reading: false,
      signedIn: false,
      unreachable: "fetch failed",
    })
    expect(home?.resource.kind).toBe("loading")
    expect(api.recents.list).not.toHaveBeenCalled()
  })

  it("al volver la red, lo de ahora sustituye a lo guardado", async () => {
    await show(OFFLINE)
    await show(MATEO)
    expect(home).toMatchObject({ fromSaved: false, known: true, unreachable: undefined })
    expect(following()).toEqual(["carola"])
  })

  it("lo olvidado no vuelve si luego no se puede comprobar la cuenta (al vincular otra)", async () => {
    await show(MATEO)
    await show({ kind: "guest" })
    expect(api.home.forget).toHaveBeenCalled()
    await show(OFFLINE)
    expect(home).toMatchObject({ fromSaved: false, signedIn: false, unreachable: "fetch failed" })
    expect(home?.auth).toEqual(OFFLINE)
    expect(following()).toEqual([])
  })

  it("sin poder comprobarla más tarde, vale lo último de esta sesión", async () => {
    await show(MATEO)
    await show(OFFLINE)
    expect(home).toMatchObject({ fromSaved: true, signedIn: true })
    expect(following()).toEqual(["carola"])
  })

  it("si la sesión ha caducado (error, ya cerrada), lo guardado no vale y se olvida", async () => {
    await show(undefined)
    await show(EXPIRED)
    expect(home).toMatchObject({ fromSaved: false, known: true, signedIn: false })
    expect(home?.unreachable).toBeUndefined()
    expect(api.home.forget).toHaveBeenCalled()
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

  it("si falla la primera carga, se sigue viendo lo guardado de hace un momento", async () => {
    api.home.saved.mockImplementation(async () => recent())
    api.catalog.followed.mockImplementationOnce(async () => {
      throw new Error("Helix no contesta")
    })
    await show(undefined)
    await show(MATEO)
    expect(home).toMatchObject({ fromSaved: true })
    expect(following()).toEqual(["illojuan"])
  })

  it("si falla con lo guardado de hace rato, el fallo, con «Reintentar»", async () => {
    api.catalog.followed.mockImplementationOnce(async () => {
      throw new Error("Helix no contesta")
    })
    await show(undefined)
    await show(MATEO)
    expect(home?.resource).toEqual({ kind: "error", message: "Helix no contesta" })
    expect(home?.sketch).toBeUndefined()
  })

  it("si la versión lo lee sin esperar, sale ya en la primera imagen", async () => {
    platform = { hls: {}, savedHome: recent }
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

describe("La cuenta sin red (useAuth)", () => {
  let account: ReturnType<typeof useAuth> | undefined
  const Account = () => {
    account = useAuth()
    return null
  }
  const mount = async (): Promise<void> => {
    await act(async () => root?.render(createElement(Account)))
  }
  afterEach(() => {
    vi.useRealTimers()
    account = undefined
  })

  it("si window.api.auth.snapshot() no contesta, es «unreachable», no «error»", async () => {
    // Como llega en la tele: el error del proceso principal, con el prefijo de Electron.
    api.auth.snapshot.mockRejectedValue(
      new Error("Error invoking remote method 'auth:snapshot': TypeError: fetch failed"),
    )
    await mount()
    expect(account?.auth).toEqual(OFFLINE)
  })

  it("una respuesta de error (la sesión caducada) sigue siendo «error»", async () => {
    api.auth.snapshot.mockResolvedValue(EXPIRED)
    await mount()
    expect(account?.auth).toEqual(EXPIRED)
  })

  it("«Reintentar» (reload) vuelve a comprobarla", async () => {
    api.auth.snapshot.mockRejectedValueOnce(new TypeError("fetch failed"))
    await mount()
    expect(account?.auth?.kind).toBe("unreachable")
    await act(async () => account?.reload())
    expect(account?.auth).toEqual(MATEO)
  })

  it("vuelve a comprobarla sola al volver la red", async () => {
    api.auth.snapshot.mockRejectedValueOnce(new TypeError("fetch failed"))
    await mount()
    expect(account?.auth?.kind).toBe("unreachable")
    await act(async () => {
      dispatchEvent(new Event("online"))
    })
    expect(account?.auth).toEqual(MATEO)
  })

  it("y cada 30 s, por si la red no avisa (Twitch caído)", async () => {
    vi.useFakeTimers()
    api.auth.snapshot.mockRejectedValue(new TypeError("fetch failed"))
    await mount()
    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    expect(api.auth.snapshot).toHaveBeenCalledTimes(2)
    expect(account?.auth?.kind).toBe("unreachable")
    api.auth.snapshot.mockResolvedValue(MATEO)
    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    expect(account?.auth).toEqual(MATEO)
    // Ya comprobada, no sigue preguntando.
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(api.auth.snapshot).toHaveBeenCalledTimes(3)
  })

  it("vale la última comprobación: una anterior que falla tarde no la pisa", async () => {
    let fail: (error: Error) => void = () => undefined
    api.auth.snapshot.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    await mount()
    await act(async () => account?.reload())
    expect(account?.auth).toEqual(MATEO)
    await act(async () => fail(new TypeError("fetch failed")))
    expect(account?.auth).toEqual(MATEO)
  })
})
