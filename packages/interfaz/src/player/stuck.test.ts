import { describe, expect, it } from "vitest"
import {
  aheadOf,
  isStuck,
  MEDIA_RECOVERIES,
  MEDIA_RECOVERY_FORGET_MS,
  nextMediaRecovery,
  playedMeter,
  STUCK_WATCH,
  STUCK_WITH_DATA_MS,
  STUCK_WITHOUT_DATA_MS,
  type StuckWatch,
  watchStuck,
} from "./stuck"

describe("los errores fatales de medios", () => {
  it("se recuperan tres veces seguidas, y el cuarto ya se enseña", () => {
    let count = 0
    for (let i = 1; i <= MEDIA_RECOVERIES; i++) {
      const next = nextMediaRecovery(count, 0)
      expect(next).toBe(i)
      count = next ?? count
    }
    expect(nextMediaRecovery(count, 0)).toBeNull()
  })

  it("el vídeo avanzando un rato desde el último hace olvidar los de antes", () => {
    expect(nextMediaRecovery(MEDIA_RECOVERIES, MEDIA_RECOVERY_FORGET_MS)).toBe(1)
    expect(nextMediaRecovery(MEDIA_RECOVERIES, MEDIA_RECOVERY_FORGET_MS - 5000)).toBeNull()
    expect(nextMediaRecovery(1, MEDIA_RECOVERY_FORGET_MS - 5000)).toBe(2)
  })
})

describe("un vídeo parado sin pausa", () => {
  it("con datos por delante todo ese rato, está atascado a los 30 s", () => {
    expect(isStuck(STUCK_WITH_DATA_MS - 5000, STUCK_WITH_DATA_MS - 5000)).toBe(false)
    expect(isStuck(STUCK_WITH_DATA_MS, STUCK_WITH_DATA_MS)).toBe(true)
  })

  it("sin datos, espera lo que dura una pausa global sin relleno (hasta 3 min)", () => {
    expect(isStuck(STUCK_WITH_DATA_MS, 0)).toBe(false)
    expect(isStuck(180_000, 0)).toBe(false)
    expect(isStuck(STUCK_WITHOUT_DATA_MS, 0)).toBe(true)
  })
})

describe("el búfer por delante", () => {
  const ranges = (...pairs: readonly (readonly [number, number])[]) => ({
    end: (index: number) => pairs[index]?.[1] ?? 0,
    length: pairs.length,
    start: (index: number) => pairs[index]?.[0] ?? 0,
  })

  it("el búfer por delante es el seguido: lo del otro lado de un hueco no cuenta", () => {
    expect(aheadOf(ranges([0, 10]), 4)).toBe(6)
    expect(aheadOf(ranges([0, 10], [12, 30]), 10)).toBe(0)
    expect(aheadOf(ranges([12, 30]), 10)).toBe(0)
  })
})

