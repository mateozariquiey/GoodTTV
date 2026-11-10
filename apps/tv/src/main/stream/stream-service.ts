// Directo sin anuncios para el reproductor propio (src/renderer/src/player/useHlsPlayer.ts), servido por el servidor
// HTTPS local de la app bajo /stream/. Las rutas y lo que hacen están en @goodttv/sin-anuncios (directo.ts); aquí solo
// se pasan las peticiones HTTP y sus respuestas.
import type { IncomingMessage, ServerResponse } from "node:http"
import { createDirecto, type EmpalmeEvent, parseSimulatedPause } from "@goodttv/sin-anuncios"

export type StreamService = {
  readonly handle: (request: IncomingMessage, response: ServerResponse, pathname: string) => boolean
  readonly stop: () => void
}

export const createStreamService = (
  log: (event: EmpalmeEvent) => void = () => undefined,
): StreamService => {
  const directo = createDirecto({
    log,
    // GOODTTV_PAUSA_SIMULADA="cada,duración[,arranque]" (s): pausas globales simuladas para probar el relleno.
    simulatedPause: parseSimulatedPause(process.env["GOODTTV_PAUSA_SIMULADA"] ?? ""),
  })

  const handle = (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): boolean => {
    if (!pathname.startsWith("/stream/")) return false
    const closed = new AbortController()
    request.on("close", () => closed.abort())
    const url = new URL(request.url ?? "/", "https://localhost")
    url.pathname = pathname // la que ya decodificó el servidor, como siempre
    directo
      .handle(url, { range: request.headers.range ?? null, signal: closed.signal })
      .then(async (reply) => {
        response.writeHead(reply.status, Object.fromEntries(reply.headers))
        if (reply.body === null) {
          response.end()
          return
        }
        for await (const chunk of reply.body) response.write(chunk)
        response.end()
      })
      .catch((error: unknown) => {
        // Se cortó a medias un trozo del VOD: si no fue porque el reproductor dejó de esperarlo, se registra.
        if (!closed.signal.aborted)
          log({ error: String(error).slice(0, 160), ev: "error-servidor" })
        if (!response.headersSent) response.writeHead(500).end()
        else response.end()
      })
    return true
  }

  return { handle, stop: directo.stop }
}
