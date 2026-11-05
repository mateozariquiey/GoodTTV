import { describe, expect, it } from "vitest"
import {
  addToGrid,
  assignHuecos,
  gridEnabled,
  gridFrom,
  huecoOf,
  lastActive,
  lastGrid,
  placeInHuecos,
  rememberActive,
  rememberGrid,
  setGridEnabled,
} from "./cuadricula"

describe("gridEnabled", () => {
  const memory = (): Storage => {
    const values = new Map<string, string>()
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    } as unknown as Storage
  }
  it("sin activar, no está", () => {
    expect(gridEnabled(memory())).toBe(false)
  })
  it("se recuerda", () => {
    const storage = memory()
    setGridEnabled(true, storage)
    expect(gridEnabled(storage)).toBe(true)
    setGridEnabled(false, storage)
    expect(gridEnabled(storage)).toBe(false)
  })
})

describe("addToGrid", () => {
  it("añade al final, y uno que ya está no cambia nada", () => {
    expect(addToGrid(["a"], "b", "a")).toEqual(["a", "b"])
    expect(addToGrid(["a", "b"], "a", "a")).toEqual(["a", "b"])
  })
  it("llena, ocupa el sitio del último que no suena", () => {
    expect(addToGrid(["a", "b", "c", "d"], "e", "a")).toEqual(["a", "b", "c", "e"])
    expect(addToGrid(["a", "b", "c", "d"], "e", "d")).toEqual(["a", "b", "e", "d"])
  })
})

describe("assignHuecos", () => {
  it("el primero va al directo principal, y los demás, al primero libre", () => {
    expect([...assignHuecos(["a", "b", "c"], new Map())]).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ])
  })
  it("quien sigue conserva el suyo, y uno nuevo ocupa el que quedó libre", () => {
    const before = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ])
    expect(assignHuecos(["a", "c", "d"], before).get("c")).toBe(2)
    expect(assignHuecos(["a", "c", "d"], before).get("d")).toBe(1)
    expect(assignHuecos(["c", "d"], before).get("d")).toBe(0)
  })
})

describe("lo que se recuerda de la cuadrícula", () => {
  const memory = (): Storage => {
    const values = new Map<string, string>()
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    } as unknown as Storage
  }
  it("sin nada guardado, sin canales", () => {
    expect(lastGrid(memory())).toEqual([])
    expect(lastActive(memory())).toBeUndefined()
  })
  it("los canales y el que suena", () => {
    const storage = memory()
    rememberGrid(["a", "b"], storage)
    rememberActive("b", storage)
    expect(lastGrid(storage)).toEqual(["a", "b"])
    expect(lastActive(storage)).toBe("b")
  })
})

describe("gridFrom", () => {
  it("visto solo uno de la última, se vuelve a ella", () => {
    expect(gridFrom("b", ["a", "b"])).toEqual(["a", "b"])
  })
  it("desde otro canal, empieza con ese", () => {
    expect(gridFrom("c", ["a", "b"])).toEqual(["c"])
  })
  it("desde fuera de un canal, la última", () => {
    expect(gridFrom(undefined, ["a", "b"])).toEqual(["a", "b"])
  })
})

describe("huecoOf", () => {
  it("quien no ha estado en una cuadrícula va al directo principal", () => {
    expect(huecoOf("nunca")).toBe(0)
  })
  it("un canal visto solo sigue en su hueco, y al volver no se lo quita nadie", () => {
    placeInHuecos(["uno", "dos"])
    expect(huecoOf("dos")).toBe(1)
    placeInHuecos(["uno", "dos", "tres"])
    expect(huecoOf("dos")).toBe(1)
    expect(huecoOf("tres")).toBe(2)
    placeInHuecos([])
  })
})
