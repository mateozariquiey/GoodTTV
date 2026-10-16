import {
  type AuthSnapshot,
  AuthSnapshotSchema,
  RecentsListSchema,
  StreamCardSchema,
} from "@goodttv/contratos"
import type { HomeData } from "@goodttv/interfaz"

// Lo último que se vio en Inicio con la cuenta vinculada, para enseñarlo nada más abrir GoodTTV mientras llega lo de
// ahora: comprobar la sesión y pedir los directos a Twitch tarda alrededor de un segundo. En localStorage y no en
// chrome.storage.local porque se lee sin esperar, así que sale ya en la primera imagen. Sin tokens: solo lo que se ve.
const KEY = "inicio"
const VERSION = 1

export type Account = Extract<AuthSnapshot, { readonly kind: "authenticated" }>
export type SavedHome = {
  readonly account: Account
  readonly home: HomeData
  readonly savedAt: number
}

const streams = StreamCardSchema.array()

// localStorage puede lanzar solo con mirarlo (un navegador que lo bloquea): entonces, sin Inicio guardado.
export const pageStorage = (): Storage | undefined => {
  try {
    return localStorage
  } catch {
    return undefined
  }
}

// Otra versión, algo roto o un navegador que no deja usar localStorage: como si no hubiera nada.
export const readSavedHome = (
  storage: Pick<Storage, "getItem"> | undefined,
): SavedHome | undefined => {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? "null")
    if (saved?.version !== VERSION || typeof saved.savedAt !== "number") return undefined
    const account = AuthSnapshotSchema.parse(saved.account)
    if (account.kind !== "authenticated") return undefined
    return {
      account,
      home: {
        following: streams.parse(saved.following),
        popular: streams.parse(saved.popular),
        recentLive: new Map(streams.parse(saved.recentLive).map((each) => [each.userLogin, each])),
        recents: RecentsListSchema.parse(saved.recents),
      },
      savedAt: saved.savedAt,
    }
  } catch {
    return undefined
  }
}

export const saveHome = (
  storage: Pick<Storage, "setItem"> | undefined,
  account: Account,
  home: HomeData,
) => {
  try {
    storage?.setItem(
      KEY,
      JSON.stringify({
        account,
        following: home.following,
        popular: home.popular,
        recentLive: [...home.recentLive.values()],
        recents: home.recents,
        savedAt: Date.now(),
        version: VERSION,
      }),
    )
  } catch {
    // Sin sitio o sin localStorage: la próxima vez se espera a Twitch, como antes.
  }
}

export const forgetHome = (storage: Pick<Storage, "removeItem"> | undefined) => {
  try {
    storage?.removeItem(KEY)
  } catch {
    // Igual que al guardar.
  }
}
