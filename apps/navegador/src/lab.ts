import type { AppApi, ChatBatch, ChatEvent, ChatMessage } from "@goodttv/contratos"
import {
  type ChatFragment,
  EmoteCatalog,
  type EmoteLookup,
  readableUserColor,
  tokenizeFragments,
} from "@goodttv/servicios"
import { type DirectoOptions, type EmpalmeEvent, parseSimulatedPause } from "@goodttv/sin-anuncios"
import Hls from "hls.js"
import { parseRoute } from "./escritorio/routes"

// Lo del laboratorio en las páginas de la extensión, por la dirección (como GOODTTV_PAUSA_SIMULADA y
// GOODTTV_REGISTRO_EMPALME en la tele): ?pausa=cada,duración[,arranque] simula pausas globales para probar el relleno
// con el VOD, y ?registro guarda los eventos del empalme en window.registroEmpalme para las pruebas. Con ?registro,
// además, la prueba de rendimiento lee el hls.js del reproductor (window.hlsPrueba) y sus hitos de arranque
// (window.marcasPrueba). ?sinred: comprobar la cuenta falla como sin red hasta que la prueba ponga
// window.redPrueba = true, o hasta cerrar sesión (sin sesión no hace falta la red); desde entonces, lo que diga la
// cuenta de verdad (EXT-4).

// Campos del empalme que se pueden guardar (los mismos que registra la tele, más los de nueva-numeracion): los
// errores y las URL pueden llevar el token de Twitch.
const SAFE_FIELDS = new Set([
  "ahora",
  "antes",
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
])

export type SafeEvent = Readonly<Record<string, unknown>> & { readonly s: number }

// El evento sin lo que no se puede guardar, con los segundos desde que se abrió la página.
export const safeEvent = (event: EmpalmeEvent): SafeEvent => ({
  s: Math.round(performance.now() / 100) / 10,
  ...Object.fromEntries(Object.entries(event).filter(([name]) => SAFE_FIELDS.has(name))),
})

// Hitos del arranque de cada reproductor, en ms desde que se abrió la página: lista, primer fragmento pedido, cargado y
// en el búfer. Los del <video> (primer fotograma, reproduciendo) los toma la prueba.
const HLS_MARKS = [
  [Hls.Events.MANIFEST_LOADED, "lista"],
  [Hls.Events.FRAG_LOADING, "fragmento-pedido"],
  [Hls.Events.FRAG_LOADED, "fragmento-cargado"],
  [Hls.Events.FRAG_BUFFERED, "fragmento-en-bufer"],
] as const

const instrumentHls = (): void => {
  const marks: { readonly ev: string; readonly ms: number }[] = []
  Object.assign(globalThis, { marcasPrueba: marks })
  const loadSource = Hls.prototype.loadSource
  Hls.prototype.loadSource = function (this: Hls, url: string): void {
    Object.assign(globalThis, { hlsPrueba: this })
    marks.push({ ev: "reproductor", ms: performance.now() })
    for (const [event, name] of HLS_MARKS) {
      this.once(event, () => marks.push({ ev: name, ms: performance.now() }))
    }
    loadSource.call(this, url)
  }
}

export const labOptions = (search: string): Pick<DirectoOptions, "log" | "simulatedPause"> => {
  const params = new URLSearchParams(search)
  const events: SafeEvent[] = []
  if (params.has("registro")) {
    Object.assign(globalThis, { registroEmpalme: events })
    instrumentHls()
  }
  return {
    log: params.has("registro") ? (event) => events.push(safeEvent(event)) : () => undefined,
    simulatedPause: parseSimulatedPause(params.get("pausa") ?? ""),
  }
}

// Chat del laboratorio, para medir lo que cuesta pintarlo sin una cuenta de verdad: una cuenta ficticia y una fuente
// de mensajes que llegan en lotes cada 100 ms, como los de EventSub. El resto de la API no cambia; lo que pida la
// cuenta a Twitch falla como sin sesión, y no se guardan recientes: los datos ficticios del canal (su id) se quedarían
// en ellos y, ya sin parámetros, el chat se abriría para otro canal.
//   ?chatsintetico=N  N mensajes por segundo, con emotes e insignias de Twitch
//   ?chatreal         el chat real del canal abierto, leído por IRC anónimo, con sus emotes de Twitch, 7TV, BTTV y
//                     FFZ (los mismos tokenizador y catálogo que la app)
type ChatSource = (login: string, emit: (events: ChatEvent[]) => void) => () => void

