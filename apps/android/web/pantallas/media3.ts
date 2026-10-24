import type { LatencyMode, VideoDetail } from "@goodttv/contratos"
import {
  addWatchMinute,
  resumeAt,
  saveVodProgress,
  vodPlayback,
  vodProgress,
} from "@goodttv/interfaz"
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { android } from "../api"
import { parseRoute } from "./rutas"

// El vídeo del canal o del VOD: Media3 (Reproductor.kt), que la app pone debajo de la página, en el sitio de «zona». La
// página es transparente ahí y pinta encima los controles. Mientras está abierto, la app manda su estado en el evento
// «goodttv-reproductor» (MainActivity.kt), al cambiar y a cada tic (uno por segundo en directo, cuatro en un VOD). Al
// dejar el canal o el VOD, sigue en una esquina (el minirreproductor, CajaVideo.kt); si se vuelve a él, la app no lo
// abre de nuevo. Uno cada vez: abrir un VOD cierra el canal, y al revés.

export type EstadoMedia3 = {
  // cargando hasta que empieza a avanzar; reproduciendo desde entonces, aunque luego espere datos o esté en pausa.
  readonly fase: "cargando" | "reproduciendo" | "sin-directo" | "error"
  readonly esperando: boolean // le faltan datos para seguir
  readonly pausado: boolean
  readonly calidad: string | null // como la nombra Twitch: 1080p60
  // DVR-1: va por detrás de donde iba antes de retroceder o pausar (con «Ir al directo» se vuelve).
  readonly retrocedido: boolean
  // DVR-1: en pausa, desde cuándo y qué momento se veía (ms, en hora real). Lo lleva la app: también se pausa desde la
  // esquina o el PiP, y la pantalla del canal se desmonta al dejarlo.
  // fuera: lo que se veía al pausar no está en la lista de este reproductor (se volvió a abrir en pausa, al volver a
  // verse la app tras el solo audio): reanudar lo abre en el VOD, como tras una pausa larga.
  readonly pausa: {
    readonly desde: number
    readonly fuera: boolean
    readonly imagen: number
  } | null
}

type Evento = EstadoMedia3 & {
  readonly canal?: string
  readonly latencia: number | null
  readonly atras: number // s que caben hacia atrás en la lista del empalme
  readonly pausadoDesde: number | null
  readonly imagenPausada: number | null
  readonly pausaFuera?: boolean // lo pausado no está en la lista del reproductor (reabierto en pausa)
}

const CARGANDO: EstadoMedia3 = {
  calidad: null,
  esperando: false,
  fase: "cargando",
  pausa: null,
  pausado: false,
  retrocedido: false,
}

const igual = (a: EstadoMedia3, b: EstadoMedia3): boolean =>
  a.fase === b.fase &&
  a.esperando === b.esperando &&
  a.pausado === b.pausado &&
  a.calidad === b.calidad &&
  a.retrocedido === b.retrocedido &&
  a.pausa?.desde === b.pausa?.desde &&
  // Moverse en pausa mueve lo que se veía (Reproductor.kt): si no, al reanudar se abriría el VOD donde se pausó.
  a.pausa?.imagen === b.pausa?.imagen &&
  a.pausa?.fuera === b.pausa?.fuera

// Dónde está un elemento, en píxeles de la pantalla, para la app: al montarse y cada vez que cambia (girar el teléfono,
// ocultar el chat). La app no hace nada si no ha cambiado. Al desmontarse, «alSalir».
export const useEnPantalla = (
  elemento: RefObject<HTMLElement | null>,
  avisar: (x: number, y: number, ancho: number, alto: number) => void,
  alSalir?: () => void,
): void => {
  const salir = useRef(alSalir)
  salir.current = alSalir
  useLayoutEffect(() => {
    const element = elemento.current
    if (element === null) return undefined
    const medir = (): void => medirEn(element, avisar)
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(element)
    addEventListener("resize", medir)
    return () => {
      observer.disconnect()
      removeEventListener("resize", medir)
      salir.current?.()
    }
  }, [avisar, elemento])
}

const medirEn = (
  element: HTMLElement,
  avisar: (x: number, y: number, ancho: number, alto: number) => void,
): void => {
  const caja = element.getBoundingClientRect()
  const escala = devicePixelRatio
  const x = Math.round(caja.left * escala)
  const y = Math.round(caja.top * escala)
  avisar(x, y, Math.round(caja.right * escala) - x, Math.round(caja.bottom * escala) - y)
}

