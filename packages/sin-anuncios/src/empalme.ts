// Empalme: mantiene varias sesiones de invitado de Twitch del mismo canal (playerType distintos), que reciben los
// anuncios por separado, y publica una lista HLS propia con, para cada fragmento, la versión en directo de cualquiera
// de ellas. Cuando todas están en anuncio a la vez («pausa global»), rellena el hueco con el VOD que Twitch graba del
// directo, que no lleva anuncios. Investigación privada: docs/decisiones.md (D11).
import { unwrap } from "./media-time"
import { type MediaSegment, parseMedia, type Want } from "./playlist"
import {
  deviceId,
  type Fetch,
  getText,
  NotLiveError,
  type OpenedVariant,
  openVariant,
  probeTime,
  Vod,
  type VodSegment,
  type VodSource,
  vodHour,
} from "./twitch-source"

const POLL_MS = 2000
// Sesiones de invitado por defecto, por orden de preferencia. mobile_feed@android va la última, de respaldo: en las
// cuatro pausas globales de un vigía de 100 min (16-44 s, con anuncio en site, embed y popout a la vez) siguió dando el
// directo, y no tuvo ningún anuncio en ~5000 sondeos de 6 canales (12 oct, D16). Da 1080p60 y los mismos fragmentos
// que las demás.
const SOURCES = ["site", "embed", "popout", "mobile_feed@android"]
const STALL_MS = 20_000 // una lista que no avanza en este tiempo (fin o reinicio de la emisión) se vuelve a abrir
const VOD_RETURN_WAIT_MS = 25_000 // al volver del relleno, cuánto se espera al VOD antes de saltarse lo que falte
// Con el directo por delante del cursor, cuánto se espera en total a que el VOD llegue a él, aunque siga creciendo
// (un VOD muy atrasado no alcanzaría nunca el directo que se conserva).
const RETURN_AHEAD_MAX_MS = 45_000
const VOD_TARGET = 13 // TARGETDURATION fija con relleno: cubre los trozos del VOD (hasta 12,5 s) y no cambia
// Segundos que abarca la lista publicada. Más de lo que el reproductor deja quedarse atrás antes de saltar al directo
// (liveMaxLatencyDuration en useHlsPlayer.ts: 84 s en el modo sin paradas). Si la posición se sale de la lista, hls.js
// la recoloca a saltos; con 20 fragmentos (40 s), bastaba con que se sumaran 16 s al margen de 24 s (una pausa de la
// persona, una parada). Los fragmentos en directo de Twitch se siguen pudiendo descargar minutos después.
const WINDOW_SECONDS = 100

type SessionState = "abriendo" | "abierta" | "anuncio" | "directo" | "error"

type LiveEntry = MediaSegment & { readonly index: number }

type Session = {
  readonly device: string
  readonly priority: number
  readonly type: string
  ads: number
  backoff: number
  changedAt: number
  live: Map<number, LiveEntry>
  lastSeq: number | null
  liveEdge: number | null
  offset: number | null
  retryAt: number
  state: SessionState
  url: string | null
}

export type Published = {
  readonly discontinuity: boolean
  readonly duration: number
  readonly from: number | null // trozo del VOD recortado: tiempo de contenido donde empieza
  readonly map: string | null
  readonly n: number
  readonly pdt: string | null
  readonly seq: number | null // índice común; null en los trozos del VOD
  readonly source: string
  readonly url: string
}

type Fill = {
  readonly alive: () => boolean
  readonly since: number
  anchor: { readonly pdtMs: number; readonly time: number }
  cursor: number
  lastVodAt: number
  aheadSince: number | null // desde cuándo hay directo por delante del cursor
  probed: { readonly index: number; readonly time: number } | null
  published: number
  vodOffset: number | null
}

export type EmpalmeEvent = { readonly ev: string } & Record<string, unknown>

export type EmpalmeOptions = {
  readonly channel: string
  readonly sources?: readonly string[]
  readonly want?: Want | null
  // Por dónde se pide a Twitch (en Android, la red nativa); si no, el fetch global.
  readonly fetch?: Fetch
  // Red, sustituible en las pruebas.
  readonly fetchPlaylist?: (url: string) => Promise<string>
  readonly openSession?: (
    channel: string,
    playerType: string,
    device: string,
    want: Want | null,
  ) => Promise<OpenedVariant>
  readonly probe?: (url: string, map: string | null) => Promise<number>
  readonly vodSource?: VodSource | null // fijo (pruebas); si no, se busca el VOD del canal
  readonly vod?: boolean
  // Recorta un trozo del VOD y devuelve dónde empieza de verdad (o null si no se puede). Solo se publica un trozo
  // recortado cuando ya está comprobado.
  readonly vodTrimmer?:
    | ((url: string, from: number, map: string | null) => Promise<number | null>)
    | null
  // Cómo se publica la URL de un trozo del VOD (el renderer no puede pedirlo a Twitch: no trae CORS).
  readonly vodUrl?: (url: string, from: number | null, map: string | null) => string
  readonly fillPollMs?: number
  readonly returnAheadMaxMs?: number
  readonly log?: (event: EmpalmeEvent) => void
  // La lista de variante de una sesión recién abierta (conexiones.ts).
  readonly onListOpened?: (url: string) => void
  // Solo para probar a demanda (GOODTTV_PAUSA_SIMULADA): cada «every» s, «length» s en que todas las sesiones se
  // tratan como en anuncio, para ver y oír el relleno con el VOD sin esperar una pausa global real.
  // Pruebas: pausas globales simuladas cada `every` s (0: ninguna periódica) y, con atStart, una al arrancar.
  readonly simulatedPause?: {
    readonly every: number
    readonly length: number
    readonly atStart?: boolean
  } | null
  // Holgura (s) por encima de un trozo del VOD antes de soltar el primero de un relleno (ver fillFromVod); null:
  // sin holgura (el reproductor ya va con margen, como en el modo sin paradas).
  readonly fillSlack?: number | null
  // Cuánto por detrás del borde empieza a publicar: por defecto, 3 fragmentos; en el modo sin paradas, segundos.
  readonly startBackSeconds?: number | null
}