const EMOTES = [25, 354, 1902, 41, 425618, 305954156].map((id) => ({
  height: 28,
  name: `emote${id}`,
  provider: "twitch" as const,
  url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`,
  width: 28,
  zeroWidth: false,
}))
const BADGE = {
  title: "Suscriptor",
  url: "https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/2",
}

const syntheticSource =
  (perSecond: number): ChatSource =>
  (_login, emit) => {
    let next = 0
    const message = (): ChatMessage => {
      const n = next++
      const emote = EMOTES[n % EMOTES.length] ?? EMOTES[0]
      return {
        action: false,
        badges: n % 3 === 0 ? [BADGE] : [],
        color: `#${((n * 2654435761) % 0xffffff).toString(16).padStart(6, "0")}`,
        displayName: `espectador${n % 500}`,
        id: `m${n}`,
        tokens: [
          { kind: "text", text: `mensaje número ${n} con algo de texto ` },
          ...(emote === undefined ? [] : [{ emote, kind: "emote" as const, overlays: [] }]),
          { kind: "text", text: " y un poco más" },
        ],
        userId: String(1000 + (n % 500)),
      }
    }
    let owed = 0
    const timer = setInterval(() => {
      owed += perSecond / 10
      const count = Math.floor(owed)
      owed -= count
      if (count > 0)
        emit(Array.from({ length: count }, () => ({ kind: "message", message: message() })))
    }, 100)
    return () => clearInterval(timer)
  }

type IrcLine = {
  readonly command: string
  readonly prefix: string
  readonly tags: Readonly<Record<string, string>>
  readonly trailing: string
}

const parseIrc = (line: string): IrcLine => {
  let rest = line
  const tags: Record<string, string> = {}
  if (rest.startsWith("@")) {
    const space = rest.indexOf(" ")
    for (const pair of rest.slice(1, space).split(";")) {
      const equals = pair.indexOf("=")
      tags[pair.slice(0, equals)] = pair.slice(equals + 1)
    }
    rest = rest.slice(space + 1)
  }
  let prefix = ""
  if (rest.startsWith(":")) {
    const space = rest.indexOf(" ")
    prefix = rest.slice(1, space)
    rest = rest.slice(space + 1)
  }
  const colon = rest.indexOf(" :")
  return {
    command: (colon >= 0 ? rest.slice(0, colon) : rest).split(" ")[0] ?? "",
    prefix,
    tags,
    trailing: colon >= 0 ? rest.slice(colon + 2) : "",
  }
}

// El texto partido en trozos de texto y emotes de Twitch, según la etiqueta «emotes» (posiciones en caracteres).
const fragmentsOf = (text: string, emotes: string): ChatFragment[] => {
  const chars = Array.from(text)
  const ranges = emotes
    .split("/")
    .filter((part) => part !== "")
    .flatMap((part) => {
      const [id = "", spans = ""] = part.split(":")
      return spans.split(",").map((span) => {
        const [start = Number.NaN, end = Number.NaN] = span.split("-").map(Number)
        return { end, id, start }
      })
    })
    .filter((range) => Number.isInteger(range.start) && Number.isInteger(range.end))
    .sort((a, b) => a.start - b.start)
  const fragments: ChatFragment[] = []
  let at = 0
  for (const { end, id, start } of ranges) {
    if (start < at) continue
    if (start > at) fragments.push({ text: chars.slice(at, start).join(""), type: "text" })
    fragments.push({ emote: { id }, text: chars.slice(start, end + 1).join(""), type: "emote" })
    at = end + 1
  }
  if (at < chars.length) fragments.push({ text: chars.slice(at).join(""), type: "text" })
  return fragments
}