// El sitio del vídeo.
const avisarZona = (x: number, y: number, ancho: number, alto: number): void =>
  android.videoZona(x, y, ancho, alto)
const useZona = (zona: RefObject<HTMLElement | null>): void => useEnPantalla(zona, avisarZona)

// Deslizar hacia abajo sobre el vídeo es volver, como la flecha (y como en la app de Twitch). La pantalla baja con el dedo,
// y el vídeo con ella: la app lo pone donde diga su zona, que se manda en cada movimiento (mover la pantalla no la cambia
// de tamaño, así que useZona no se entera). Al soltar, vuelve si se ha bajado bastante o deprisa; si no, sube a su sitio.
// Solo con el dedo y empezando en el vídeo, fuera de la barra del tiempo, que se arrastra de lado. Hasta pasar UMBRAL_PX
// no es un gesto, así que un toque sigue enseñando u ocultando los controles.
const UMBRAL_PX = 12
const VOLVER_PX = 96
const VOLVER_DEPRISA = 0.5 // px/ms, de media desde que empezó: un golpe corto hacia abajo
const REGRESO_MS = 150
export const useDeslizarParaVolver = (
  zona: RefObject<HTMLElement | null>,
  pantalla: RefObject<HTMLElement | null>,
  volver: () => void,
  activo: boolean, // sin vídeo (un canal sin directo), no
): void => {
  const alVolver = useRef(volver)
  alVolver.current = volver
  useEffect(() => {
    const escenario = zona.current
    const todo = pantalla.current
    if (!activo || escenario === null || todo === null) return undefined
    let gesto: {
      readonly id: number
      readonly x: number
      readonly y: number
      readonly t: number
    } | null = null
    let bajando = false
    let bajado = 0
    let animacion = 0
    const colocar = (px: number): void => {
      todo.style.transform = px === 0 ? "" : `translateY(${px}px)`
      medirEn(escenario, avisarZona)
    }
    // Sube a su sitio con una animación corta, moviendo también el vídeo en cada fotograma.
    const regresar = (desde: number): void => {
      const inicio = performance.now()
      const paso = (ahora: number): void => {
        const t = Math.min(1, (ahora - inicio) / REGRESO_MS)
        colocar(Math.round(desde * (1 - t) ** 2))
        if (t < 1) animacion = requestAnimationFrame(paso)
      }
      animacion = requestAnimationFrame(paso)
    }
    const empezar = (event: PointerEvent): void => {
      if (event.pointerType !== "touch" || !event.isPrimary) return
      if (event.target instanceof Element && event.target.closest(".barra-tiempo") !== null) return
      cancelAnimationFrame(animacion)
      gesto = { id: event.pointerId, t: event.timeStamp, x: event.clientX, y: event.clientY }
      bajando = false
      bajado = 0
    }
    const mover = (event: PointerEvent): void => {
      if (gesto === null || event.pointerId !== gesto.id) return
      const dx = event.clientX - gesto.x
      const dy = event.clientY - gesto.y
      if (!bajando) {
        if (Math.hypot(dx, dy) < UMBRAL_PX) return
        // Hacia arriba o de lado no es este gesto.
        if (dy <= 0 || Math.abs(dx) > dy) {
          gesto = null
          return
        }
        bajando = true
      }
      bajado = Math.max(0, dy)
      colocar(bajado)
    }
    const soltar = (event: PointerEvent): void => {
      if (gesto === null || event.pointerId !== gesto.id) return
      // Al soltar, hasta donde llegó el dedo, que en un golpe rápido puede ir por delante del último movimiento.
      if (bajando && event.type === "pointerup") bajado = Math.max(0, event.clientY - gesto.y)
      const deprisa = bajado / Math.max(1, event.timeStamp - gesto.t) > VOLVER_DEPRISA
      gesto = null
      if (!bajando) return
      bajando = false
      if (
        event.type === "pointerup" &&
        (bajado > VOLVER_PX || (deprisa && bajado > 3 * UMBRAL_PX))
      ) {
        colocar(0)
        alVolver.current()
      } else {
        regresar(bajado)
      }
    }
    escenario.addEventListener("pointerdown", empezar)
    escenario.addEventListener("pointermove", mover)
    escenario.addEventListener("pointerup", soltar)
    escenario.addEventListener("pointercancel", soltar)
    return () => {
      cancelAnimationFrame(animacion)
      escenario.removeEventListener("pointerdown", empezar)
      escenario.removeEventListener("pointermove", mover)
      escenario.removeEventListener("pointerup", soltar)
      escenario.removeEventListener("pointercancel", soltar)
      todo.style.transform = ""
    }
  }, [activo, pantalla, zona])
}

