// @vitest-environment jsdom

import type { LiveArchive } from "@goodttv/contratos"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { archiveMoment, type LiveRewind, liveBar, useLiveArchive } from "./live-archive"
import { VOD_WARM_MS } from "./vod-cache"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const STARTED = Date.parse("2026-11-19T10:00:00Z")
const archiveOf = (id: string | null, recordedAt: string | null = null): LiveArchive => ({
  archiveId: id,
  recordedAt,
  startedAt: new Date(STARTED).toISOString(),
})

describe("un momento de la emisión en su VOD", () => {
  it("cuenta desde que empezó a grabarse", () => {
    const archive = archiveOf("10", new Date(STARTED + 30_000).toISOString())
    expect(archiveMoment(archive, STARTED + 90_000)).toEqual({ at: 60, id: "10" })
  })

  it("sin la hora de la grabación, desde que empezó la emisión", () => {
    expect(archiveMoment(archiveOf("10"), STARTED + 90_000)).toEqual({ at: 90, id: "10" })
  })

  it("antes de que empezara a grabarse, el principio", () => {
    expect(archiveMoment(archiveOf("10"), STARTED - 5000)).toEqual({ at: 0, id: "10" })
  })

  it("sin VOD, o con fechas que no se entienden, no hay a dónde ir", () => {
    expect(archiveMoment(null, STARTED)).toBeNull()
    expect(archiveMoment(archiveOf(null), STARTED)).toBeNull()
    expect(archiveMoment({ ...archiveOf("10"), startedAt: "ayer" }, STARTED)).toBeNull()
  })
})

describe("la barra del directo", () => {
  const rewind = (archive: LiveArchive | null, now: number): LiveRewind => ({ archive, now })

  it("va desde que empezó la emisión, y lo que se ve, la latencia antes de ahora", () => {
    expect(liveBar(rewind(archiveOf("10"), STARTED + 600_000), 8, true)).toEqual({
      duration: 600,
      position: 592,
      start: STARTED,
    })
  })

  it("sin saber la latencia, en el directo", () => {
    expect(liveBar(rewind(archiveOf("10"), STARTED + 600_000), null, true)?.position).toBe(600)
  })

  it("no sale sin VOD ni sin el directo a la vista", () => {
    expect(liveBar(rewind(null, STARTED), 8, true)).toBeNull()
    expect(liveBar(rewind(archiveOf(null), STARTED), 8, true)).toBeNull()
    expect(liveBar(rewind(archiveOf("10"), STARTED + 600_000), 8, false)).toBeNull()
  })

  it("con el reloj por detrás del comienzo, en cero", () => {
    expect(liveBar(rewind(archiveOf("10"), STARTED - 5000), 8, true)).toEqual({
      duration: 0,
      position: 0,
      start: STARTED,
    })
  })
})

describe("el VOD de la emisión en curso", () => {
  const archive = vi.fn<(login: string) => Promise<LiveArchive | null>>()
  const playback = vi.fn(async (id: string) => `https://usher.ttvnw.net/vod/${id}.m3u8`)
  const get = vi.fn(async () => null)
  let root: Root | undefined
  let rewind: LiveRewind | undefined
  const Probe = ({ login, onAir }: { readonly login: string; readonly onAir: boolean }) => {
    rewind = useLiveArchive(login, onAir)
    return null
  }
  const render = async (login: string, onAir: boolean): Promise<void> => {
    await act(async () => root?.render(createElement(Probe, { login, onAir })))
    await act(async () => {
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: STARTED + 600_000 })
    vi.stubGlobal("api", { vods: { archive, get, playback } })
    root = createRoot(document.body.appendChild(document.createElement("div")))
  })
  afterEach(() => {
    act(() => root?.unmount())
    rewind = undefined
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("no se pide hasta que se ve el directo", async () => {
    await render("ibai", false)
    expect(archive).not.toHaveBeenCalled()
    expect(rewind?.archive).toBeNull()
  })

  it("con el directo, lo pide, deja a mano su lista y la renueva mientras se ve", async () => {
    archive.mockResolvedValue(archiveOf("20"))
    await render("ibai", true)
    expect(archive).toHaveBeenCalledWith("ibai")
    expect(rewind?.archive?.archiveId).toBe("20")
    expect(playback).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTime(VOD_WARM_MS))
    expect(playback).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("el reloj de la barra avanza al segundo", async () => {
    archive.mockResolvedValue(archiveOf("21"))
    await render("ibai", true)
    const before = rewind?.now ?? 0
    await act(async () => vi.advanceTimersByTime(3000))
    expect((rewind?.now ?? 0) - before).toBe(3000)
  })

  it("sin VOD público, no hay nada que tener a mano", async () => {
    archive.mockResolvedValue(archiveOf(null))
    await render("ibai", true)
    expect(rewind?.archive?.archiveId).toBeNull()
    await act(async () => vi.advanceTimersByTime(VOD_WARM_MS))
    expect(playback).not.toHaveBeenCalled()
  })

  it("al dejar de verse el directo o pasar a otro canal, se olvida", async () => {
    archive.mockResolvedValue(archiveOf("22"))
    await render("ibai", true)
    await render("ibai", false)
    expect(rewind?.archive).toBeNull()
    // Lo del canal de antes, si llega tarde, tampoco vale para el nuevo.
    let answer: (value: LiveArchive | null) => void = () => undefined
    archive.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    await render("ibai", true)
    archive.mockResolvedValue(null)
    await render("otro", true)
    answer(archiveOf("23"))
    await act(async () => {
      await Promise.resolve()
    })
    expect(rewind?.archive).toBeNull()
  })
})