const ircSource: ChatSource = (login, emit) => {
  const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443")
  const catalog = new EmoteCatalog()
  let emotes: EmoteLookup = new Map()
  const pending: ChatEvent[] = []
  socket.addEventListener("open", () => {
    socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands")
    socket.send("PASS SCHMOOPIIE")
    socket.send(`NICK justinfan${1000 + Math.floor(Math.random() * 80_000)}`)
    socket.send(`JOIN #${login}`)
  })
  socket.addEventListener("message", (event) => {
    for (const line of String(event.data).split("\r\n")) {
      if (line === "") continue
      if (line.startsWith("PING")) {
        socket.send("PONG :tmi.twitch.tv")
        continue
      }
      const { command, prefix, tags, trailing } = parseIrc(line)
      const room = tags["room-id"]
      if (command === "ROOMSTATE" && room !== undefined) {
        void catalog.forChannel(room).then((lookup) => {
          emotes = lookup
        })
      }
      if (command !== "PRIVMSG") continue
      const action = trailing.startsWith("\u0001ACTION ")
      const text = action ? trailing.slice(8, -1) : trailing
      const userId = (tags["user-id"] || "0").slice(0, 64)
      pending.push({
        kind: "message",
        message: {
          action,
          badges: (tags["badges"] ?? "").includes("subscriber") ? [BADGE] : [],
          color: readableUserColor(tags["color"] ?? "", userId),
          displayName: (tags["display-name"] || prefix.split("!")[0] || "anónimo").slice(0, 60),
          id: (tags["id"] || crypto.randomUUID()).slice(0, 64),
          tokens: tokenizeFragments(fragmentsOf(text, tags["emotes"] ?? ""), emotes).slice(0, 600),
          userId,
        },
      })
    }
  })
  const timer = setInterval(() => {
    if (pending.length > 0) emit(pending.splice(0, 500))
  }, 100)
  return () => {
    clearInterval(timer)
    socket.close()
  }
}

const withoutNetwork = (api: AppApi): AppApi => {
  let signedOut = false
  return {
    ...api,
    auth: {
      ...api.auth,
      logout: async () => {
        await api.auth.logout()
        signedOut = true
      },
      snapshot: () =>
        signedOut || (globalThis as { redPrueba?: boolean }).redPrueba === true
          ? api.auth.snapshot()
          : Promise.reject(new TypeError("Failed to fetch")),
    },
  }
}

export const labApi = (base: AppApi, search: string): AppApi => {
  const params = new URLSearchParams(search)
  const api = params.has("sinred") ? withoutNetwork(base) : base
  const perSecond = Number(params.get("chatsintetico") ?? 0)
  const source =
    perSecond > 0 ? syntheticSource(perSecond) : params.has("chatreal") ? ircSource : null
  if (source === null) return api
  const listeners = new Set<(batch: ChatBatch) => void>()
  const emit = (batch: ChatBatch): void => {
    for (const listener of listeners) listener(batch)
  }
  let stop = (): void => undefined
  return {
    ...api,
    auth: {
      ...api.auth,
      snapshot: async () => ({ displayName: "Prueba", kind: "authenticated", login: "prueba" }),
    },
    catalog: {
      ...api.catalog,
      streamsByLogin: async (logins) =>
        logins.map((each) => ({
          category: "Prueba",
          id: "1",
          startedAt: new Date().toISOString(),
          tags: [],
          thumbnailUrl:
            "https://static-cdn.jtvnw.net/previews-ttv/live_user_x-{width}x{height}.jpg",
          title: "Chat del laboratorio",
          userId: "1",
          userLogin: each,
          userName: each,
          viewerCount: 1,
        })),
    },
    chat: {
      close: async () => {
        stop()
        stop = () => undefined
      },
      onBatch: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      // El chat del canal abierto, que es el de la dirección: el id que llega puede ser el ficticio.
      open: async () => {
        stop()
        stop = () => undefined
        const route = parseRoute(location.hash)
        if (route.view === "channel") {
          setTimeout(
            () => emit({ events: [{ kind: "status", status: "connected" }], session: 1 }),
            0,
          )
          stop = source(route.login, (events) => emit({ events, session: 1 }))
        }
        return 1
      },
    },
    recents: { ...api.recents, add: () => api.recents.list() },
  }
}
