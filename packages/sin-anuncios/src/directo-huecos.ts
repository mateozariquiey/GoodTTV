import { createDirecto, type Directo, type DirectoOptions } from "./directo"

// Varios canales a la vez, para la cuadrícula de la extensión (EXT-6). Cada directo sigue atendiendo un canal más uno
// precalentado, sin saber nada de esto: hay uno por celda. Una petición sin ?hueco= va al principal, así que quien no
// usa la cuadrícula no nota nada y una celda sin hueco sigue con el empalme del canal que ya sonaba.
const HUECO = /^[1-3]$/ // la cuadrícula tiene 4 celdas: el principal y estos tres

export const createDirectoHuecos = (options: DirectoOptions = {}): Directo => {
  const principal = createDirecto(options)
  const huecos = new Map<string, Directo>() // se crean la primera vez que se piden

  const handle: Directo["handle"] = async (url, request) => {
    // Los trozos del VOD no dicen de qué canal son: los atiende quien los haya publicado, y los demás dan 403 sin pedir
    // nada a Twitch (serveVod).
    if (url.pathname === "/stream/vod") {
      const first = await principal.handle(url, request)
      if (first.status !== 403) return first
      for (const directo of huecos.values()) {
        const answer = await directo.handle(url, request)
        if (answer.status !== 403) return answer
      }
      return first
    }
    const hueco = url.searchParams.get("hueco")
    if (hueco === null || !HUECO.test(hueco)) return principal.handle(url, request)
    let directo = huecos.get(hueco)
    if (directo === undefined) {
      // En el registro, de qué celda es cada evento (la del principal va sin decirlo).
      const { log } = options
      directo = createDirecto(
        log === undefined
          ? options
          : { ...options, log: (event) => log({ ...event, celda: Number(hueco) }) },
      )
      huecos.set(hueco, directo)
    }
    return directo.handle(url, request)
  }

  return {
    // Solo el principal: abre las conexiones, que son de la página y no de cada directo.
    abrirConexiones: principal.abrirConexiones,
    handle,
    stop: () => {
      principal.stop()
      for (const directo of huecos.values()) directo.stop()
      huecos.clear()
    },
  }
}