export type EmpalmeStatus = {
  readonly offline: boolean
  readonly published: number
  readonly qualities: readonly { readonly id: string; readonly label: string }[]
  // La pedida (o la que fijó la primera sesión): con ella se compara una petición nueva, para no recrear el empalme.
  readonly quality: string | null
  // La que suena: otra si el canal no tiene la pedida (la de reserva de openVariant). La que enseña el menú.
  readonly playing: string | null
  // Publicando trozos del VOD (pausa global o arranque con todas las sesiones en anuncio): quien empiece a leer
  // ahora necesita más margen, porque el VOD crece a saltos de ~10 s.
  readonly filling: boolean
  readonly vodFills: number
}

const wantId = (want: Want): string => `${want.resolution}@${want.fps}`
// Los BROADCAST-ID de Twitch son números que crecen con cada emisión (se comparan como texto: pueden ser largos).
const olderBroadcast = (id: string, than: string): boolean =>
  /^\d+$/.test(id) &&
  /^\d+$/.test(than) &&
  (id.length < than.length || (id.length === than.length && id < than))
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

export class Empalme {
  readonly channel: string
  private readonly sessions: Session[]
  private readonly red: Fetch | undefined
  private readonly warmedHosts = new Set<string>()
  private readonly fetchPlaylist: (url: string) => Promise<string>
  private readonly openSession: NonNullable<EmpalmeOptions["openSession"]>
  private readonly probe: (url: string, map: string | null) => Promise<number>
  private readonly vodWanted: boolean
  private readonly vodInjected: boolean
  private readonly vodTrimmer: EmpalmeOptions["vodTrimmer"]
  private readonly vodUrl: (url: string, from: number | null, map: string | null) => string
  private readonly fillPollMs: number
  private readonly returnAheadMaxMs: number
  private readonly log: (event: EmpalmeEvent) => void
  private readonly onListOpened: NonNullable<EmpalmeOptions["onListOpened"]>
  private want: Want | null
  private playing: Want | null = null
  private qualities: readonly { readonly id: string; readonly label: string }[] = []
  private vodSource: VodSource | null
  private vodOpening = false
  private vodRetryAt = 0
  private fillErrorAt = 0
  private generation = 0 // cambia con cada reinicio de la línea de tiempo; lo pedido o empezado antes se descarta
  private broadcastId: string | null = null
  private targetDuration = 0
  private filling: Fill | null = null
  private pendingDiscontinuity = false
  private nextSeq: number | null = null // siguiente índice común por publicar
  private discontinuities = 0
  private readonly out: Published[] = []
  private readonly urls = new Map<
    number,
    { readonly host: string; readonly path: string; readonly type: string }
  >()
  private readonly published = new Map<number, string>()
  // Reloj común: el PDT de cada sesión se desplaza con sus anuncios y deriva algo incluso sin ellos; se mide cada
  // sesión contra una de referencia sobre el mismo índice (encadenar medidas hace que se corrijan sin fin), que solo
  // cambia si su reloj se mueve o se queda solo (moveClockRef).
  private readonly clock = new Map<string, number>()
  private clockRef: string | null = null
  private readonly refPdt = new Map<number, number>()
  private readonly skippedSeqs = new Set<number>()
  private readonly waiters = new Set<() => void>()
  private readonly vodUrls = new Set<string>() // URL del VOD publicadas: lo único que se acepta servir
  private readonly timers = new Set<ReturnType<typeof setTimeout>>() // solo los pendientes
  private stopped = false
  // Sesiones que no han podido abrir desde la última que abrió: si son todas, el canal no emite. Por sesión y no por
  // intento, porque se abren a la vez y una puede reintentar antes de que otra termine de abrir.
  private readonly failedOpens = new Set<string>()
  private readonly simulatedPause: {
    readonly every: number
    readonly length: number
    readonly atStart?: boolean
  } | null
  private simulatedPauseUntil = 0
  private readonly fillSlack: number | null
  private readonly startBackSeconds: number | null
  private vodFills = 0
  private visitFills = 0 // rellenos desde que empezó la visita actual del reproductor (newVisit)
  private startedAt = Date.now() // origen de las fases de consulta de las sesiones

  constructor(options: EmpalmeOptions) {
    this.channel = options.channel
    this.sessions = (options.sources ?? SOURCES).map((type, priority) => ({
      ads: 0,
      backoff: 0,
      changedAt: Date.now(),
      device: deviceId(),
      lastSeq: null,
      live: new Map(),
      liveEdge: null,
      offset: null,
      priority,
      retryAt: 0,
      state: "abriendo",
      type,
      url: null,
    }))
    this.want = options.want ?? null
    const red = options.fetch
    this.red = red
    this.fetchPlaylist = options.fetchPlaylist ?? ((url) => getText(url, {}, red))
    this.onListOpened = options.onListOpened ?? (() => undefined)
    this.openSession =
      options.openSession ??
      ((channel, playerType, device, want) => openVariant(channel, playerType, device, want, red))
    this.probe = options.probe ?? ((url, map) => probeTime(url, map, red))
    this.vodSource = options.vodSource ?? null
    this.vodInjected = options.vodSource != null
    this.vodWanted = options.vod === true || this.vodInjected
    this.vodTrimmer = options.vodTrimmer ?? null
    this.vodUrl = options.vodUrl ?? ((url) => url)
    this.fillPollMs = options.fillPollMs ?? 500
    this.returnAheadMaxMs = options.returnAheadMaxMs ?? RETURN_AHEAD_MAX_MS
    this.log = options.log ?? (() => undefined)
    this.simulatedPause = options.simulatedPause ?? null
    this.fillSlack = options.fillSlack === undefined ? 2 : options.fillSlack
    this.startBackSeconds = options.startBackSeconds ?? null
  }

  async start(): Promise<void> {
    const pause = this.simulatedPause
    if (pause?.atStart === true) {
      this.simulatedPauseUntil = Date.now() + pause.length * 1000
      this.log({ ev: "pausa-simulada", segundos: pause.length })
    }
    // Todas las sesiones se abren a la vez y cada una empieza a sondear en cuanto abre: publica la primera que dé
    // directo, sin esperar a las demás (cualquiera puede traer un anuncio de entrada). Sin calidad pedida, la fija la
    // primera que abre (ver open).
    this.startedAt = Date.now()
    await Promise.all(
      this.sessions.map(async (session) => {
        await this.open(session)
        if (!this.stopped) this.loop(session) // si se paró mientras abría (otro canal, modo o calidad), nada
      }),
    )
    if (this.stopped) return
    if (pause !== null && pause.every > 0) {
      const timer = setInterval(() => {
        this.simulatedPauseUntil = Date.now() + pause.length * 1000
        this.log({ ev: "pausa-simulada", segundos: pause.length })
      }, pause.every * 1000)
      this.timers.add(timer)
    }
  }

