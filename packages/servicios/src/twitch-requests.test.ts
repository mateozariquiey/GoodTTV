import { describe, expect, it } from "vitest"
import {
  createDeviceTokenBody,
  createLiveSearchParams,
  isAllowedActivationUrl,
  isIdentityCacheCurrent,
  shouldRefreshResponse,
} from "./twitch-requests"

describe("Twitch request contracts", () => {
  it("includes scopes in the device token exchange", () => {
    // Given a public client and one-time device code
    const clientId = "abcdefghijklmnopqrstuvwxyz1234"

    // When the token exchange body is created
    const body = createDeviceTokenBody(clientId, "device-code")

    // Then Twitch receives the documented scope set
    expect(body.get("scopes")).toBe("user:read:follows user:read:chat")
  })

  it("maps the language filter to Helix's parameter", () => {
    expect(createLiveSearchParams({ first: 20, language: "es" })).toEqual({
      first: 20,
      language: "es",
    })
  })

  it("keeps unfiltered live parameters unchanged", () => {
    expect(createLiveSearchParams({ first: 20 })).toEqual({ first: 20 })
    expect(createLiveSearchParams({ after: "cursor", first: 20 })).toEqual({
      after: "cursor",
      first: 20,
    })
  })

  it("refreshes only an unauthorized response", () => {
    // Given validation and Helix response status codes
    const statuses = [401, 403, 500]

    // When refresh eligibility is classified
    const decisions = statuses.map(shouldRefreshResponse)

    // Then only 401 can consume a one-time refresh token
    expect(decisions).toEqual([true, false, false])
  })

  it("allows only the official Twitch device activation URL", () => {
    // Given official, custom-protocol, credentialed, and foreign activation URLs
    const urls = [
      "https://www.twitch.tv/activate?public=true&device-code=ABC",
      "steam://open/attacker",
      "https://user:pass@www.twitch.tv/activate",
      "https://www.twitch.tv:444/activate",
      "https://attacker.example/activate",
    ]

    // When external-open eligibility is classified
    const decisions = urls.map(isAllowedActivationUrl)

    // Then only the expected HTTPS Twitch activation path is allowed
    expect(decisions).toEqual([true, false, false, false, false])
  })

  it("expires identity caching before the access token expires", () => {
    // Given a recently validated token that expires in thirty seconds
    const now = Date.parse("2026-09-05T20:00:00.000Z")

    // When cache eligibility accounts for the token expiry margin
    const isCurrent = isIdentityCacheCurrent(now - 1_000, "2026-09-05T20:00:30.000Z", now)

    // Then the near-expiry identity cannot remain cached for an hour
    expect(isCurrent).toBe(false)
  })
})
