import type { Fetch } from "./twitch-source"

// Lo pequeño que repiten los módulos que hablan con Twitch (twitch-source, canales, vods y directo). Es de uso interno:
// index.ts no lo exporta.

// Por defecto, cada petición sale por el fetch global en el momento de pedir (Android lo cambia por su red nativa).
export const globalFetch: Fetch = (input, init) => fetch(input, init)

// Un nombre de usuario de Twitch, en minúsculas, y el id de un usuario o de un vídeo.
export const LOGIN = /^[a-z0-9_]{1,25}$/
export const NUMERIC_ID = /^\d{1,20}$/

// Un texto de la respuesta de Twitch; null si no lo es o está vacío.
export const textOf = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null
