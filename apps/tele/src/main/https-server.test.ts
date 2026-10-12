import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { get } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type StaticHttpsServer, startStaticHttpsServer } from "./https-server"

type Response = {
  readonly body: string
  readonly status: number
}

const request = (url: URL, host: string): Promise<Response> =>
  new Promise((resolve, reject) => {
    const request = get(
      url,
      {
        headers: { host },
        rejectUnauthorized: false,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode ?? 0,
          })
        })
      },
    )
    request.on("error", reject)
  })

describe("static HTTPS server", () => {
  let assetsPath = ""
  let server: StaticHttpsServer | undefined

  beforeAll(async () => {
    assetsPath = await mkdtemp(join(tmpdir(), "vacuumstream-https-"))
    await writeFile(join(assetsPath, "index.html"), "<h1>VacuumStream</h1>")
    server = await startStaticHttpsServer({
      assetsPath,
      certificatePath: join(import.meta.dirname, "../../resources/certs/localhost-cert.pem"),
      keyPath: join(import.meta.dirname, "../../resources/certs/localhost-key.pem"),
    })
  })

  afterAll(async () => {
    await server?.close()
    await rm(assetsPath, { recursive: true })
  })

  it("serves bundled assets when the loopback Host is valid", async () => {
    // Given a request for a bundled renderer asset
    const url = new URL("/", server?.origin)

    // When the request uses the bound localhost authority
    const response = await request(url, url.host)

    // Then only the static asset is returned
    expect(response).toEqual({ body: "<h1>VacuumStream</h1>", status: 200 })
  })

  it("rejects requests with a foreign Host header", async () => {
    // Given a request reaching the loopback listener
    const url = new URL("/", server?.origin)

    // When its authority does not match the bound localhost origin
    const response = await request(url, "attacker.example")

    // Then the server rejects the misdirected request
    expect(response.status).toBe(421)
  })

  it("rejects NUL paths without terminating the server", async () => {
    // Given a malformed path followed by a normal request
    const malformedUrl = new URL("/%00", server?.origin)
    const healthyUrl = new URL("/", server?.origin)

    // When the malformed path reaches the static server
    const malformedResponse = await request(malformedUrl, malformedUrl.host)
    const healthyResponse = await request(healthyUrl, healthyUrl.host)

    // Then it is rejected and the server remains usable
    expect(malformedResponse.status).toBe(400)
    expect(healthyResponse.status).toBe(200)
  })
})
