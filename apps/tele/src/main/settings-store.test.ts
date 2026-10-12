import { PROJECT_CLIENT_ID, resolveClientId } from "@goodttv/servicios"
import { describe, expect, it } from "vitest"
import { SettingsStore } from "./settings-store"

const VALID = "abcdefghijklmnopqrst0123456789"

describe("resolveClientId", () => {
  it("prefers a valid run-time override", () => {
    expect(resolveClientId(VALID, "zzzzzzzzzzzzzzzzzzzzzzzz")).toBe(VALID)
  })

  it("falls back to the compiled value and ignores invalid overrides", () => {
    expect(resolveClientId("not valid!", VALID)).toBe(VALID)
    expect(resolveClientId(undefined, VALID)).toBe(VALID)
  })

  it("falls back to the project's registered public Client ID", async () => {
    expect(resolveClientId(undefined, undefined)).toBe(PROJECT_CLIENT_ID)
    expect(await new SettingsStore(undefined, "").load()).toEqual({ clientId: PROJECT_CLIENT_ID })
  })
})
