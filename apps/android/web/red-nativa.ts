// La red de Twitch desde una WebView de Android. La página vive en https://appassets.androidplatform.net, un origen
// ajeno para Twitch: la lista maestra de usher no trae CORS para él, las listas de variante dan 403 con su Origin y
// los trozos del VOD no traen CORS (investigacion/navegador/plataforma.md, §3). Esas peticiones las hace la app en
// nativo, sin Origin, como el fondo de la extensión: la página pide /red a su propio origen con la petición original
// en una cabecera, y la app la atiende en shouldInterceptRequest (Paginas.kt y RedNativa.kt), que solo pide a Twitch.
// Van directos por la red de la WebView los trozos en directo (*.hls.ttvnw.net), que admiten cualquier Origin, salvo con
// todo=true (para comparar), y los emotes del chat de 7TV, BTTV y FFZ (EmoteCatalog), que traen CORS para cualquiera.

const DIRECT = /\.hls\.ttvnw\.net$/
const EMOTES = new Set(["7tv.io", "api.betterttv.net", "api.frankerfacez.com"])

// Base64 de UTF-8: el valor de una cabecera solo admite Latin-1.
const encode = (text: string): string =>
  btoa(Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join(""))

export type NativeRequest = {
  readonly body: string | null
  readonly headers: Readonly<Record<string, string>>
  readonly method: string
  readonly url: string
}

// Para medir: cada petición atendida en nativo, con su host, el código y lo que tardó hasta las cabeceras.
export type NativeDone = (host: string, status: number, ms: number) => void

export const createRedNativa = (
  nativeFetch: typeof fetch,
  origin: string,
  todo: boolean,
  onDone: NativeDone = () => undefined,
): typeof fetch => {
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin === origin || EMOTES.has(url.hostname) || (!todo && DIRECT.test(url.hostname))) {
      return nativeFetch(request)
    }
    const native: NativeRequest = {
      // Lo único que se envía con cuerpo son las consultas a gql.twitch.tv: texto corto.
      body: request.method === "GET" || request.method === "HEAD" ? null : await request.text(),
      headers: Object.fromEntries(request.headers),
      method: request.method,
      url: url.href,
    }
    const started = performance.now()
    const response = await nativeFetch(`${origin}/red`, {
      headers: { "x-goodttv-peticion": encode(JSON.stringify(native)) },
      signal: request.signal,
    })
    onDone(url.hostname, response.status, performance.now() - started)
    // Como la respuesta original: quien la lea resuelve con ella las URL relativas.
    Object.defineProperty(response, "url", { value: url.href })
    return response
  }
}
