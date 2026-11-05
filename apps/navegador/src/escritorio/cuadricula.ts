// Lo que no es pantalla de la cuadrícula (EXT-6): si está activada, qué canales lleva y qué directo atiende a cada uno.
// Se activa en Ajustes; sin activarla, nada cambia.
export const MAX_CELLS = 4

const ENABLED_KEY = "cuadricula"
// Los de la última cuadrícula y el que suena, por pestaña: cada pestaña tiene los suyos, y sobreviven a recargar.
const LAST_KEY = "cuadricula-ultima"
const ACTIVE_KEY = "cuadricula-activa"

const storageOf = (session = false): Storage | undefined => {
  try {
    return session ? globalThis.sessionStorage : globalThis.localStorage
  } catch {
    return undefined
  }
}
const read = (key: string, storage: Storage | undefined): string | null => {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}
const write = (key: string, value: string, storage: Storage | undefined): void => {
  try {
    storage?.setItem(key, value)
  } catch {
    // Sin sitio: vale hasta recargar.
  }
}

export const gridEnabled = (storage = storageOf()): boolean => read(ENABLED_KEY, storage) === "1"
export const setGridEnabled = (on: boolean, storage = storageOf()): void =>
  write(ENABLED_KEY, on ? "1" : "0", storage)

export const lastGrid = (storage = storageOf(true)): readonly string[] =>
  (read(LAST_KEY, storage) ?? "").split(",").filter((login) => login !== "")
export const rememberGrid = (logins: readonly string[], storage = storageOf(true)): void =>
  write(LAST_KEY, logins.join(","), storage)
export const lastActive = (storage = storageOf(true)): string | undefined =>
  read(ACTIVE_KEY, storage) ?? undefined
export const rememberActive = (login: string, storage = storageOf(true)): void =>
  write(ACTIVE_KEY, login, storage)

// Los canales al entrar en la cuadrícula: la de antes si se viene de ella («Ver solo» y vuelta) o de fuera de un canal;
// desde otro canal, ese.
export const gridFrom = (
  current: string | undefined,
  last: readonly string[],
): readonly string[] => (current === undefined || last.includes(current) ? last : [current])

// Otro canal en la cuadrícula. Si ya está, no cambia nada; si está llena, ocupa el sitio del último que no suena.
export const addToGrid = (
  logins: readonly string[],
  login: string,
  sounding: string | undefined,
): readonly string[] => {
  if (logins.includes(login)) return logins
  if (logins.length < MAX_CELLS) return [...logins, login]
  const out = [...logins].reverse().find((each) => each !== sounding)
  return logins.map((each) => (each === out ? login : each))
}

// El hueco del directo de cada canal (directo-huecos.ts): el que ya tenía o el primero libre. El 0 es el directo
// principal: el canal con el que se entra en la cuadrícula sigue con su empalme.
export const assignHuecos = (
  logins: readonly string[],
  previous: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> => {
  const huecos = new Map<string, number>()
  for (const login of logins) {
    const known = previous.get(login)
    if (known !== undefined) huecos.set(login, known)
  }
  for (const login of logins) {
    if (huecos.has(login)) continue
    let free = 0
    while ([...huecos.values()].includes(free)) free++
    huecos.set(login, free)
  }
  return huecos
}

// Los huecos de la última cuadrícula de esta página. Un canal que se ve solo sigue en el suyo: es el mismo reproductor,
// y al volver no debe pisar el del que se ha quedado con el principal.
let huecos: ReadonlyMap<string, number> = new Map()
export const huecoOf = (login: string): number => huecos.get(login) ?? 0
export const placeInHuecos = (logins: readonly string[]): void => {
  huecos = assignHuecos(logins, huecos)
}