  // Otro reproductor empieza a leer este empalme (se volvió al canal antes de que se parase): arranca con el margen
  // corto, así que el próximo relleno vuelve a ser el primero de la visita.
  newVisit(): void {
    this.visitFills = 0
  }

  stop(): void {
    this.stopped = true
    this.filling = null
    for (const timer of this.timers) clearTimeout(timer) // también vale para setInterval
    this.notify()
  }

  // Estado para la interfaz: si el canal no emite, calidades disponibles y la elegida.
  status(): EmpalmeStatus {
    return {
      // También con lo publicado: al terminar la emisión, quien vuelve a preguntar debe saber que ya no está.
      offline: this.failedOpens.size >= this.sessions.length,
      published: this.out.length,
      qualities: this.qualities,
      quality: this.want === null ? null : wantId(this.want),
      playing: this.playing === null ? null : wantId(this.playing),
      filling: this.filling !== null,
      vodFills: this.vodFills,
    }
  }

  // Número del último fragmento publicado (el de la recarga bloqueante), o null si aún no hay ninguno.
  lastPublished(): number | null {
    return this.out.at(-1)?.n ?? null
  }

  knowsVodUrl(url: string): boolean {
    return this.vodUrls.has(url)
  }

  // Duración típica de los fragmentos del directo publicados (mediana, sin trozos del VOD).
  liveSegmentDuration(): number | null {
    const durations = this.out
      .filter((o) => o.source !== "vod")
      .map((o) => o.duration)
      .sort((a, b) => a - b)
    return durations[Math.floor(durations.length / 2)] ?? null
  }

  // Espera (como mucho timeoutMs) a que se publique el fragmento de salida n: recarga bloqueante. Si el cliente
  // cierra la conexión (signal), deja de esperar.
  waitFor(n: number, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const ready = (): boolean => (this.out.at(-1)?.n ?? -1) >= n || this.stopped
    return ready() ? Promise.resolve() : this.waitUntil(ready, timeoutMs, signal)
  }

  // Espera (como mucho timeoutMs) al próximo cambio: un fragmento publicado, una sesión que no abre o el final.
  changed(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    return this.stopped ? Promise.resolve() : this.waitUntil(() => true, timeoutMs, signal)
  }

  private waitUntil(ready: () => boolean, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return Promise.resolve()
    return new Promise((done) => {
      const finish = (): void => {
        this.waiters.delete(waiter)
        clearTimeout(timer)
        signal?.removeEventListener("abort", finish)
        done()
      }
      const waiter = (): void => {
        if (ready()) finish()
      }
      const timer = setTimeout(finish, timeoutMs)
      signal?.addEventListener("abort", finish)
      this.waiters.add(waiter)
    })
  }

  playlist(): string | null {
    if (this.out.length === 0) return null
    // TARGETDURATION no debe cambiar en la vida de la lista: con relleno se fija desde el principio.
    this.targetDuration = Math.max(
      this.targetDuration,
      this.vodWanted ? VOD_TARGET : 0,
      Math.ceil(Math.max(...this.out.map((s) => s.duration))),
    )
    const first = this.out[0]
    const version = this.out.some((s) => s.map !== null) ? 6 : 3
    const lines = [
      "#EXTM3U",
      `#EXT-X-VERSION:${version}`,
      `#EXT-X-TARGETDURATION:${this.targetDuration}`,
      `#EXT-X-MEDIA-SEQUENCE:${first?.n ?? 0}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${this.discontinuities}`,
      "#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES",
    ]
    let map: string | null = null
    for (const s of this.out) {
      if (s.discontinuity) lines.push("#EXT-X-DISCONTINUITY")
      if (s.map !== null && s.map !== map) {
        lines.push(
          `#EXT-X-MAP:URI="${s.source === "vod" ? this.vodUrl(s.map, null, null) : s.map}"`,
        )
      }
      map = s.map
      if (s.pdt !== null) lines.push(`#EXT-X-PROGRAM-DATE-TIME:${s.pdt}`)
      lines.push(
        `#EXTINF:${s.duration.toFixed(3)},live`,
        s.source === "vod" ? this.vodUrl(s.url, s.from, s.map) : s.url,
      )
    }
    return `${lines.join("\n")}\n`
  }

  // --- Sesiones ---------------------------------------------------------------------------------------------

  private async open(session: Session): Promise<void> {
    try {
      let variant = await this.openSession(this.channel, session.type, session.device, this.want)
      // Las sesiones se abren a la vez: si otra fijó ya la calidad, esta usa la misma (los fragmentos de una misma
      // variante comparten la ruta en todas las sesiones). Si el canal no la tiene (se eligió en otro canal, o la
      // emisión nueva viene con otras), se queda la de reserva de openVariant, la misma en todas las sesiones.
      const want = this.want
      if (want !== null && wantId(variant) !== wantId(want)) {
        const same = variant.variants.find((v) => wantId(v) === wantId(want))
        if (same !== undefined) variant = { ...variant, ...same }
      }
      this.want ??= { fps: variant.fps, resolution: variant.resolution }
      Object.assign(session, { backoff: 0, state: "abierta", url: variant.url })
      this.onListOpened(variant.url)
      this.failedOpens.clear()
      this.log({ broadcastId: variant.broadcastId, ev: "abierta", type: session.type })
      if (
        variant.broadcastId !== null &&
        this.broadcastId !== null &&
        variant.broadcastId !== this.broadcastId
      ) {
        // Una apertura lenta puede traer la emisión anterior cuando otra sesión ya abrió la nueva: se reintenta.
        if (olderBroadcast(variant.broadcastId, this.broadcastId)) {
          throw new Error(`emisión anterior ${variant.broadcastId}`)
        }
        this.resetTimeline(`BROADCAST-ID ${variant.broadcastId}`, session)
      }
      // La que suena y las que hay, de la primera sesión que abre en esta emisión. Si otra no tiene la misma (no se ha
      // visto en Twitch), usa la más parecida (pickVariant) y lo que publique esa sesión irá en otra calidad.
      if (this.playing === null) {
        this.playing = { fps: variant.fps, resolution: variant.resolution }
        this.qualities = variant.variants.map((v) => ({ id: wantId(v), label: v.name }))
      }
      if (variant.broadcastId !== null) this.broadcastId = variant.broadcastId
      this.openVod() // ya con la calidad fijada
    } catch (error) {
      // Canal sin emisión u otro fallo: se reintenta con espera creciente (2, 4, 8… hasta 30 s). Solo si lo dice Twitch
      // cuenta como que no emite: sin red o con Twitch fallando, la interfaz no debe decir que el canal está apagado.
      if (error instanceof NotLiveError) this.failedOpens.add(session.type)
      else this.failedOpens.delete(session.type)
      session.state = "error"
      session.url = null
      session.backoff = Math.min(30_000, (session.backoff || 1000) * 2)
      session.retryAt = Date.now() + session.backoff
      this.log({ error: String(error).slice(0, 160), ev: "error-abrir", type: session.type })
      this.notify() // quien espera el primer fragmento puede saber ya que el canal no emite
    }
  }

