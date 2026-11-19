import type { EmpalmeEvent } from "./empalme"

// El registro del empalme en el laboratorio, en la extensión (?registro, apps/navegador/src/lab.ts) y en el motor de
// Android (motor.ts): solo los campos que se pueden guardar, porque los errores y las URL pueden llevar el token de
// Twitch. Son los que registra la TV, más los de nueva-numeracion y url-distinta y la celda de la cuadrícula
// (directo-huecos.ts).
export const SAFE_EMPALME_FIELDS: ReadonlySet<string> = new Set([
  "ahora",
  "antes",
  "canal",
  "celda",
  "duracionS",
  "ev",
  "fragmentosVod",
  "index",
  "motivo",
  "ms",
  "otra",
  "publicados",
  "saltoS",
  "segundos",
  "seq",
  "type",
])

export type SafeEmpalmeEvent = Readonly<Record<string, unknown>> & { readonly s: number }

// El evento sin lo que no se puede guardar, con los segundos (con una décima) desde que se abrió la página.
export const safeEmpalmeEvent = (event: EmpalmeEvent): SafeEmpalmeEvent => ({
  s: Math.round(performance.now() / 100) / 10,
  ...Object.fromEntries(Object.entries(event).filter(([name]) => SAFE_EMPALME_FIELDS.has(name))),
})
