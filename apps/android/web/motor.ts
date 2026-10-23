// Motor del directo sin anuncios para Media3 (ReproductorActivity.kt): @goodttv/sin-anuncios en una WebView sin
// mostrar, sin reproductor ni interfaz. La app le pasa cada petición de Media3 a /stream/ por mensajes
// (addWebMessageListener de androidx.webkit, Motor.kt) y la página contesta con lo que da directo.handle(): la cabecera
// en texto, el cuerpo en ArrayBuffer a trozos y el final. Si Media3 cancela, la app lo avisa y se aborta su AbortSignal.
// La red de Twitch, como en pagina.tsx (red-nativa.ts).
//   motor.html[?registro][&pausa=cada,duración[,arranque]]
// Con ?registro envía a la app los eventos del empalme, solo con los campos que se pueden guardar (lab.ts), y cada 30 s
// el peor retraso de un temporizador de 1 s (el empalme sondea cada 2 s: no debe frenarse por estar oculta).
import { createDirecto, type EmpalmeEvent, parseSimulatedPause } from "@goodttv/sin-anuncios"
import { createRedNativa } from "./red-nativa"

// Lo que inyecta Motor.kt (WebViewCompat.addWebMessageListener).
type Puente = {
  postMessage(message: string | ArrayBuffer): void
  addEventListener(type: "message", listener: (event: MessageEvent<string>) => void): void
}
const puente = (globalThis as { GoodTTVMotor?: Puente }).GoodTTVMotor
if (puente === undefined) throw new TypeError("Falta el puente con la app (GoodTTVMotor)")

// Lo que pide la app: una petición a /stream/ o cancelar una que no ha terminado.
type Pedido =
  | { readonly id: number; readonly ruta: string; readonly rango: string | null }
  | { readonly id: number; readonly cancelar: true }

// Campos del empalme que se pueden guardar, los mismos que apps/navegador/src/lab.ts (importarlo metería hls.js en esta
// página): los errores y las URL pueden llevar el token de Twitch.
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
const safeEvent = (event: EmpalmeEvent): Record<string, unknown> => ({
  s: Math.round(performance.now() / 100) / 10,
  ...Object.fromEntries(Object.entries(event).filter(([name]) => SAFE_FIELDS.has(name))),
})

const enviar = (message: object): void => puente.postMessage(JSON.stringify(message))

const params = new URLSearchParams(location.search)
const registro = params.has("registro")
const directo = createDirecto({
  fetch: createRedNativa(globalThis.fetch.bind(globalThis), location.origin, false),
  log: registro ? (event) => enviar({ registro: safeEvent(event) }) : () => undefined,
  simulatedPause: parseSimulatedPause(params.get("pausa") ?? ""),
})

// Cada trozo del cuerpo va en un ArrayBuffer con el número de la petición delante (4 bytes), de TROZO bytes como mucho:
// un trozo del VOD recortado sale de la memoria entero, de varios MB.
const TROZO = 256 * 1024
const enviarTrozo = (id: number, bytes: Uint8Array): void => {
  for (let at = 0; at < bytes.length; at += TROZO) {
    const part = bytes.subarray(at, at + TROZO)
    const message = new Uint8Array(4 + part.length)
    new DataView(message.buffer).setUint32(0, id)
    message.set(part, 4)
    puente.postMessage(message.buffer)
  }
}

// Media3 sitúa cada lista en el tiempo por la hora (PDT) de su primer fragmento, y el origen del periodo, por la de la
// primera lista que recibe. Si esa no trae hora, el origen queda en 1970 y, cuando llega el directo con su hora, coloca
// los fragmentos nuevos 56 años más adelante y se queda esperando (DefaultHlsPlaylistTracker,
// HlsMediaSource.createTimelineForLive). El empalme ya da hora a los trozos del VOD al arrancar desde él (vodHour), pero
// sin la de la lista del VOD es aproximada (~2 s), y tampoco casa si el empalme se salta contenido: un salto en la hora
// movería la línea de tiempo de Media3. Así que el primer fragmento de cada lista lleva la hora que le toca contando
// duraciones desde la primera lista de la visita, que es la del empalme o, si no hay ninguna, ahora menos lo que dura la
// lista. Contar duraciones da una línea de tiempo sin saltos, pero se separa de la hora real lo que se salte.
// Por visita: inicio (ms desde 1970) y duración (ms) de cada fragmento visto.
const horas = new Map<string, Map<number, { inicio: number; duracion: number }>>()

