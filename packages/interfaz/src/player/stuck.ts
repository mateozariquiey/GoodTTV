// Cuándo deja el reproductor del directo (useHlsPlayer.ts) de esperar a que el vídeo se arregle solo y ofrece
// «Reintentar». Hasta entonces, la imagen parada sin aviso obligaba a salir del canal y volver a entrar.

// Errores fatales de medios (el decodificador, el búfer o un vídeo que no avanza con datos de sobra): se recuperan
// volviendo a conectar el <video> (recoverMediaError). Si se repiten sin que el vídeo llegue a avanzar, otra vuelta no
// sirve. Tras tres intentos seguidos, el error se enseña con «Reintentar», que crea un reproductor nuevo. Y 30 s de vídeo
// avanzando desde el último ya son de un directo que funciona: el error siguiente vuelve a contar desde el primero.
export const MEDIA_RECOVERIES = 3
export const MEDIA_RECOVERY_FORGET_MS = 30_000

// Los intentos seguidos tras un error fatal de medios, con este incluido, o null si ya no quedan. count: los de antes;
// advancedMs: lo que ha avanzado el vídeo desde el último.
export const nextMediaRecovery = (count: number, advancedMs: number): number | null => {
  const before = advancedMs >= MEDIA_RECOVERY_FORGET_MS ? 0 : count
  return before >= MEDIA_RECOVERIES ? null : before + 1
}

// Un vídeo que no avanza sin estar en pausa, ya reproduciendo. Hay paradas normales, y ninguna llega a estos tiempos:
// - Con datos por delante (al menos DATA_AHEAD_S en el búfer), el vídeo podría seguir, y lo que lo para es el propio
//   reproductor. hls.js lo empuja a los ~1-4 s, y si no se mueve, da un error fatal de medios (arriba). A los 30 s no hay
//   nada que esperar.
// - Sin datos, el vídeo espera al directo. Las esperas normales: un canal que entrega a trompicones (hasta 12 s, REN-2),
//   la primera pausa global hasta que llega el VOD (12-22 s, D11) y, en *Directo* o en un canal sin VOD público, una
//   pausa global entera, que dura lo que la tanda de anuncios de Twitch: hasta 3 min. Por eso 4 min. Es antes de que
//   hls.js se rinda con las listas (60 reintentos, unos 8 min): la lista la sirve la propia página (la extensión) o el
//   servidor local (la TV), que siguen contestando aunque no llegue nada de Twitch, así que ese error ni llega. El aviso
//   no para nada: si el directo vuelve solo, el vídeo sigue y el aviso se va.
// Lo demás no es una parada: la pausa de la persona (también la de «pausar es retroceder») cuenta como pausa, el relleno
// con el VOD avanza, y una pestaña oculta que sigue sonando (D48) o una celda muda de la cuadrícula también avanzan,
// aunque el navegador no las pinte.
export const DATA_AHEAD_S = 1
export const STUCK_WITH_DATA_MS = 30_000
export const STUCK_WITHOUT_DATA_MS = 240_000

// ¿Lleva el vídeo parado sin pausa más de lo que dura cualquier parada normal? frozenMs: todo lo que lleva parado;
// frozenWithDataMs: lo último de ese rato que ha pasado seguido con datos por delante. Van aparte porque una espera
// larga y normal sin datos (una tanda de anuncios sin relleno) no debe contar para el plazo corto en cuanto llega el
// primer fragmento: desde ahí, el vídeo tiene sus 30 s para reanudar.
export const isStuck = (frozenMs: number, frozenWithDataMs: number): boolean =>
  frozenWithDataMs >= STUCK_WITH_DATA_MS || frozenMs >= STUCK_WITHOUT_DATA_MS

// Con el aviso puesto, se va cuando el vídeo ha reproducido tanto (s) desde que salió. No a la primera: tras 4 min sin
// red, con la red de vuelta el vídeo avanzó 2 s con lo primero que llegó y se volvió a parar (19 nov). Si el aviso se
// hubiera ido entonces, no habría vuelto hasta pasados otros 4 min.
export const UNSTUCK_S = 10

type Ranges = {
  readonly length: number
  readonly start: (index: number) => number
  readonly end: (index: number) => number
}

