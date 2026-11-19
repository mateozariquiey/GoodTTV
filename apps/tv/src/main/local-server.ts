import { readFile } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, resolve, sep } from "node:path"

// La interfaz y el directo del reproductor propio (/stream/), en el mismo origen: http://127.0.0.1:<puerto>, solo en
// loopback. Es HTTP sin cifrar porque no sale de la máquina, y Chromium trata 127.0.0.1 como contexto seguro. Hasta la
// 0.5.1 era HTTPS con un certificado propio, porque el reproductor oficial de Twitch lo exigía en su `parent`.
// El origen lleva la dirección y no «localhost»: Chromium resuelve localhost primero a ::1, donde no escuchamos, y
// otro proceso de la máquina que abriera ese mismo puerto en ::1 recibiría la página y, con ella, el IPC de la app.

type LocalServerOptions = {
  readonly assetsPath: string
  // Rutas dinámicas (el directo del reproductor propio): devuelve true si ha atendido la petición.
  readonly dynamic?: (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ) => boolean
}

export type LocalServer = {
  readonly close: () => Promise<void>
  readonly origin: string
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
}

const sendStatus = (response: ServerResponse, status: number): void => {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  })
  response.end()
}

export const startLocalServer = async (options: LocalServerOptions): Promise<LocalServer> => {
  const root = resolve(options.assetsPath)
  let expectedHost = ""

  const server = createServer((request, response) => {
    if (request.headers.host !== expectedHost) {
      sendStatus(response, 421)
      return
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD")
      sendStatus(response, 405)
      return
    }

    // Solo la propia página: una de otro origen (otra pestaña de un navegador de la máquina) no puede leer la
    // respuesta, pero sí pedir /stream/<otro canal> y cortar el directo que se ve. Chromium manda siempre esta
    // cabecera; «none» es la carga de la página al abrir la app.
    const site = request.headers["sec-fetch-site"]
    if (site !== undefined && site !== "same-origin" && site !== "none") {
      sendStatus(response, 403)
      return
    }

    // Una dirección que no se puede analizar o decodificar (TypeError o URIError) es una petición mal hecha.
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${expectedHost}`).pathname)
    } catch {
      sendStatus(response, 400)
      return
    }

    if (pathname.includes("\0")) {
      sendStatus(response, 400)
      return
    }

    if (options.dynamic?.(request, response, pathname) === true) return

    const assetPath = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`)
    if (!assetPath.startsWith(`${root}${sep}`)) {
      sendStatus(response, 404)
      return
    }

    readFile(assetPath, (error, body) => {
      if (error !== null) {
        sendStatus(response, error.code === "ENOENT" ? 404 : 500)
        return
      }

      response.writeHead(200, {
        "cache-control": extname(assetPath) === ".html" ? "no-store" : "public, max-age=31536000",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self' https://*.ttvnw.net; media-src 'self' blob:; worker-src 'self' blob:",
        "content-type": CONTENT_TYPES[extname(assetPath)] ?? "application/octet-stream",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-content-type-options": "nosniff",
      })
      response.end(request.method === "HEAD" ? undefined : body)
    })
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rejectListen)
      resolveListen()
    })
  })

  const address = server.address()
  if (address === null || typeof address === "string") {
    server.close()
    throw new TypeError("Loopback server did not expose a TCP address")
  }

  expectedHost = `127.0.0.1:${address.port}`

  return {
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error !== undefined) {
            rejectClose(error)
            return
          }
          resolveClose()
        })
      }),
    origin: `http://${expectedHost}`,
  }
}