describe("el vigilante", () => {
  const TICK = 5000
  const sample = { aheadS: 0, elapsedMs: TICK, paused: false, playedS: 0, started: true }
  const run = (watch: StuckWatch, ticks: number, each: Partial<typeof sample>): StuckWatch => {
    let next = watch
    for (let i = 0; i < ticks; i++) next = watchStuck(next, { ...sample, ...each })
    return next
  }

  it("parado con datos, avisa a los 30 s", () => {
    expect(run(STUCK_WATCH, 5, { aheadS: 3 }).notice).toBe(false)
    expect(run(STUCK_WATCH, 6, { aheadS: 3 }).notice).toBe(true)
  })

  it("parado sin datos, a los 4 min", () => {
    expect(run(STUCK_WATCH, 47, {}).notice).toBe(false)
    expect(run(STUCK_WATCH, 48, {}).notice).toBe(true)
  })

  it("tras una espera larga y normal sin datos, el primer fragmento no dispara el aviso", () => {
    const waited = run(STUCK_WATCH, 24, {}) // 2 min de anuncios sin relleno
    expect(run(waited, 1, { aheadS: 2 }).notice).toBe(false)
    expect(run(waited, 5, { aheadS: 2 }).notice).toBe(false)
    expect(run(waited, 6, { aheadS: 2 }).notice).toBe(true)
  })

  it("en pausa no cuenta, y reproducir un poco pone la cuenta a cero", () => {
    expect(run(STUCK_WATCH, 100, { aheadS: 3, paused: true }).notice).toBe(false)
    const almost = run(STUCK_WATCH, 5, { aheadS: 3 })
    expect(run(run(almost, 1, { playedS: 5 }), 5, { aheadS: 3 }).notice).toBe(false)
  })

  it("los saltos del reproductor no cuentan como reproducir: sin tramos nuevos, sigue parado", () => {
    // currentTime salta cada vuelta, pero lo reproducido desde cada salto (playedS) es nada.
    expect(run(STUCK_WATCH, 6, { aheadS: 3, playedS: 0 }).notice).toBe(true)
  })

  it("antes de que el directo llegue a verse no avisa: eso es del plazo del arranque", () => {
    expect(run(STUCK_WATCH, 60, { started: false }).notice).toBe(false)
  })

  it("el aviso se va cuando ha reproducido 10 s seguidos o a trozos, no al primer movimiento", () => {
    const stuck = run(STUCK_WATCH, 6, { aheadS: 3 })
    const moved = run(stuck, 1, { playedS: 2 })
    expect(moved.notice).toBe(true)
    expect(run(moved, 3, {}).notice).toBe(true) // se para otra vez: el aviso sigue
    expect(run(moved, 2, { playedS: 5 }).notice).toBe(false)
  })

  it("lo reproducido desde la última recuperación es tiempo de vídeo, no vueltas del temporizador", () => {
    // Seis avances de 0,1 s no son 30 s viendo; tres vueltas con 60 s reproducidos cada una (temporizador frenado), sí.
    expect(run(STUCK_WATCH, 6, { playedS: 0.1 }).advancedMs).toBeCloseTo(600)
    expect(run(STUCK_WATCH, 3, { playedS: 60 }).advancedMs).toBe(180_000)
    expect(
      nextMediaRecovery(MEDIA_RECOVERIES, run(STUCK_WATCH, 6, { playedS: 0.1 }).advancedMs),
    ).toBeNull()
    expect(
      nextMediaRecovery(MEDIA_RECOVERIES, run(STUCK_WATCH, 3, { playedS: 60 }).advancedMs),
    ).toBe(1)
  })
})

describe("lo reproducido de verdad", () => {
  it("suma lo que avanza el vídeo, también lo que ya se había visto antes", () => {
    const meter = playedMeter(100)
    meter.sample(102, false)
    meter.sample(105, false)
    expect(meter.take()).toBe(5)
    meter.jumped(60) // 40 s atrás
    meter.sample(63, false)
    expect(meter.take()).toBe(3)
    expect(meter.take()).toBe(0)
  })

  it("un salto no cuenta, ni hacia delante ni hacia atrás", () => {
    const meter = playedMeter(100)
    meter.jumped(130)
    meter.sample(130, false)
    meter.jumped(90)
    meter.sample(90, false)
    expect(meter.take()).toBe(0)
  })

  it("lo reproducido justo antes de un salto se conserva", () => {
    const meter = playedMeter(100)
    meter.sample(103, false) // el último «timeupdate» antes de «Ir al directo»
    meter.jumped(140)
    expect(meter.take()).toBe(3)
  })

  it("quien lee con el salto ya hecho y antes del evento «seeking» no lo cuenta", () => {
    const meter = playedMeter(100)
    // currentTime ya marca 140 y video.seeking es true, pero el oyente de «seeking» aún no ha corrido.
    meter.sample(140, true)
    expect(meter.take()).toBe(0)
    meter.jumped(140)
    meter.sample(141, false)
    expect(meter.take()).toBe(1)
  })

  it("al reconectar el medio tras un error, el sitio donde va a empezar no cuenta como reproducido", () => {
    const meter = playedMeter(100)
    meter.jumped(0) // «emptied»: el <video> vuelve a 0
    // hls.js ya ha fijado dónde empezar: currentTime marca 100 sin datos del medio y sin «seeking» (quien llama pasa
    // true mientras readyState es 0).
    meter.sample(100, true)
    expect(meter.take()).toBe(0)
    meter.jumped(100) // «loadedmetadata»
    meter.sample(102, false)
    expect(meter.take()).toBe(2)
  })
})