  // Cada sesión consulta en cuanto abre y luego cada POLL_MS a hora fija, con las fases repartidas entre las
  // sesiones.
  private loop(session: Session): void {
    const phase = this.startedAt + (session.priority * POLL_MS) / this.sessions.length
    const slot = (from: number): number => phase + Math.ceil((from - phase) / POLL_MS) * POLL_MS
    const tick = async (): Promise<void> => {
      const startedAt = Date.now()
      if (this.stopped) return
      // Solo se reabre ante un error: una sesión nueva puede traer preroll.
      if (session.state === "error" && Date.now() >= session.retryAt) await this.open(session)
      if (session.url !== null && !this.stopped) {
        const generation = this.generation
        try {
          this.receive(session, await this.fetchPlaylist(session.url), generation)
        } catch (error) {
          if (generation === this.generation) {
            this.log({ error: String(error).slice(0, 120), ev: "error-lista", type: session.type })
            session.state = "error"
          }
        }
      }
      if (this.stopped) return
      // La siguiente, en su fase y al menos medio periodo después (la primera, al abrir, no va en fase).
      schedule(slot(Math.max(Date.now(), startedAt + POLL_MS / 2)))
    }
    const schedule = (at: number): void => {
      const timer = setTimeout(() => {
        this.timers.delete(timer)
        void tick()
      }, at - Date.now())
      this.timers.add(timer)
    }
    void tick()
  }