const conHora = (url: URL, texto: string): string => {
  const lineas = texto.split("\n")
  const primero = Number(lineas.find((l) => l.startsWith("#EXT-X-MEDIA-SEQUENCE:"))?.slice(22) ?? 0)
  const fragmentos: {
    n: number
    duracion: number
    pdt: number | null
    linea: number
    vod: boolean
  }[] = []
  let duracion = 0
  let pdt: number | null = null
  lineas.forEach((linea, i) => {
    if (linea.startsWith("#EXTINF:")) duracion = Number.parseFloat(linea.slice(8))
    else if (linea.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) pdt = Date.parse(linea.slice(25))
    else if (linea !== "" && !linea.startsWith("#")) {
      fragmentos.push({
        duracion,
        linea: i,
        n: primero + fragmentos.length,
        pdt,
        vod: linea.includes("/stream/vod"),
      })
      duracion = 0
      pdt = null
    }
  })
  const [cabeza] = fragmentos
  if (cabeza === undefined) return texto
  const clave = `${url.pathname}?${url.searchParams.get("visita")}`
  const vistos = horas.get(clave) ?? new Map<number, { inicio: number; duracion: number }>()
  horas.set(clave, vistos)
  // La cabeza: la que ya tenía; si no, el final del fragmento anterior (listas seguidas que no se solapan); y si tampoco
  // (primera lista, o un hueco sin recargas), desde la primera hora de Twitch hacia atrás o, sin ninguna, ahora menos lo
  // que dura la lista. Tras un hueco la hora puede saltar: no hay con qué contar los fragmentos que no se vieron.
  if (!vistos.has(cabeza.n)) {
    const previo = vistos.get(cabeza.n - 1)
    const k = fragmentos.findIndex((f) => f.pdt !== null)
    const antes =
      fragmentos.slice(0, k === -1 ? undefined : k).reduce((suma, f) => suma + f.duracion, 0) * 1000
    const inicio =
      previo === undefined
        ? (fragmentos[k]?.pdt ?? Date.now()) - antes
        : previo.inicio + previo.duracion
    vistos.set(cabeza.n, { duracion: cabeza.duracion * 1000, inicio })
  }
  for (const [i, f] of fragmentos.entries()) {
    const anterior = fragmentos[i - 1]
    const desde = anterior === undefined ? undefined : vistos.get(anterior.n)
    if (desde === undefined || vistos.has(f.n)) continue
    const inicio = desde.inicio + desde.duracion
    vistos.set(f.n, { duracion: f.duracion * 1000, inicio })
    // Para el informe: cuánto se separa la hora contada de la de Twitch en el primer fragmento del directo tras el VOD.
    if (registro && f.pdt !== null && anterior?.vod === true && !f.vod) {
      enviar({ registro: { ev: "hora", desfaseS: Math.round(f.pdt - inicio) / 1000 } })
    }
  }
  for (const n of vistos.keys()) if (n < cabeza.n) vistos.delete(n)
  const inicio = vistos.get(cabeza.n)?.inicio
  if (inicio === undefined) return texto
  const resto = lineas
    .slice(0, cabeza.linea - 1)
    .filter((l) => !l.startsWith("#EXT-X-PROGRAM-DATE-TIME:"))
  return [
    ...resto,
    `#EXT-X-PROGRAM-DATE-TIME:${new Date(inicio).toISOString()}`,
    ...lineas.slice(cabeza.linea - 1),
  ].join("\n")
}

const enCurso = new Map<number, AbortController>()

// El directo atiende un canal cada vez: una petición de otro canal para el empalme y crea otro. Para el informe, cada
// vez que las peticiones cambian de canal (al abrir uno debería haber un solo cambio).
let ultimoCanal: string | null = null
const anotarCanal = (url: URL): void => {
  const [, raiz, canal] = url.pathname.split("/")
  if (raiz !== "stream" || canal === undefined || canal === "vod" || canal === ultimoCanal) return
  if (registro) enviar({ registro: { a: canal, de: ultimoCanal, ev: "cambio-canal" } })
  ultimoCanal = canal
}

const atender = async (id: number, ruta: string, rango: string | null): Promise<void> => {
  const abort = new AbortController()
  const { signal } = abort
  enCurso.set(id, abort)
  const inicio = performance.now()
  try {
    const url = new URL(ruta, location.origin)
    anotarCanal(url)
    let response = await directo.handle(url, { range: rango, signal })
    const cabecera = performance.now() - inicio
    if (response.ok && url.pathname.endsWith("/live.m3u8")) {
      const headers = new Headers(response.headers)
      headers.delete("content-length")
      response = new Response(conHora(url, await response.text()), {
        headers,
        status: response.status,
      })
    }
    if (signal.aborted) {
      void response.body?.cancel()
      return
    }
    const length = response.headers.get("content-length")
    enviar({ estado: response.status, id, longitud: length === null ? null : Number(length) })
    const reader = response.body?.getReader()
    let bytes = 0
    if (reader !== undefined) {
      signal.addEventListener("abort", () => void reader.cancel().catch(() => undefined), {
        once: true,
      })
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        enviarTrozo(id, chunk.value)
        bytes += chunk.value.length
      }
    }
    if (!signal.aborted) enviar({ fin: true, id })
    // Para el informe: cuánto tarda la página en tener y en enviar cada trozo del VOD (el resto es el puente).
    if (registro && url.pathname === "/stream/vod") {
      const total = Math.round(performance.now() - inicio)
      enviar({
        registro: { bytes, ev: "vod-servido", msCabecera: Math.round(cabecera), msTotal: total },
      })
    }
  } catch (error) {
    // Solo el tipo: el mensaje podría llevar una URL de Twitch.
    if (!signal.aborted) enviar({ fallo: error instanceof Error ? error.name : "Error", id })
  } finally {
    enCurso.delete(id)
  }
}

puente.addEventListener("message", ({ data }) => {
  const pedido = JSON.parse(data) as Pedido
  if ("cancelar" in pedido) enCurso.get(pedido.id)?.abort()
  else void atender(pedido.id, pedido.ruta, pedido.rango)
})

if (registro) {
  let last = performance.now()
  let worst = 0
  let ticks = 0
  setInterval(() => {
    const now = performance.now()
    worst = Math.max(worst, now - last - 1000)
    last = now
    if (++ticks % 30 === 0) {
      enviar({
        temporizador: { peorRetrasoMs: Math.round(worst), visible: document.visibilityState },
      })
      worst = 0
    }
  }, 1000)
}

// Con este mensaje la app sabe a quién contestar (el JavaScriptReplyProxy de esta página).
enviar({ listo: true, visible: document.visibilityState })
