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

describe("https-server defect regressions", () => {
  let assetsPath = ""
  let server: StaticHttpsServer | undefined

  beforeAll(async () => {
    assetsPath = await mkdtemp(join(tmpdir(), "vacuumstream-https-defects-"))
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

  it.fails("D-xc-security-2 treats URL-construction failures as 400 and server recovers", async () => {
    // Given a malformed URL followed by a normal request
    const malformedUrl = new URL("//[", server?.origin)
    const healthyUrl = new URL("/", server?.origin)

    // When the malformed URL reaches the static server
    const malformedResponse = await request(malformedUrl, malformedUrl.host)
    const healthyResponse = await request(healthyUrl, healthyUrl.host)

    // Then it is rejected with 400 and the server remains usable
    expect(malformedResponse.status).toBe(400)
    expect(healthyResponse.status).toBe(200)
    expect(healthyResponse.body).toBe("<h1>VacuumStream</h1>")
  })
})
