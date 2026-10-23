import { createDirecto, type Directo, type DirectoOptions } from "./directo"

// En una página (la extensión, Android) no hay servidor local: las peticiones fetch de la página a sus propias rutas
// /stream/ las atiende el directo en memoria, como un service worker. Así el reproductor pide igual que en la tele
// (useHlsPlayer.ts), con hls.js usando su FetchLoader. Todo lo demás pasa al fetch del navegador.
export const createDirectoFetch = (
  directo: Directo,
  origin: string,
  nativeFetch: typeof fetch,
): typeof fetch => {
  const prefix = `${origin}/stream/` // por prefijo: URL.origin no vale con chrome-extension: fuera de Chrome
  return async (input, init) => {
    const request = new Request(input, init)
    if (!request.url.startsWith(prefix)) return nativeFetch(request)
    const url = new URL(request.url)
    const { signal } = request
    signal.throwIfAborted()
    // Como un fetch de verdad: si quien pide lo cancela, la promesa falla aunque el directo aún no haya contestado.
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    })
    const response = await Promise.race([
      directo.handle(url, { range: request.headers.get("range"), signal }),
      aborted,
    ])
    // Y si lo cancela mientras lee el cuerpo, la lectura falla.
    const answer = new Response(response.body?.pipeThrough(new TransformStream(), { signal }), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
    // hls.js resuelve las URL relativas de la lista (/stream/vod?…) con la de la respuesta, que en una Response
    // construida está vacía.
    Object.defineProperty(answer, "url", { value: url.href })
    return answer
  }
}

// Crea el directo y pone en la página el fetch que lo atiende. El directo pide a Twitch con el fetch original del
// navegador, así que sus peticiones no pasan por sí mismo.
export const installDirecto = (options: DirectoOptions = {}): Directo => {
  const nativeFetch = globalThis.fetch.bind(globalThis)
  const directo = createDirecto({ fetch: nativeFetch, ...options })
  globalThis.fetch = createDirectoFetch(directo, location.origin, nativeFetch)
  return directo
}
