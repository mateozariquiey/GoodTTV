import { z } from "zod"

// Las fotos de los canales de las listas (Helix users), que cambian poco: así cada lista se pinta con las que ya se
// tienen, y a Twitch solo se piden las que faltan (TwitchService). Valen una semana: si un canal cambia la suya, Twitch
// sigue sirviendo la vieja. En la extensión y en Android se guardan en el localStorage de la página, que comparten sus
// pestañas; en la tele, en memoria, porque el proceso sigue abierto. Se olvidan al cerrar sesión, como Inicio guardado:
// dicen a quién sigues.
const KEY = "fotos"
const TTL_MS = 7 * 24 * 3_600_000
const LIMIT = 500 // unas 75 KB: los seguidos, los populares y los recientes de varias semanas

const StoredSchema = z.object({
  fotos: z.record(z.string(), z.tuple([z.url(), z.number()])),
  version: z.literal(1),
})

type Entries = Map<string, readonly [url: string, at: number]>
export type PictureStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">

export class ProfilePictures {
  readonly #storage: PictureStorage | undefined
  #entries: Entries | undefined

  public constructor(storage?: PictureStorage) {
    this.#storage = storage
  }

  // Las que se tienen, de esos canales.
  public known(userIds: Iterable<string>, now = Date.now()): Map<string, string> {
    const entries = this.#load()
    const known = new Map<string, string>()
    for (const id of userIds) {
      const entry = entries.get(id)
      if (entry !== undefined && now - entry[1] < TTL_MS) known.set(id, entry[0])
    }
    return known
  }

  public add(pictures: ReadonlyMap<string, string>, now = Date.now()): void {
    if (pictures.size === 0) return
    // Lo que ya se tenía y lo que otra pestaña haya guardado mientras tanto; de cada canal, la más reciente.
    const entries = new Map(this.#load())
    for (const [id, entry] of this.#read()) {
      const current = entries.get(id)
      if (current === undefined || current[1] < entry[1]) entries.set(id, entry)
    }
    for (const [id, url] of pictures) entries.set(id, [url, now])
    const kept = [...entries]
      .filter(([, [, at]]) => now - at < TTL_MS)
      .sort((a, b) => b[1][1] - a[1][1])
      .slice(0, LIMIT)
    this.#entries = new Map(kept)
    try {
      this.#storage?.setItem(KEY, JSON.stringify({ fotos: Object.fromEntries(kept), version: 1 }))
    } catch {
      // Sin sitio o sin localStorage: siguen en memoria.
    }
  }

  public clear(): void {
    this.#entries = new Map()
    try {
      this.#storage?.removeItem(KEY)
    } catch {
      // Igual que al guardar.
    }
  }

  #load(): Entries {
    this.#entries ??= this.#read()
    return this.#entries
  }

  // Lo guardado; sin almacén, algo roto u otra versión, como si no hubiera nada.
  #read(): Entries {
    try {
      const parsed = StoredSchema.safeParse(JSON.parse(this.#storage?.getItem(KEY) ?? "null"))
      return parsed.success ? new Map(Object.entries(parsed.data.fotos)) : new Map()
    } catch {
      return new Map()
    }
  }
}
