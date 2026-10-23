import { describe, expect, it } from "vitest"
import { formatAgo, formatClock } from "./vod-format"

describe("tiempos de los VOD", () => {
  it("la posición y la duración como un reloj", () => {
    expect(formatClock(0)).toBe("0:00")
    expect(formatClock(62)).toBe("1:02")
    expect(formatClock(3723.9)).toBe("1:02:03")
    expect(formatClock(Number.NaN)).toBe("0:00")
  })

  it("la fecha, como hace cuánto", () => {
    const now = Date.parse("2026-10-21T20:00:00Z")
    expect(formatAgo("2026-10-21T19:30:00Z", now)).toBe("hace menos de una hora")
    expect(formatAgo("2026-10-21T17:00:00Z", now)).toBe("hace 3 horas")
    expect(formatAgo("2026-10-20T19:00:00Z", now)).toBe("ayer")
    expect(formatAgo("2026-10-11T19:00:00Z", now)).toBe("hace 10 días")
    expect(formatAgo("2026-08-01T19:00:00Z", now)).toBe("hace 2 meses")
  })
})
