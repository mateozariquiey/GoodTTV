import { X509Certificate } from "node:crypto"
import { readFile } from "node:fs"
import { readFile as readFileAsync } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createServer } from "node:https"
import { extname, resolve, sep } from "node:path"

type StaticHttpsServerOptions = {
  readonly assetsPath: string
  readonly certificatePath: string
  // Rutas dinámicas (el directo del reproductor propio): devuelve true si ha atendido la petición.
  readonly dynamic?: (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ) => boolean
  readonly keyPath: string
}

export type StaticHttpsServer = {
  readonly certificateFingerprint: string
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

export const startStaticHttpsServer = async (
  options: StaticHttpsServerOptions,
): Promise<StaticHttpsServer> => {
  const [certificate, key] = await Promise.all([
    readFileAsync(options.certificatePath),
    readFileAsync(options.keyPath),
  ])
  const root = resolve(options.assetsPath)
  let expectedHost = ""

  const server = createServer({ cert: certificate, key }, (request, response) => {
    if (request.headers.host !== expectedHost) {
      sendStatus(response, 421)
      return
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD")
      sendStatus(response, 405)
      return
    }

    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", `https://${expectedHost}`).pathname)
    } catch (error) {
      if (error instanceof URIError) {
        sendStatus(response, 400)
        return
      }
      throw error
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
          "default-src 'self'; script-src 'self' https://player.twitch.tv; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; frame-src https://player.twitch.tv https://www.twitch.tv; connect-src 'self' https://*.ttvnw.net; media-src 'self' blob:; worker-src 'self' blob:",
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
    throw new TypeError("Loopback HTTPS server did not expose a TCP address")
  }

  expectedHost = `localhost:${address.port}`

  return {
    certificateFingerprint: new X509Certificate(certificate).fingerprint256,
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
    origin: `https://${expectedHost}`,
  }
}
