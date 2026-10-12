import type { Directo } from "@goodttv/sin-anuncios"
import { describe, expect, it, vi } from "vitest"
import { createDirectoFetch } from "./directo-fetch"

const ORIGIN = "chrome-extension://abc"

const setup = (handle: Directo["handle"]) => {
  const directo: Directo = { handle: vi.fn(handle), stop: () => undefined }
  const native = vi.fn(async () => new Response("red"))
  return { directo, fetch: createDirectoFetch(directo, ORIGIN, native), native }
}

describe("createDirectoFetch", () => {
  it("atiende /stream/ de la propia página con el directo, con su Range y la URL de la respuesta", async () => {
    const { directo, fetch, native } = setup(async () => new Response("#EXTM3U\n"))
    const response = await fetch(new Request(`${ORIGIN}/stream/canal/live.m3u8?modo=directo`), {
      headers: { Range: "bytes=0-9" },
    })
    expect(await response.text()).toBe("#EXTM3U\n")
    expect(response.url).toBe(`${ORIGIN}/stream/canal/live.m3u8?modo=directo`)
    expect(native).not.toHaveBeenCalled()
    const [url, request] = vi.mocked(directo.handle).mock.calls[0] ?? []
    expect(url?.href).toBe(`${ORIGIN}/stream/canal/live.m3u8?modo=directo`)
    expect(request?.range).toBe("bytes=0-9")
  })

  it("deja pasar lo demás al fetch del navegador", async () => {
    const { directo, fetch, native } = setup(async () => new Response())
    await fetch("https://video-edge.ttvnw.net/v1/segment/1.ts")
    await fetch(`${ORIGIN}/reproductor.html`)
    await fetch("https://otro.example/stream/canal/live.m3u8")
    expect(native).toHaveBeenCalledTimes(3)
    expect(directo.handle).not.toHaveBeenCalled()
  })

  it("falla como un fetch cancelado aunque el directo siga esperando", async () => {
    const { fetch } = setup(() => new Promise<Response>(() => undefined))
    const controller = new AbortController()
    const pending = fetch(`${ORIGIN}/stream/canal/live.m3u8?_HLS_msn=9`, {
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  it("si se cancela mientras llega el cuerpo, la lectura falla", async () => {
    // Un trozo del VOD que aún se está descargando: un trozo y la descarga sigue abierta.
    const downloading = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(new Uint8Array(1024)),
    })
    const { fetch } = setup(async () => new Response(downloading))
    const controller = new AbortController()
    const response = await fetch(`${ORIGIN}/stream/vod?u=x`, { signal: controller.signal })
    controller.abort()
    await expect(response.arrayBuffer()).rejects.toMatchObject({ name: "AbortError" })
  })

  it("pasa la señal al directo para que deje de esperar", async () => {
    let seen: AbortSignal | undefined
    const { fetch } = setup(async (_url, request) => {
      seen = request?.signal
      return new Response()
    })
    const controller = new AbortController()
    await fetch(`${ORIGIN}/stream/canal/info`, { signal: controller.signal })
    controller.abort()
    expect(seen?.aborted).toBe(true)
  })
})
