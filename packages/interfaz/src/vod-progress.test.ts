import type { VideoDetail } from "@goodttv/contratos"
import { describe, expect, it } from "vitest"
import {
  isSeen,
  RESUME_BACK_S,
  resumeAt,
  saveVodProgress,
  unfinishedVods,
  vodProgress,
} from "./vod-progress"

const memory = (): Storage => {
  const items = new Map<string, string>()
  return {
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: () => null,
    get length() {
      return items.size
    },
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    },
  }
}

const video = (id: string, seconds = 3600): VideoDetail => ({
  category: null,
  createdAt: "2026-10-18T17:34:21Z",
  id,
  kind: "archive",
  owner: { avatar: null, displayName: "Ibai", id: "1", login: "ibai" },
  seconds,
  storyboard: null,
  thumbnail: null,
  title: `Vídeo ${id}`,
  views: 0,
})

describe("por dónde va cada VOD", () => {
  it("reanuda unos segundos antes de donde se dejó", () => {
    const storage = memory()
    saveVodProgress(video("1"), 1234, storage)
    expect(resumeAt(vodProgress("1", storage))).toBe(1234 - RESUME_BACK_S)
  })

  it("desde el principio si no se empezó, si apenas se vio o si ya se terminó", () => {
    const storage = memory()
    expect(resumeAt(vodProgress("1", storage))).toBe(0)
    saveVodProgress(video("2"), 8, storage)
    expect(vodProgress("2", storage)).toBeUndefined()
    saveVodProgress(video("3"), 3590, storage)
    const seen = vodProgress("3", storage)
    expect(seen !== undefined && isSeen(seen)).toBe(true)
    expect(resumeAt(seen)).toBe(0)
  })

  it("los vídeos a medias, del último que se vio al primero, sin los terminados", () => {
    const storage = memory()
    saveVodProgress(video("a"), 600, storage, 1000)
    saveVodProgress(video("b"), 900, storage, 3000)
    saveVodProgress(video("c"), 3599, storage, 2000)
    expect(unfinishedVods(storage).map((entry) => entry.id)).toEqual(["b", "a"])
  })

  it("volver a abrirlo y cerrarlo enseguida no borra por dónde iba", () => {
    const storage = memory()
    saveVodProgress(video("1"), 1800, storage)
    saveVodProgress(video("1"), 1795, storage)
    expect(vodProgress("1", storage)?.at).toBe(1795)
  })
})