// Al dejar la pantalla, a la esquina, salvo que se pase a otro canal o a otro VOD: el siguiente sustituye al anterior
// sin pasar por la esquina.
const minimizarSiSale = (): void => {
  const view = parseRoute(location.hash).view
  if (view !== "channel" && view !== "vod") android.canalMinimizar()
}

// Abre el canal al montarse (y con otro canal u otro modo, otra vez) y, al dejar el canal, lo deja en la esquina. Si se
// pasa a otro canal (las flechas), no: el siguiente sustituye al anterior sin pasar por la esquina. «latency» es la latencia respecto
// al emisor (s, null mientras no se sabe) y «atras», lo que cabe hacia atrás en la lista del empalme (s): van en
// referencias porque cambian cada segundo y se leen a su ritmo (useBehind, el retraso del chat, retroceder).
export const useMedia3 = (
  login: string,
  mode: LatencyMode,
  zona: RefObject<HTMLElement | null>,
  listo: boolean, // con el modo guardado ya leído: antes, abriría el canal dos veces
) => {
  const [estado, setEstado] = useState(CARGANDO)
  const latency = useRef<number | null>(null)
  const atras = useRef(0)

  useEffect(() => {
    setEstado(CARGANDO)
    latency.current = null
    atras.current = 0
    if (!listo) return undefined
    const onEvento = (event: Event): void => {
      const detalle = (event as CustomEvent<Evento>).detail
      if (detalle.canal !== login) return // lo último del canal anterior, o un VOD
      latency.current = detalle.latencia
      atras.current = detalle.atras
      const nuevo: EstadoMedia3 = {
        // Twitch llama «1080p60 (source)» a la original: basta con «1080p60».
        calidad: detalle.calidad?.replace(/\s*\(.*\)$/, "") ?? null,
        esperando: detalle.esperando,
        fase: detalle.fase,
        pausa:
          detalle.pausadoDesde === null || detalle.imagenPausada === null
            ? null
            : {
                desde: detalle.pausadoDesde,
                fuera: detalle.pausaFuera === true,
                imagen: detalle.imagenPausada,
              },
        pausado: detalle.pausado,
        retrocedido: detalle.retrocedido,
      }
      setEstado((antes) => (igual(antes, nuevo) ? antes : nuevo))
    }
    addEventListener("goodttv-reproductor", onEvento)
    android.canalAbrir(login, mode)
    return () => {
      removeEventListener("goodttv-reproductor", onEvento)
      minimizarSiSale()
    }
  }, [listo, login, mode])

  useZona(zona)

  const pausar = useCallback((pausa: boolean) => android.canalPausar(pausa), [])
  const reintentar = useCallback(() => {
    setEstado(CARGANDO)
    latency.current = null
    android.canalReintentar()
  }, [])
  // Dentro de la lista del empalme (DVR-1): la app no pasa del principio de la lista ni, hacia delante, de donde iba.
  const saltar = useCallback((segundos: number) => android.canalSaltar(segundos), [])
  const alDirecto = useCallback(() => android.canalAlDirecto(), [])
  return { alDirecto, atras, estado, latency, pausar, reintentar, saltar }
}

// Un VOD (VOD-1).
export type EstadoVod = {
  // solo-suscriptores: usher no lo da como invitado.
  readonly fase: "cargando" | "reproduciendo" | "solo-suscriptores" | "error"
  readonly esperando: boolean
  readonly pausado: boolean
  readonly posicion: number // s
  readonly duracion: number | null // s
  readonly bufer: number // hasta dónde hay datos, s
  readonly velocidad: number
  readonly calidades: readonly string[] // las mejores primero
  readonly calidad: string | null // la elegida; null, la automática
  readonly sonando: string | null // la que suena
}

type EventoVod = EstadoVod & { readonly vod?: string }

const CARGANDO_VOD: EstadoVod = {
  bufer: 0,
  calidad: null,
  calidades: [],
  duracion: null,
  esperando: false,
  fase: "cargando",
  pausado: false,
  posicion: 0,
  sonando: null,
  velocidad: 1,
}

