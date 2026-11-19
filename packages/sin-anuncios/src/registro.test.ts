import { afterEach, describe, expect, it, vi } from "vitest"
import { safeEmpalmeEvent } from "./registro"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("safeEmpalmeEvent", () => {
  it("deja solo lo que se puede guardar, con los segundos desde que se abrió la página", () => {
    vi.spyOn(performance, "now").mockReturnValue(12_345.6)
    expect(
      safeEmpalmeEvent({
        canal: "ibai",
        celda: 2,
        error: "https://usher.ttvnw.net/…?token=secreto",
        ev: "fallo",
        motivo: "red",
        url: "https://video-weaver/…?sig=firma",
      }),
    ).toEqual({ canal: "ibai", celda: 2, ev: "fallo", motivo: "red", s: 12.3 })
  })
})
