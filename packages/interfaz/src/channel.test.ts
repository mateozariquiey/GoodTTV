import { describe, expect, it } from "vitest"
import { avatarAt } from "./channel"

const PHOTO = "https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png"

describe("avatarAt", () => {
  it("pide la menor foto que cubre lo que ocupa en pantalla", () => {
    expect(avatarAt(PHOTO, 32, 1)).toBe(PHOTO.replace("300x300", "50x50"))
    expect(avatarAt(PHOTO, 32, 1.1)).toBe(PHOTO.replace("300x300", "50x50"))
    expect(avatarAt(PHOTO, 56, 1.1)).toBe(PHOTO.replace("300x300", "70x70"))
    expect(avatarAt(PHOTO, 40, 2.8125)).toBe(PHOTO.replace("300x300", "150x150"))
  })

  it("nunca pide más de 300 px, la mayor que se usa", () => {
    expect(avatarAt(PHOTO, 56, 3)).toBe(PHOTO)
    expect(avatarAt(PHOTO, 200, 3)).toBe(PHOTO)
  })

  it("deja como está una dirección que no es una foto de perfil de Twitch", () => {
    const other = "https://example.com/foto.png"
    expect(avatarAt(other, 32, 1)).toBe(other)
  })

  it("vale también para las fotos que ya vienen a otro tamaño", () => {
    expect(avatarAt(PHOTO.replace("300x300", "70x70"), 32, 1)).toBe(
      PHOTO.replace("300x300", "50x50"),
    )
  })
})