// Lo que enseñan los mandos del sistema (la notificación y la pantalla de bloqueo) de lo que se ve: «clave» es su ruta
// sin «#/» (canal/<canal> o vod/<id>). La app lo guarda aunque aún no lo haya abierto. Sin título (mientras llegan los
// datos), nada: la app enseña el nombre del canal.
export const useMandos = (
  clave: string,
  titulo: string,
  texto: string,
  foto: string | undefined,
): void => {
  useEffect(() => {
    if (titulo !== "") android.reproductorDatos(clave, titulo, texto, foto ?? "")
  }, [clave, titulo, texto, foto])
}

// La dirección del último VOD abierto (con lo de retroceder un directo, si lo era), para volver a él desde la esquina.
let rutaVod: string | null = null
export const rutaDelVod = (id: string): string =>
  rutaVod !== null && parseRoute(rutaVod).view === "vod" && rutaVod.startsWith(`#/vod/${id}`)
    ? rutaVod
    : `#/vod/${id}`

// Por dónde va el VOD que se sigue (vod-progress.ts), también si está en la esquina o en el PiP: cada 5 s de avance, al
// pausar y al saltar. Una sola escucha para toda la página; seguirVod dice qué vídeo es (null: ninguno, como al
// retroceder un directo, que no cuenta como vídeo a medias).
const GUARDAR_S = 5
let seguido: { readonly video: VideoDetail; guardado: number; pausado: boolean } | null = null
export const seguirVod = (video: VideoDetail | null): void => {
  if (video?.id === seguido?.video.id && video !== null && seguido !== null) return
  seguido = video === null ? null : { guardado: Number.NaN, pausado: false, video }
}
addEventListener("goodttv-reproductor", (event) => {
  const detalle = (event as CustomEvent<EventoVod>).detail
  if (seguido === null || detalle.vod !== seguido.video.id || detalle.fase !== "reproduciendo")
    return
  const pausa = detalle.pausado && !seguido.pausado
  seguido.pausado = detalle.pausado
  if (pausa || !(Math.abs(detalle.posicion - seguido.guardado) < GUARDAR_S)) {
    seguido.guardado = detalle.posicion
    saveVodProgress(seguido.video, detalle.posicion)
  }
})

// Los minutos que suena cada canal, en directo o en sus VOD (watch-time.ts, para ordenar tus seguidos por los que más
// ves), también en la esquina, en el PiP o con la pantalla apagada: una escucha para toda la página, como la de arriba.
// Cuenta un minuto si al cumplirse sigue sonando (con un evento de hace menos de unos segundos: si la app cierra el
// vídeo, ya no llegan). vodDeCanal dice de quién es un VOD.
const SIGUE_MS = 5000
let delVod: { readonly id: string; readonly login: string } | null = null
let sonando: { readonly login: string; readonly hasta: number } | null = null
export const vodDeCanal = (video: VideoDetail): void => {
  delVod = { id: video.id, login: video.owner.login }
}
addEventListener("goodttv-reproductor", (event) => {
  const detalle = (event as CustomEvent<Evento & EventoVod>).detail
  const login =
    detalle.canal ??
    (detalle.vod !== undefined && detalle.vod === delVod?.id ? delVod.login : undefined)
  sonando =
    login !== undefined && detalle.fase === "reproduciendo" && !detalle.pausado
      ? { hasta: Date.now() + SIGUE_MS, login }
      : null
})
setInterval(() => {
  if (sonando !== null && Date.now() < sonando.hasta) addWatchMinute(sonando.login)
}, 60_000)

// Si no se pudo pedir la lista del VOD, lo de antes se paró (vodPreparar) sin cerrar el servicio ni los mandos del
// sistema, que siguen esperando al VOD: sin nada abierto, la app los cierra (canalMinimizar llama a cerrarCanal). Al
// reintentar, vodAbrir los vuelve a poner.
const sinNadaQueVer = (): void => android.canalMinimizar()