  // Los hosts de los fragmentos de Twitch tienen TTL 0 y su DNS tarda ~0,3 s, con cualquier resolvedor (4 nov, REN-3): es
  // casi todo lo que tarda el primer fragmento de un host nuevo (~350 ms, frente a ~45 con la conexión hecha). Con la
  // lista ya se sabe el host, así que se abre la conexión antes de que el reproductor la pida, por la misma red (en
  // Android, la de Media3). No hay nada que aprovechar de la respuesta: si falla, el fragmento hará lo de siempre.
  private warmConnection(segments: readonly MediaSegment[]): void {
    const url = segments.filter((segment) => !segment.prefetch && !segment.ad).at(-1)?.url
    if (url === undefined || this.red === undefined) return
    let host: string
    try {
      host = new URL(url).host
    } catch {
      return
    }
    if (this.warmedHosts.has(host)) return
    this.warmedHosts.add(host)
    void this.red(url, {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
  }

  // Una respuesta pedida antes de un reinicio de la línea de tiempo es de la emisión anterior: se descarta.
  receive(session: Session, text: string, generation = this.generation): void {
    if (generation !== this.generation || this.stopped) return
    const parsed = parseMedia(text, true)
    const { liveSequence } = parsed
    this.warmConnection(parsed.segments)
    const segments =
      Date.now() < this.simulatedPauseUntil
        ? parsed.segments.map((segment) => ({ ...segment, ad: true, title: "pausa-simulada" }))
        : parsed.segments
    // Lista parada (sin error): pasa al terminar o reiniciarse la emisión. Se reabre la sesión.
    const lastSeq = segments.at(-1)?.seq ?? null
    if (lastSeq !== session.lastSeq) Object.assign(session, { changedAt: Date.now(), lastSeq })
    if (Date.now() - session.changedAt > STALL_MS) {
      this.log({ ev: "lista-parada", type: session.type })
      session.state = "error"
      session.lastSeq = null
      return
    }
    this.ingest(session, segments, liveSequence)
  }

  // Emisión nueva: su numeración común empieza de cero. Se descarta lo situado, se empieza de nuevo con
  // discontinuidad, se reabren las demás sesiones y se busca el VOD de la emisión nueva.
  private resetTimeline(reason: string, keep: Session | null): void {
    this.generation++
    this.log({ ev: "nueva-emision", motivo: reason })
    for (const s of this.sessions) {
      Object.assign(s, { lastSeq: null, live: new Map(), liveEdge: null, offset: null })
      if (s !== keep) Object.assign(s, { retryAt: 0, state: "error", url: null })
    }
    this.nextSeq = null
    this.urls.clear()
    this.refPdt.clear()
    this.clock.clear()
    this.published.clear()
    this.skippedSeqs.clear()
    this.clockRef = null
    this.filling = null
    this.pendingDiscontinuity = true
    this.playing = null // la emisión nueva puede venir con otras calidades
    if (!this.vodInjected) {
      this.vodSource = null
      this.vodRetryAt = 0
      this.openVod()
    }
  }

  // Busca el VOD de la emisión actual; si falla, se reintenta como pronto en un minuto (lo pide advance).
  private openVod(): void {
    if (!this.vodWanted || this.vodInjected || this.vodSource !== null || this.vodOpening) return
    if (Date.now() < this.vodRetryAt || this.stopped) return
    this.vodOpening = true
    const generation = this.generation
    const vod = new Vod(this.channel, this.want, this.red)
    vod
      .open()
      .then(
        () => {
          if (generation !== this.generation || this.stopped) return
          this.vodSource = vod
          this.log({ ev: "vod", id: vod.id })
          this.advance() // por si esperaba al VOD para arrancar
        },
        (error: unknown) => {
          this.vodRetryAt = Date.now() + 60_000
          this.log({ error: String(error).slice(0, 160), ev: "vod-error" })
        },
      )
      .finally(() => {
        this.vodOpening = false
        if (generation !== this.generation) this.openVod()
      })
  }

  // --- Numeración común ---------------------------------------------------------------------------------------
  // Cada anuncio desplaza MEDIA-SEQUENCE de forma distinta en cada sesión. Twitch da en LIVE-SEQUENCE el índice
  // común del primer fragmento en directo de la lista; con él se sitúa el tramo en directo que empieza ahí. La ruta
  // de cada fragmento normal se contrasta con la ya vista para ese índice.
  ingest(session: Session, segments: readonly MediaSegment[], given: number | null): void {
    const last = segments.at(-1)
    let liveSequence = given
    const anchor = segments.findIndex((s) => !s.prefetch && s.title === "live")
    const anchorSegment = segments[anchor]
    // Si otra sesión (o esta) ya vio el fragmento ancla, su índice es el de esa ruta, diga lo que diga LIVE-SEQUENCE.
    // Al entrar en un anuncio, una sesión que ya tuvo uno de entrada puede traer LIVE-SEQUENCE 0 (D34), y tras una
    // emisión nueva los índices son tan pequeños que ese 0 no queda lo bastante por detrás para descartarlo abajo.
    const byPath = anchorSegment === undefined ? null : this.offsetByPath(anchorSegment)
    if (anchorSegment !== undefined && byPath !== null) liveSequence = anchorSegment.seq - byPath
    if (liveSequence !== null && this.nextSeq !== null && liveSequence < this.nextSeq - 150) {
      // Al entrar en un anuncio, la lista de una sesión que ya tuvo uno de entrada puede traer LIVE-SEQUENCE 0 (29 oct,
      // opoartstudy). No es una emisión nueva: reiniciar la línea de tiempo saltaba miles de índices y el vídeo daba un
      // salto de 30-40 s. Esa lista no sirve para numerar; su tramo en directo sigue la numeración de antes.
      if (last?.ad === true) liveSequence = null
      else this.resetTimeline(`LIVE-SEQUENCE ${liveSequence}`, session)
    }
    const wasAd = session.state === "anuncio"
    session.state = last?.ad === true ? "anuncio" : "directo"
    if (session.state === "anuncio" && !wasAd) {
      session.ads++
      this.log({ ev: "anuncio", type: session.type })
      if (this.clockRef === session.type) this.moveClockRef()
    } else if (wasAd && session.state === "directo")
      this.log({ ev: "fin-anuncio", type: session.type })
    if (anchorSegment !== undefined && liveSequence !== null) {
      const offset = anchorSegment.seq - liveSequence
      if (session.offset !== null && offset !== session.offset) {
        this.log({
          ahora: offset,
          antes: session.offset,
          ev: "nueva-numeracion",
          type: session.type,
        })
        this.clock.delete(session.type) // el anuncio también le movió el reloj
      }
      session.offset = offset
    }
    // Los prefetch solo valen mientras la lista actual los siga dando por directo.
    const stale = [...session.live].filter(([, entry]) => entry.prefetch).map(([index]) => index)
    for (const index of stale) session.live.delete(index)
    const rejected = new Set<number>()
    const offset = session.offset
    if (offset !== null && anchor >= 0) {
      // Tras un anuncio en medio de la lista, el tramo de después lleva otra numeración (su LIVE-SEQUENCE no llega:
      // parseMedia da la del primero). Se sitúa por la ruta de su primer fragmento, si otra sesión ya lo vio; si no,
      // espera, como antes, a que el tramo de antes salga de la lista.
      let tramo: number | null = offset
      for (const segment of segments.slice(anchor)) {
        if (segment.prefetch && segment.ad) break
        if (!segment.prefetch && segment.title !== "live") {
          tramo = null
          continue
        }
        tramo ??= this.offsetByPath(segment)
        if (tramo === null) break
        const index = segment.seq - tramo
        session.liveEdge = Math.max(session.liveEdge ?? index, index)
        if (segment.ad) continue
        if (!segment.prefetch && !this.acceptsSegment(session, segment, index)) {
          session.live.delete(index)
          rejected.add(index)
          continue
        }
        session.live.set(index, { ...segment, index })
        if (this.skippedSeqs.delete(index))
          this.log({ ev: "tardio", seq: index, type: session.type })
      }
    }
    for (const index of stale) {
      if (session.live.has(index) || rejected.has(index)) continue
      this.log({
        ev: "reclasificado",
        publicado: this.published.get(index) === session.type,
        seq: index,
        type: session.type,
      })
    }
    const edge = session.liveEdge ?? Number.NEGATIVE_INFINITY
    for (const index of session.live.keys()) if (index < edge - 60) session.live.delete(index)
    for (const index of this.skippedSeqs) if (index < edge - 60) this.skippedSeqs.delete(index)
    for (const index of this.urls.keys()) if (index < edge - 200) this.urls.delete(index)
    for (const index of this.refPdt.keys()) if (index < edge - 200) this.refPdt.delete(index)
    for (const index of this.published.keys())
      if (index < (this.nextSeq ?? 0) - 200) this.published.delete(index)
    this.advance()
  }

  private offsetByPath(segment: MediaSegment): number | null {
    const path = new URL(segment.url).pathname
    for (const [index, known] of this.urls) if (known.path === path) return segment.seq - index
    return null
  }

  // Contraste por ruta (sin host ni consulta) y medida del reloj de la sesión contra la de referencia.
  private acceptsSegment(session: Session, segment: MediaSegment, index: number): boolean {
    const { host, pathname } = new URL(segment.url)
    const known = this.urls.get(index)
    if (known !== undefined && known.path !== pathname) {
      this.log({ ev: "url-distinta", index, otra: known.type, type: session.type })
      return false
    }
    if (known === undefined) this.urls.set(index, { host, path: pathname, type: session.type })
    const pdt = segment.pdt === null ? null : Date.parse(segment.pdt)
    if (pdt !== null) {
      this.clockRef ??= session.type
      const ref = this.refPdt.get(index)
      const before = session.live.get(index - 1)
      const jumped =
        before?.pdt != null &&
        !before.prefetch &&
        Math.abs(pdt - Date.parse(before.pdt) - before.duration * 1000) > 100
      // Si salta el reloj de la referencia (respecto de su fragmento anterior o, tras un hueco, del de otra sesión),
      // arrastraría la hora común: pasa a serlo otra.
      const moved = before === undefined ? this.otherPdtAfter(session, index - 1) : null
      if (
        session.type === this.clockRef &&
        ref === undefined &&
        (jumped || (moved != null && Math.abs(pdt - moved) > 100))
      )
        this.moveClockRef(true)
      if (session.type === this.clockRef) {
        this.refPdt.set(index, pdt)
        this.clock.set(session.type, 0)
      } else if (ref !== undefined) this.clock.set(session.type, pdt - ref)
      else if (
        jumped ||
        (moved != null && Math.abs(pdt - (this.clock.get(session.type) ?? 0) - moved) > 100)
      )
        // Su hora salta respecto del fragmento anterior, o tras un hueco no casa con la de otra sesión (un anuncio le
        // movió el reloj): lo medido ya no vale hasta que la de referencia llegue a este índice.
        this.clock.delete(session.type)
    }
    return true
  }

  // La de referencia entra en un anuncio con un reloj que no tiene ninguna otra en directo (a 0,25 s o más), o su reloj
  // acaba de moverse (force): pasa a serlo la otra en directo con el reloj más cercano, y la hora común, la suya.
  private moveClockRef(force = false): void {
    const live = this.sessions.flatMap((s) => {
      const shift = this.clock.get(s.type)
      return s.state === "directo" && s.type !== this.clockRef && shift !== undefined
        ? [{ s, shift }]
        : []
    })
    if (!force && live.some((x) => Math.abs(x.shift) < 250)) return
    const group = (x: { shift: number }): number =>
      live.filter((y) => Math.abs(y.shift - x.shift) < 250).length
    const next = live.sort(
      (a, b) => group(b) - group(a) || Math.abs(a.shift) - Math.abs(b.shift),
    )[0]
    if (next === undefined) return
    this.clockRef = next.s.type
    for (const [type, value] of this.clock) this.clock.set(type, value - next.shift)
    for (const [index, value] of this.refPdt) this.refPdt.set(index, value + next.shift)
  }

  // Publica en orden. Un índice sin directo en ninguna sesión se salta con discontinuidad, salvo en una pausa
  // global, que se rellena con el VOD.
  private advance(): void {
    const active = this.sessions.filter((s) => s.url !== null && s.state !== "error")
    // Durante un relleno manda el relleno; también el de arranque, que fija el primer índice al volver.
    if (this.filling !== null) return
    if (this.nextSeq === null) {
      const entries = active.flatMap((s) => [...s.live.values()])
      if (entries.length === 0) {
        // Arranque con todas las sesiones en anuncio (cada sesión nueva puede traer uno de entrada): en vez de
        // esperar a que acabe alguno, se empieza en el VOD y se vuelve al directo como en un relleno.
        // Todas: también las que aún están abriendo, que pueden traer el directo.
        const opening = this.sessions.some((s) => s.state === "abriendo")
        const allAds = !opening && active.length > 0 && active.every((s) => s.state === "anuncio")
        if (allAds && this.out.length === 0 && this.canFill()) void this.fill()
        return
      }
      const indices = entries.map((e) => e.index)
      // Arranque: unos fragmentos por detrás del borde (3, o los que quepan en startBackSeconds).
      const durations = entries.map((e) => e.duration).sort((a, b) => a - b)
      const typical = durations[Math.floor(durations.length / 2)] ?? 2
      const back = this.startBackSeconds === null ? 3 : Math.ceil(this.startBackSeconds / typical)
      this.nextSeq = Math.max(Math.min(...indices), Math.max(...indices) - back)
    }
    for (;;) {
      const seq: number = this.nextSeq
      // Mejor la versión normal que el prefetch de otra sesión: su duración es la real, no la supuesta.
      const candidates = active.map((s) => ({ s, segment: s.live.get(seq) }))
      const found =
        candidates.find((x) => x.segment?.prefetch === false) ??
        candidates.find((x) => x.segment !== undefined)
      // Hueco: todas tienen directo situado más allá (una sesión en anuncio no cuenta), o alguna lo tiene 3 o más
      // fragmentos por delante (para no esperar a una sesión atrasada).
      const liveAhead = Math.max(-1, ...active.flatMap((s) => [...s.live.keys()]))
      const allBehind = active.every((s) => s.liveEdge !== null && s.liveEdge > seq)
      const lost = active.length > 0 && (allBehind || liveAhead >= seq + 3)
      const globalPause =
        active.length > 0 && active.every((s) => s.state === "anuncio") && this.out.length > 0
      if (found?.segment !== undefined) this.emit(found.segment, found.s.type)
      else if (globalPause && this.canFill()) {
        void this.fill()
        return
      } else if (lost) {
        this.skippedSeqs.add(seq)
        this.pendingDiscontinuity = true
        this.log({ ev: "hueco", motivo: allBehind ? "todas-atras" : "directo-por-delante", seq })
      } else return
      this.nextSeq = seq + 1
    }
  }

  private canFill(): boolean {
    if (this.vodSource === null) {
      this.openVod()
      return false
    }
    return Date.now() - this.fillErrorAt > 5000
  }

  private emit(segment: LiveEntry, source: string): void {
    const previous = this.out.at(-1)
    const discontinuity = this.pendingDiscontinuity
    // Hora en el reloj común; si aún no se conoce el de esta sesión, se deduce de otra que sí lo tenga, y si no, sigue
    // la del fragmento anterior.
    const shift = this.clock.get(source)
    let pdt = segment.pdt
    const guessed = segment.prefetch || shift === undefined ? this.derivedPdt(segment.index) : null
    if (guessed !== null) pdt = new Date(guessed).toISOString()
    else if (pdt !== null && shift !== undefined)
      pdt = new Date(Date.parse(pdt) - shift).toISOString()
    else if (previous?.pdt != null && !discontinuity) {
      pdt = new Date(Date.parse(previous.pdt) + previous.duration * 1000).toISOString()
    }
    this.push({
      discontinuity,
      duration: segment.duration,
      from: null,
      map: segment.map,
      n: (previous?.n ?? -1) + 1,
      pdt,
      seq: segment.index,
      source,
      url: segment.url,
    })
    this.published.set(segment.index, source)
  }

  // Hora común del final de un índice según otra sesión que lo tenga como fragmento normal y con el reloj medido.
  private otherPdtAfter(session: Session, index: number): number | undefined {
    for (const other of this.sessions) {
      const entry = other.live.get(index)
      const shift = this.clock.get(other.type)
      if (other === session || entry?.pdt == null || entry.prefetch || shift === undefined) continue
      return Date.parse(entry.pdt) - shift + entry.duration * 1000
    }
    return undefined
  }

  // Hora común de un prefetch (o de un fragmento de una sesión sin reloj medido). parseMedia suma a todos los prefetch
  // la duración del último normal de su lista, que puede ser de 1 s: la hora saltaba hasta 2 s y volvía. Se cuenta
  // desde el último fragmento normal de cualquier sesión, con la duración típica para los que aún son prefetch.
  private derivedPdt(index: number): number | null {
    // Primero la de referencia: su hora es la común sin desfase medido que pueda haberse quedado viejo.
    const sessions = [...this.sessions].sort(
      (a, b) => Number(b.type === this.clockRef) - Number(a.type === this.clockRef),
    )
    for (let known = index - 1; known >= index - 40; known--) {
      for (const session of sessions) {
        const entry = session.live.get(known)
        const shift = this.clock.get(session.type)
        if (entry === undefined || entry.prefetch || entry.pdt === null || shift === undefined)
          continue
        // Si los dos últimos duran lo mismo, esa es la típica aunque no sea la de la ventana: el emisor se reconectó
        // con otra configuración (de 2 a 4 s). Uno suelto distinto no cambia nada.
        const before = session.live.get(known - 1)
        const typical =
          before?.prefetch === false && Math.abs(before.duration - entry.duration) < 0.01
            ? entry.duration
            : (this.liveSegmentDuration() ?? 2)
        const ahead = entry.duration + (index - known - 1) * typical
        return Date.parse(entry.pdt) - shift + ahead * 1000
      }
    }
    return null
  }

  private push(entry: Published): void {
    this.out.push(entry)
    this.pendingDiscontinuity = false
    // Se quita el más antiguo mientras el resto siga abarcando la ventana.
    let rest = this.out.reduce((total, each) => total + each.duration, 0)
    for (;;) {
      const first = this.out[0]
      if (first === undefined || rest - first.duration < WINDOW_SECONDS) break
      this.out.shift()
      if (first.discontinuity) this.discontinuities++
      rest -= first.duration
    }
    this.notify()
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter()
  }

  // --- Relleno con el VOD -------------------------------------------------------------------------------------
  // Desde el tiempo final del último fragmento publicado, publica los trozos del VOD que lo continúan y vuelve al
  // directo en el fragmento cuyo tiempo llega al final de lo publicado. Tras cada espera se comprueba que el relleno
  // sigue vigente: un reinicio de la emisión o el final del relleno lo anulan.
  private async fill(): Promise<void> {
    const last = this.out.at(-1)
    const generation = this.generation
    const fill: Fill = {
      alive: () => this.filling === fill && this.generation === generation && !this.stopped,
      anchor: { pdtMs: Date.parse(last?.pdt ?? ""), time: 0 },
      cursor: 0,
      lastVodAt: Date.now(),
      aheadSince: null,
      probed: null,
      published: 0,
      since: Date.now(),
      vodOffset: null,
    }
    this.filling = fill
    this.log({ ev: last === undefined ? "arranque-vod" : "relleno-inicio", seq: this.nextSeq })
    try {
      if (last === undefined) await this.startFromVod(fill)
      else {
        // Si lo último publicado era un trozo del VOD recortado, empieza en el recorte.
        const time = last.from ?? (await this.probe(last.url, last.map))
        if (!fill.alive()) return
        fill.anchor = { pdtMs: Date.parse(last.pdt ?? ""), time }
        // Si se publicó como prefetch, su duración era supuesta: la real, si ya la da alguna sesión. Con la supuesta, el
        // VOD empezaba unas décimas antes o después del final de lo publicado, sin discontinuidad.
        const seq = last.seq
        const real = this.sessions
          .map((s) => (seq === null ? undefined : s.live.get(seq)))
          .find((entry) => entry !== undefined && !entry.prefetch)
        fill.cursor = time + (real?.duration ?? last.duration)
      }
      while (fill.alive()) {
        if (await this.tryReturn(fill)) return
        if (!fill.alive()) return
        await this.fillFromVod(fill)
        if (fill.alive()) await sleep(this.fillPollMs)
      }
    } catch (error) {
      if (!fill.alive()) return
      this.log({ error: String(error).slice(0, 160), ev: "relleno-error" })
      this.filling = null
      this.fillErrorAt = Date.now()
      if (this.out.length > 0) this.pendingDiscontinuity = true
      this.advance()
    }
  }

  // Arranque desde el VOD: dos trozos antes de su final (~20 s), lo que ya cubre la holgura del primer relleno. Sin
  // fragmento en directo que seguir, la hora (PDT) de los trozos sale de la del VOD (vodHour): Media3 la necesita en la
  // primera lista, y la latencia y el chat salen bien desde el principio. Si no se sabe, van sin ella y hls.js la
  // deduce hacia atrás desde el primer fragmento en directo.
  private async startFromVod(fill: Fill): Promise<void> {
    const source = this.vodSource
    if (source === null) throw new Error("sin VOD")
    await source.refresh()
    const start = source.segments.at(-2)
    if (!fill.alive()) return
    if (start === undefined) throw new Error("el VOD aún es demasiado corto")
    const time = await this.probe(start.url, start.map)
    if (!fill.alive()) return
    fill.cursor = time
    fill.vodOffset = time - start.elapsed
    fill.anchor = { pdtMs: vodHour(source, start) ?? Number.NaN, time }
  }

  private async fillFromVod(fill: Fill): Promise<void> {
    const source = this.vodSource
    if (source === null) return
    await source.refresh()
    if (!fill.alive()) return
    const segments = source.segments
    const ref = segments.at(-1)
    if (ref === undefined) return
    if (fill.vodOffset === null) {
      const time = await this.probe(ref.url, ref.map)
      if (!fill.alive()) return
      fill.vodOffset = unwrap(time, fill.cursor) - ref.elapsed
    }
    const offset = fill.vodOffset
    for (;;) {
      const at = segments.findIndex((s) => s.elapsed + offset + s.duration > fill.cursor + 0.05)
      let segment: VodSegment | undefined = segments[at]
      if (segment === undefined) return // el VOD aún no llega al cursor
      // Una sola parada: en el primer relleno de la visita, el primer trozo no se suelta hasta que el VOD cubre, por
      // delante del cursor, un trozo entero más la holgura (fillSlack). El VOD llega en trozos de ~10 s y solo cuando
      // están completos; sin esa holgura el reproductor iría pegado a su borde y se pararía varias veces. En los
      // rellenos siguientes de la visita no hace falta: el reproductor conserva el margen del primero (modo
      // adaptativo).
      const availableEnd = ref.elapsed + offset + ref.duration
      const slack = (): boolean =>
        this.fillSlack === null ||
        fill.published > 0 ||
        this.visitFills > 0 ||
        availableEnd - fill.cursor >= (segment?.duration ?? 10) + this.fillSlack
      if (!slack()) return
      const start = segment.elapsed + offset
      const end = start + segment.duration
      // El cursor cae dentro: se recorta en el corte comprobado (normalmente, el cursor).
      if (this.vodTrimmer != null && start < fill.cursor - 0.05 && end - fill.cursor > 0.5) {
        const { map, url } = segment
        const trimmer = this.vodTrimmer
        const trim = (from: number): Promise<number | null> =>
          trimmer(url, from, map).catch(() => null)
        // Sin fotograma clave en el cursor (el fragmento que empieza ahí no lo vio ninguna sesión y su borde no cae
        // donde se suponía), se prueba en el siguiente borde de fragmento: el trozo son fragmentos del directo
        // seguidos desde su principio, de la duración típica. Se pierde menos que saltando al trozo siguiente.
        const typical = this.liveSegmentDuration() ?? 2
        const cut =
          (await trim(fill.cursor)) ??
          (await trim(start + Math.ceil((fill.cursor - start) / typical) * typical))
        if (!fill.alive()) return
        if (cut !== null && Number.isFinite(cut) && cut > fill.cursor - 0.1 && cut < end - 0.5) {
          if (Math.abs(cut - fill.cursor) > 0.1) this.pendingDiscontinuity = true
          this.emitVod({ ...segment, duration: end - cut }, cut, fill, cut - fill.cursor, cut)
          fill.cursor = end
          if ((await this.tryReturn(fill)) || !fill.alive()) return
          continue
        }
        this.log({ desde: fill.cursor, ev: "recorte-fallido" })
      }
      // Si no, se salta al siguiente: repetir lo que ya se vio se nota más que perder un trozo.
      if (start < fill.cursor - 0.05) {
        segment = segments[at + 1]
        if (segment === undefined || !slack()) return // esperar al siguiente
      }
      const segmentStart = segment.elapsed + offset
      const jump = segmentStart - fill.cursor
      if (Math.abs(jump) > 0.1) this.pendingDiscontinuity = true
      this.emitVod(segment, segmentStart, fill, jump, null)
      fill.cursor = segmentStart + segment.duration
      if ((await this.tryReturn(fill)) || !fill.alive()) return
    }
  }

  // ¿Hay ya directo en el punto del cursor? Se lee el tiempo del primer índice en directo pendiente y se avanza
  // con las duraciones. Si el directo reaparece por delante, se espera al siguiente trozo del VOD (los bordes casan)
  // y solo se salta si el VOD no avanza en 25 s.
  private async tryReturn(fill: Fill): Promise<boolean> {
    if (!fill.alive()) return true
    const active = this.sessions.filter((s) => s.url !== null && s.state !== "error")
    const entry = (index: number): LiveEntry | undefined =>
      active.map((s) => s.live.get(index)).find((e) => e !== undefined)
    const pending = active
      .flatMap((s) => [...s.live.keys()])
      .filter((i) => i >= (this.nextSeq ?? 0))
    if (pending.length === 0) return false
    const first = Math.min(...pending)
    const firstEntry = entry(first)
    if (firstEntry === undefined) return false
    if (fill.probed?.index !== first) {
      const time = await this.probe(firstEntry.url, firstEntry.map)
      if (!fill.alive()) return true
      fill.probed = { index: first, time: unwrap(time, fill.cursor) }
    }
    let time = fill.probed.time
    for (let index = first; ; index++) {
      const current = entry(index)
      if (current === undefined) return false
      if (time >= fill.cursor - 0.1) {
        const gap = time - fill.cursor
        if (gap > 0.1) fill.aheadSince ??= Date.now()
        const waitVod =
          Date.now() - fill.lastVodAt < VOD_RETURN_WAIT_MS &&
          Date.now() - (fill.aheadSince ?? Date.now()) < this.returnAheadMaxMs
        if (gap > 0.1 && waitVod) return false
        const previous = this.out.at(-1)
        if (previous !== undefined && (Math.abs(gap) > 0.1 || current.map !== previous.map))
          this.pendingDiscontinuity = true
        this.log({
          ev: "relleno-fin",
          fragmentosVod: fill.published,
          saltoS: +gap.toFixed(2),
          seq: index,
        })
        // Solo cuenta como relleno si llegó a publicar VOD (el reproductor no ha visto ninguno si no).
        if (fill.published > 0) {
          this.vodFills++
          this.visitFills++
        }
        this.filling = null
        this.nextSeq = index
        this.advance()
        return true
      }
      time += current.duration
    }
  }

  private emitVod(
    segment: VodSegment,
    start: number,
    fill: Fill,
    jump: number,
    from: number | null,
  ): void {
    const previous = this.out.at(-1)
    if (segment.map !== (previous?.map ?? null)) this.pendingDiscontinuity = true
    // La hora se deriva del tiempo de contenido a partir del último fragmento en directo publicado.
    const pdt = Number.isFinite(fill.anchor.pdtMs)
      ? new Date(fill.anchor.pdtMs + (start - fill.anchor.time) * 1000).toISOString()
      : null
    this.push({
      discontinuity: this.pendingDiscontinuity,
      duration: segment.duration,
      from,
      map: segment.map,
      n: (previous?.n ?? -1) + 1,
      pdt,
      seq: null,
      source: "vod",
      url: segment.url,
    })
    fill.published++
    fill.lastVodAt = Date.now()
    for (const url of [segment.url, segment.map]) if (url !== null) this.vodUrls.add(url)
    if (this.vodUrls.size > 500) {
      const oldest = this.vodUrls.values().next().value
      if (oldest !== undefined) this.vodUrls.delete(oldest)
    }
    this.log({ ev: "pub-vod", recorte: from !== null, saltoS: +jump.toFixed(2) })
  }

  // Solo para pruebas: lo publicado.
  get publishedForTests(): readonly Published[] {
    return this.out
  }

  get sessionsForTests(): readonly Session[] {
    return this.sessions
  }
}
