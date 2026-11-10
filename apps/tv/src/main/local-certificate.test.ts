import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createLocalCertificate, loadLocalCertificate } from "./local-certificate"

const NOW = new Date("2026-11-04T12:00:00Z")
const FILE_NAME = "localhost-certificate.json"

describe("createLocalCertificate", () => {
  it("creates a self-signed end-entity certificate for localhost", () => {
    // Given a freshly created certificate
    const { certificate, key } = createLocalCertificate(NOW)

    // When it is parsed
    const parsed = new X509Certificate(certificate)

    // Then it is not a CA, it covers the loopback names and it matches its key
    expect(parsed.ca).toBe(false)
    expect(parsed.subject).toBe("CN=localhost")
    expect(parsed.issuer).toBe("CN=localhost")
    expect(parsed.subjectAltName).toBe("DNS:localhost, IP Address:127.0.0.1")
    expect(parsed.keyUsage).toEqual(["1.3.6.1.5.5.7.3.1"])
    expect(parsed.verify(createPublicKey(key))).toBe(true)
    expect(parsed.checkPrivateKey(createPrivateKey(key))).toBe(true)
    expect(new Date(parsed.validFrom).getTime()).toBeLessThan(NOW.getTime())
    expect(new Date(parsed.validTo).getUTCFullYear()).toBe(2036)
  })

  it("creates a different key and serial every time", () => {
    // Given two certificates
    const first = createLocalCertificate(NOW)
    const second = createLocalCertificate(NOW)

    // Then they share nothing
    expect(first.key).not.toBe(second.key)
    expect(new X509Certificate(first.certificate).serialNumber).not.toBe(
      new X509Certificate(second.certificate).serialNumber,
    )
  })

  it("encodes dates from 2050 as GeneralizedTime", () => {
    // Given a clock whose ten-year validity crosses 2050
    const parsed = new X509Certificate(
      createLocalCertificate(new Date("2045-06-01T00:00:00Z")).certificate,
    )

    // Then the end date is read back correctly
    expect(new Date(parsed.validTo).getUTCFullYear()).toBe(2055)
  })
})

describe("loadLocalCertificate", () => {
  let directory = ""
  const path = (): string => join(directory, FILE_NAME)

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "goodttv-certificate-"))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(directory, { force: true, recursive: true })
  })

  it("creates it once, owner-only, and keeps it across starts", async () => {
    // Given an installation without a certificate
    const first = await loadLocalCertificate(directory, NOW)

    // When the app starts again
    const second = await loadLocalCertificate(directory, NOW)

    // Then it reuses the saved one
    expect(second).toEqual(first)
    expect((await stat(path())).mode & 0o777).toBe(0o600)
  })

  it.each([
    ["a broken file", "not json"],
    ["missing fields", "{}"],
    ["a broken certificate", JSON.stringify({ certificate: "x", key: "y" })],
  ])("replaces %s", async (_name, content) => {
    // Given a damaged file
    await writeFile(path(), content)

    // When the app starts
    const loaded = await loadLocalCertificate(directory, NOW)

    // Then it creates a new one and saves it
    expect(new X509Certificate(loaded.certificate).subject).toBe("CN=localhost")
    expect(JSON.parse(await readFile(path(), "utf8"))).toEqual(loaded)
  })

  it("replaces a certificate whose key is not its own", async () => {
    // Given a file mixing two certificates
    const { certificate } = createLocalCertificate(NOW)
    const { key } = createLocalCertificate(NOW)
    await writeFile(path(), JSON.stringify({ certificate, key }))

    // When the app starts
    const loaded = await loadLocalCertificate(directory, NOW)

    // Then the mixed pair is not used
    expect(loaded.certificate).not.toBe(certificate)
  })

  it.each([
    ["expired", new Date("2037-01-01T00:00:00Z")],
    ["not yet valid because the clock went back", new Date("2020-01-01T00:00:00Z")],
  ])("replaces a certificate that is %s", async (_name, later) => {
    // Given a certificate saved today
    const saved = await loadLocalCertificate(directory, NOW)

    // When the app starts with a clock outside its dates
    const loaded = await loadLocalCertificate(directory, later)

    // Then it creates one that is valid for that clock
    const parsed = new X509Certificate(loaded.certificate)
    expect(loaded.certificate).not.toBe(saved.certificate)
    expect(new Date(parsed.validFrom).getTime()).toBeLessThan(later.getTime())
    expect(new Date(parsed.validTo).getTime()).toBeGreaterThan(later.getTime())
  })

  it("still returns a certificate when it cannot be saved", async () => {
    // Given a data folder that cannot be written (a file where the folder should be)
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const blocked = join(directory, "blocked")
    await writeFile(blocked, "")

    // When the app starts
    const loaded = await loadLocalCertificate(blocked, NOW)

    // Then it works with an unsaved certificate and says so
    expect(new X509Certificate(loaded.certificate).subject).toBe("CN=localhost")
    expect(warning).toHaveBeenCalledOnce()
  })
})
