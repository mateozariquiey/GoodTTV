// B, solo para medir (la app usa A, Media3: D21): hls.js en la propia página, con el reproductor de @goodttv/interfaz
// (useHlsPlayer) y el directo sin anuncios de @goodttv/sin-anuncios, igual que en la extensión
// (apps/navegador/src/goodttv.tsx). La abre medir/webview.mjs:
//   index.html?reproductor=b[&registro][&modo=…][&pausa=cada,duración[,arranque]][&calidad=1280x720@60]#/canal/<login>
// Con ?registro expone lo mismo que la extensión para medir (window.hlsPrueba, marcasPrueba, registroEmpalme, de
// apps/navegador/src/lab.ts) y, además, las peticiones hechas en nativo (window.redNativaPrueba).
import type { LatencyMode } from "@goodttv/contratos"
import { useHlsPlayer } from "@goodttv/interfaz"
import { createDirecto, createDirectoFetch } from "@goodttv/sin-anuncios"
import { useEffect, useRef, useState } from "react"
// La instrumentación para medir de la extensión (?registro, ?pausa): la misma en las dos.
import { labOptions } from "../../navegador/src/lab"
import { createRedNativa } from "./red-nativa"

const MODES: readonly LatencyMode[] = ["adaptativo", "sin-paradas", "directo"]
const params = new URLSearchParams(location.search)
const MODE = MODES.find((mode) => mode === params.get("modo")) ?? "adaptativo"

type NativeStat = { host: string; status: number; ms: number }

// El fetch de la página con B: el directo pide a Twitch por la red nativa; la página (hls.js), al directo por /stream/ y
// lo demás por la red nativa. Con ?calidad=WxH@fps, todas las peticiones al directo la piden, como si se eligiera en el
// reproductor.
export const fetchDeB = (nativeFetch: typeof fetch): typeof fetch => {
  const nativeStats: NativeStat[] = []
  if (params.has("registro")) Object.assign(globalThis, { redNativaPrueba: nativeStats })
  const red = createRedNativa(nativeFetch, location.origin, false, (host, status, ms) => {
    nativeStats.push({ host, ms: Math.round(ms), status })
    if (nativeStats.length > 2000) nativeStats.shift()
  })
  const directoFetch = createDirectoFetch(
    createDirecto({ ...labOptions(location.search), fetch: red }),
    location.origin,
    red,
  )
  const quality = params.get("calidad")
  if (quality === null) return directoFetch
  return (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (
      url.origin !== location.origin ||
      !url.pathname.startsWith("/stream/") ||
      url.searchParams.has("q")
    ) {
      return directoFetch(request)
    }
    url.searchParams.set("q", quality)
    return directoFetch(new Request(url, request))
  }
}

const loginOf = (hash: string): string | null =>
  /^#\/canal\/([a-z0-9_]{1,25})$/.exec(hash)?.[1] ?? null

const Player = ({ login }: { readonly login: string }) => {
  const surface = useRef<HTMLDivElement>(null)
  const { state } = useHlsPlayer(surface, login, true, MODE)
  useEffect(() => {
    Object.assign(globalThis, { estadoPrueba: state })
  }, [state])
  return (
    <main className="medir-b">
      <div className="stage__surface" ref={surface} />
      <p>
        {login} · {state.phase} · {state.quality} · {MODE}
      </p>
    </main>
  )
}

// Sin canal en la dirección, espera a que la medida lo ponga (location.hash = "#/canal/<login>").
export const MedirB = () => {
  const [login, setLogin] = useState(() => loginOf(location.hash))
  useEffect(() => {
    const onHash = (): void => setLogin(loginOf(location.hash))
    addEventListener("hashchange", onHash)
    return () => removeEventListener("hashchange", onHash)
  }, [])
  return login === null ? (
    <main className="medir-b">
      <p>B, para medir: abre #/canal/&lt;canal&gt;.</p>
    </main>
  ) : (
    <Player key={login} login={login} />
  )
}
