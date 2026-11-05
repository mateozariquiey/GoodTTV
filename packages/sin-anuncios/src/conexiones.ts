// La primera apertura se va casi toda en DNS: gql, usher y los hosts de las listas tienen TTL 0 y cada uno tarda ~310 ms en
// resolver, uno detrás de otro, y una conexión ociosa dura entre 30 y 60 s (D39). Así que se abren por adelantado, con un
// HEAD cuya respuesta no importa (un 400, 403 o 404 también dejan la conexión hecha): al abrir la página, y al abrir un
// canal, en paralelo a gql, las que va a usar después. Los hosts de las listas se recuerdan de otras veces: son unos
// pocos por región. Como con el de los fragmentos (D37), va por la misma red que las peticiones de verdad.
export type Red = (input: string, init: RequestInit) => Promise<unknown>
export type AlmacenHosts = Pick<Storage, "getItem" | "setItem">

const GQL = "gql.twitch.tv"
const USHER = "usher.ttvnw.net"
const LIST_HOST = /^[a-z0-9-]+\.playlist\.ttvnw\.net$/
const MAX_LIST_HOSTS = 3
const KEY = "goodttv-hosts-listas"
export const FRESH_MS = 30_000 // una conexión usada hace menos de esto sigue abierta (medido: 30 s sí, 60 s no)

const pageStorage = (): AlmacenHosts | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null // sin acceso (la tele no tiene): solo los de esta sesión
  }
}

const load = (store: AlmacenHosts | null): string[] => {
  try {
    const saved: unknown = JSON.parse(store?.getItem(KEY) ?? "[]")
    return Array.isArray(saved)
      ? saved
          .filter((host) => typeof host === "string" && LIST_HOST.test(host))
          .slice(0, MAX_LIST_HOSTS)
      : []
  } catch {
    return []
  }
}

export const createConexiones = (
  red: Red,
  store: AlmacenHosts | null = pageStorage(),
  now: () => number = Date.now,
) => {
  const used = new Map<string, number>()
  let listHosts = load(store)
  return {
    // Las conexiones que probablemente harán falta y ya no estén abiertas. Con gql, solo si no se va a pedir ya (al abrir
    // un canal se pide a la vez, y el HEAD no adelantaría nada).
    abrir: ({ gql = false }: { readonly gql?: boolean } = {}): void => {
      const time = now()
      for (const host of [...(gql ? [GQL] : []), USHER, ...listHosts]) {
        if (time - (used.get(host) ?? -Infinity) < FRESH_MS) continue
        used.set(host, time)
        void red(`https://${host}/`, {
          method: "HEAD",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        }).catch(() => undefined)
      }
    },
    // La lista de una sesión ya abierta: su host es el que hay que recordar para la próxima.
    listaAbierta: (url: string): void => {
      let host: string
      try {
        host = new URL(url).host
      } catch {
        return
      }
      if (!LIST_HOST.test(host)) return
      used.set(host, now())
      if (listHosts[0] === host) return
      listHosts = [host, ...listHosts.filter((other) => other !== host)].slice(0, MAX_LIST_HOSTS)
      try {
        store?.setItem(KEY, JSON.stringify(listHosts))
      } catch {
        // Sin espacio: se recuerda solo en esta sesión.
      }
    },
  }
}