// Abre el VOD al montarse, donde se dejó (unos segundos antes, vod-progress.ts) o en «desde» (al retroceder un directo),
// salvo que ya esté abierto (volver desde la esquina). «reanudado»: desde dónde se ha reanudado, para decirlo.
export const useMedia3Vod = (
  id: string,
  desde: number | null,
  zona: RefObject<HTMLElement | null>,
) => {
  const [estado, setEstado] = useState(CARGANDO_VOD)
  const [reanudado, setReanudado] = useState<number | null>(null)
  const posicion = useRef(0)
  // El VOD de ahora: lo que llega tarde de otro (reintentar) ya no cuenta.
  const actual = useRef(id)
  // Reintentando: hasta que la app abra el VOD otra vez, su fallo de antes (que sigue diciendo a cada tic) no cuenta, y
  // otro toque no lo abre dos veces.
  const reintentando = useRef(false)
  // La velocidad, como la del VOD de antes (otro de sus vídeos, un reintento), como en la extensión: la app abre cada VOD
  // a 1×. «ponerRitmo»: al empezar a sonar el que se acaba de abrir.
  const ritmo = useRef(1)
  const ponerRitmo = useRef(false)

  useEffect(() => {
    setEstado(CARGANDO_VOD)
    setReanudado(null)
    rutaVod = location.hash
    actual.current = id
    posicion.current = 0
    reintentando.current = false
    let activo = true
    const onEvento = (event: Event): void => {
      const detalle = (event as CustomEvent<EventoVod>).detail
      if (detalle.vod !== id) return
      if (reintentando.current && detalle.fase === "error") return
      reintentando.current = false
      if (detalle.fase === "reproduciendo") {
        if (!ponerRitmo.current) ritmo.current = detalle.velocidad
        else if (detalle.velocidad !== ritmo.current) android.vodVelocidad(ritmo.current)
        ponerRitmo.current = false
      }
      posicion.current = detalle.posicion
      const nuevo: EstadoVod = {
        bufer: detalle.bufer,
        calidad: detalle.calidad,
        calidades: detalle.calidades,
        duracion: detalle.duracion,
        esperando: detalle.esperando,
        fase: detalle.fase,
        pausado: detalle.pausado,
        posicion: detalle.posicion,
        sonando: detalle.sonando,
        velocidad: detalle.velocidad,
      }
      setEstado(nuevo)
    }
    addEventListener("goodttv-reproductor", onEvento)
    if (!android.vodPreparar(id)) {
      const inicio = desde ?? resumeAt(vodProgress(id))
      posicion.current = inicio
      // Mientras llega, ya en «inicio»: el chat del vídeo empieza a pedir desde ahí, no desde el principio.
      setEstado({ ...CARGANDO_VOD, posicion: inicio })
      ponerRitmo.current = ritmo.current !== 1
      if (desde === null && inicio > 0) setReanudado(inicio)
      vodPlayback(id)
        .then((lista) => {
          if (activo) android.vodAbrir(id, lista, inicio)
        })
        .catch(() => {
          if (!activo) return
          setEstado({ ...CARGANDO_VOD, fase: "error", posicion: inicio })
          sinNadaQueVer()
        })
    }
    return () => {
      activo = false
      actual.current = ""
      removeEventListener("goodttv-reproductor", onEvento)
      minimizarSiSale()
    }
  }, [desde, id])

  useZona(zona)

  const pausar = useCallback((pausa: boolean) => android.canalPausar(pausa), [])
  const irA = useCallback((segundos: number) => android.vodIrA(segundos), [])
  const saltar = useCallback((segundos: number) => android.vodIrA(posicion.current + segundos), [])
  const velocidad = useCallback((valor: number) => android.vodVelocidad(valor), [])
  const calidad = useCallback((nombre: string | null) => android.vodCalidad(nombre ?? ""), [])
  // Otra vez, donde iba, con la lista pedida de nuevo si la de antes ya no vale. Si mientras tanto se ha pasado a otra
  // cosa, ya no.
  const reintentar = useCallback(() => {
    if (reintentando.current) return
    reintentando.current = true
    const desdeAqui = posicion.current
    setEstado({ ...CARGANDO_VOD, posicion: desdeAqui })
    ponerRitmo.current = ritmo.current !== 1
    vodPlayback(id)
      .then((lista) => {
        if (actual.current === id) android.vodAbrir(id, lista, desdeAqui)
      })
      .catch(() => {
        if (actual.current !== id) return
        reintentando.current = false
        setEstado({ ...CARGANDO_VOD, fase: "error", posicion: desdeAqui })
        sinNadaQueVer()
      })
  }, [id])
  return { calidad, estado, irA, pausar, reanudado, reintentar, saltar, velocidad }
}