// Los segundos de búfer seguidos desde lo que se ve. Lo que haya al otro lado de un hueco no cuenta: el vídeo no puede
// llegar a ello sin saltar.
export const aheadOf = (buffered: Ranges | undefined, time: number): number => {
  for (let i = 0; i < (buffered?.length ?? 0); i++) {
    const start = buffered?.start(i) ?? 0
    const end = buffered?.end(i) ?? 0
    if (time >= start && time <= end) return end - time
  }
  return 0
}

// Lo que el vigilante del reproductor lleva visto: cuánto lleva parado el vídeo, cuánto ha reproducido desde la última
// recuperación de un error de medios, y si está enseñando el aviso.
export type StuckWatch = {
  readonly advancedMs: number
  readonly frozenMs: number
  readonly frozenWithDataMs: number
  readonly notice: boolean
  readonly recoveredS: number // lo reproducido desde que salió el aviso
}
export const STUCK_WATCH: StuckWatch = {
  advancedMs: 0,
  frozenMs: 0,
  frozenWithDataMs: 0,
  notice: false,
  recoveredS: 0,
}

// Una vuelta del vigilante. playedS: lo reproducido de verdad desde la vuelta anterior, sin los saltos (useHlsPlayer lo
// cuenta desde donde deja cada «seeking»: mirar si cambia currentTime no vale, porque los saltos del propio reproductor
// al directo lo mueven aunque la imagen siga parada); aheadS: el búfer seguido por delante;
// elapsedMs: lo que ha pasado desde la vuelta anterior, con tope (el rato con el equipo suspendido o con los
// temporizadores frenados de una pestaña oculta no cuenta como vídeo parado); started: el directo ya llegó a verse
// (antes, el que avisa es el plazo del arranque).
export const watchStuck = (
  watch: StuckWatch,
  sample: {
    readonly aheadS: number
    readonly elapsedMs: number
    readonly paused: boolean
    readonly playedS: number
    readonly started: boolean
  },
): StuckWatch => {
  if (sample.paused) return { ...watch, frozenMs: 0, frozenWithDataMs: 0 }
  if (sample.playedS > 0.05) {
    const recoveredS = watch.notice ? watch.recoveredS + sample.playedS : 0
    const notice = watch.notice && recoveredS < UNSTUCK_S
    return {
      advancedMs: watch.advancedMs + sample.playedS * 1000,
      frozenMs: 0,
      frozenWithDataMs: 0,
      notice,
      recoveredS: notice ? recoveredS : 0,
    }
  }
  const frozenMs = watch.frozenMs + sample.elapsedMs
  const frozenWithDataMs =
    sample.aheadS >= DATA_AHEAD_S ? watch.frozenWithDataMs + sample.elapsedMs : 0
  const notice = watch.notice || (sample.started && isStuck(frozenMs, frozenWithDataMs))
  return { ...watch, frozenMs, frozenWithDataMs, notice }
}

// Cuenta lo que el vídeo reproduce de verdad (s), sin los saltos. currentTime solo cambia reproduciendo o saltando, así
// que basta con ir sumando sus avances y no sumar los de un salto:
// - sample(time, seeking): lo que marca el <video> ahora. Se llama en cada «timeupdate» (varias veces por segundo
//   mientras reproduce) y antes de leer, así que lo reproducido justo antes de un salto ya está sumado. Con el vídeo
//   saltando (seeking), o sin datos del medio al conectarlo, no suma ni se mueve: al asignar currentTime, el reloj ya
//   marca el sitio nuevo antes de que llegue el evento «seeking» (y al reconectar el medio, sin evento ninguno), y
//   quien lea en ese hueco (un temporizador) contaría el salto como reproducido.
// - jumped(time): un salto ha empezado o terminado, o el medio se ha vaciado o acaba de cargar («seeking», «seeked»,
//   «emptied» y «loadedmetadata»). Se sigue contando desde ahí.
// - take(): lo reproducido desde la última vez que se recogió.
// Sumar video.played no vale: es la unión de los tramos vistos, y volver a ver uno no la hace crecer.
export const playedMeter = (start: number) => {
  let from = start
  let seconds = 0
  return {
    jumped: (time: number): void => {
      from = time
    },
    sample: (time: number, seeking: boolean): void => {
      if (seeking) return
      if (time > from) seconds += time - from
      from = time
    },
    take: (): number => {
      const taken = seconds
      seconds = 0
      return taken
    },
  }
}
