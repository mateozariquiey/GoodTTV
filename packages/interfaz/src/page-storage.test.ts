// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { pageStorage, readStored, removeStored, writeStored } from "./page-storage"

// Un almacenamiento que lanza en todo, como uno bloqueado o lleno.
const broken = (): Storage => {
  const fail = (): never => {
    throw new DOMException("bloqueado", "SecurityError")
  }
  return {
    clear: fail,
    getItem: fail,
    key: fail,
    get length() {
      return 0
    },
    removeItem: fail,
    setItem: fail,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe("el almacenamiento de la página", () => {
  it("guarda, lee y borra en el localStorage, o en el sessionStorage si se pide", () => {
    writeStored("clave", "uno", pageStorage())
    writeStored("clave", "dos", pageStorage(true))
    expect(localStorage.getItem("clave")).toBe("uno")
    expect(readStored("clave", pageStorage())).toBe("uno")
    expect(readStored("clave", pageStorage(true))).toBe("dos")
    removeStored("clave", pageStorage())
    expect(readStored("clave", pageStorage())).toBeNull()
  })

  it("si el navegador no deja usarlo, no hay almacenamiento", () => {
    vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError")
    })
    expect(pageStorage()).toBeUndefined()
    expect(readStored("clave", pageStorage())).toBeNull()
    expect(() => writeStored("clave", "uno", pageStorage())).not.toThrow()
  })

  it("leer, guardar o borrar donde falla no lanza: es como si no hubiera nada", () => {
    const storage = broken()
    expect(readStored("clave", storage)).toBeNull()
    expect(() => writeStored("clave", "uno", storage)).not.toThrow()
    expect(() => removeStored("clave", storage)).not.toThrow()
  })

  it("sin almacenamiento no se busca el de la página", () => {
    localStorage.setItem("clave", "uno")
    expect(readStored("clave", undefined)).toBeNull()
    writeStored("otra", "dos", undefined)
    expect(localStorage.getItem("otra")).toBeNull()
  })
})
