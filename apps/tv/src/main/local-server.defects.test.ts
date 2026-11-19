import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { get } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type LocalServer, startLocalServer } from "./local-server"

type Response = {
  readonly body: string
  readonly status: number
}

const request = (url: URL, host: string): Promise<Response> =>
  new Promise((resolve, reject) => {
    const request = get(url, { headers: { host } }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => {
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          status: response.statusCode ?? 0,
        })
      })
    })
    request.on("error", reject)
  })

describe("local-server defect regressions", () => {
  let assetsPath = ""
  let server: LocalServer | undefined

  beforeAll(async () => {
    assetsPath = await mkdtemp(join(tmpdir(), "goodttv-local-server-defects-"))
    await writeFile(join(assetsPath, "index.html"), "<h1>VacuumStream</h1>")
    server = await startLocalServer({ assetsPath })
  })

  afterAll(async () => {
    await server?.close()
    await rm(assetsPath, { recursive: true })
  })

  it("D-xc-security-2 treats URL-construction failures as 400 and server recovers", async () => {
    // Given a request line whose target cannot be parsed as a URL, followed by a normal request
    const origin = new URL(server?.origin ?? "")
    const healthyUrl = new URL("/", origin)

    // When the malformed target reaches the static server (sent raw: the client would not build that URL)
    const malformedStatus = await new Promise<number>((resolve, reject) => {
      const malformed = get(
        { headers: { host: origin.host }, host: origin.hostname, path: "//[", port: origin.port },
        (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        },
      )
      malformed.on("error", reject)
    })
    const healthyResponse = await request(healthyUrl, healthyUrl.host)

    // Then it is rejected with 400 and the server remains usable
    expect(malformedStatus).toBe(400)
    expect(healthyResponse.status).toBe(200)
    expect(healthyResponse.body).toBe("<h1>VacuumStream</h1>")
  })

  it("rejects requests that another site makes to the loopback server", async () => {
    // Given a page from another origin in a browser on the same machine
    const url = new URL("/stream/otro/live.m3u8", server?.origin)

    // When it requests the stream of another channel blindly
    const status = await new Promise<number>((resolve, reject) => {
      const crossSite = get(
        url,
        { headers: { host: url.host, "sec-fetch-site": "cross-site" } },
        (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        },
      )
      crossSite.on("error", reject)
    })

    // Then it never reaches the stream handler
    expect(status).toBe(403)
  })
})
