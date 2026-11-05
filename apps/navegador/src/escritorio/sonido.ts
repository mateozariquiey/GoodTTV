import { t } from "@goodttv/interfaz"
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

// Varias pestañas de GoodTTV, cada una con su canal: suena una sola (EXT-5). Suena la última que se ha mirado con un
// canal abierto; las demás pasan a esperar, por escalones, para que volver a ellas sea rápido sin gastar de más:
//   - «silencio»: siguen cargando sin sonido. Volver es inmediato.
//   - «parado», pasado WAITS.silentMs con la pestaña oculta: sin vídeo ni red, salvo el empalme, que se mantiene
//     caliente WAITS.warmMs (volver tarda lo de un canal precalentado). Después, ni eso: volver es abrir el canal.
// Una pestaña a la vista no pasa de «silencio» (dos ventanas a la vez: la otra sigue moviéndose, sin sonido), ni una que
// la persona ha pausado: no hay nada que ahorrar, y al volver no debe arrancar sola.
// Las pestañas se avisan por un BroadcastChannel; pasar a una que no es de GoodTTV no cambia nada (sigue sonando).
// Si la que suena se cierra o deja el canal, pasa a sonar otra que esté a la vista en silencio (dos ventanas), para que
// no se quede muda sin que nadie suene.

export type Standby = "no" | "silencio" | "parado"

// El laboratorio las acorta (?esperas=, lab.ts) para medir cuánto se tarda en volver desde cada escalón.
export const WAITS = { silentMs: 60_000, warmMs: 5 * 60_000 }
const CHANNEL = "goodttv-sonido"
// Lo que espera una pestaña en silencio antes de coger el sonido libre: al pasar del canal a un VOD, la misma pestaña lo
// reclama enseguida, y no debe quitárselo otra.
export const RELEASE_GRACE_MS = 300

// Quién suena y desde cuándo: si dos pestañas reclaman casi a la vez, gana la más reciente (y, a la misma hora, la de
// id mayor), y la otra se calla. Sin ese orden, cada una callaría al recibir la de la otra y no sonaría ninguna.
type Message = { readonly suena: string; readonly at: number }
const isMessage = (data: unknown): data is Message =>
  typeof data === "object" &&
  data !== null &&
  typeof (data as Message).suena === "string" &&
  typeof (data as Message).at === "number"

// La que sonaba lo deja libre: se ha cerrado o ha dejado el canal.
type Release = { readonly libre: string }
const isRelease = (data: unknown): data is Release =>
  typeof data === "object" && data !== null && typeof (data as Release).libre === "string"

const subscribeVisibility = (onChange: () => void): (() => void) => {
  document.addEventListener("visibilitychange", onChange)
  return () => document.removeEventListener("visibilitychange", onChange)
}
const isVisible = (): boolean => document.visibilityState === "visible"

// watching: el canal abierto en esta pestaña (undefined en Inicio o Ajustes, donde nunca se espera).
// stoppable: false si la persona lo ha pausado.
export const useSoleSound = (watching: string | undefined, stoppable: boolean) => {
  const visible = useSyncExternalStore(subscribeVisibility, isVisible)
  // Un canal que se abre en una pestaña oculta (en segundo plano) espera a que se mire, con el empalme caliente.
  const [standby, setStandby] = useState<Standby>(() => (isVisible() ? "no" : "parado"))
  const [warm, setWarm] = useState(true)
  const tab = useMemo(() => crypto.randomUUID(), []) // una pestaña tiene un canal abierto a la vez
  const broadcast = useRef<BroadcastChannel | null>(null)
  const standbyNow = useRef(standby)
  standbyNow.current = standby

  // Declarado antes que el canal, para avisar al desmontar antes de que se cierre.
  useEffect(() => {
    if (watching === undefined) return undefined
    const release = (): void => {
      if (standbyNow.current === "no") {
        broadcast.current?.postMessage({ libre: tab } satisfies Release)
      }
    }
    addEventListener("pagehide", release)
    return () => {
      removeEventListener("pagehide", release)
      release()
    }
  }, [tab, watching])

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL)
    broadcast.current = channel
    return () => {
      channel.close()
      broadcast.current = null
    }
  }, [])

  // Esta pestaña pasa a sonar y las demás, a esperar.
  const claimedAt = useRef(0)
  const claim = useCallback(() => {
    const at = Date.now()
    claimedAt.current = at
    setStandby("no")
    setWarm(true)
    broadcast.current?.postMessage({ at, suena: tab } satisfies Message)
  }, [tab])

  useEffect(() => {
    if (watching === undefined) {
      setStandby("no")
      return undefined
    }
    let takeOver: ReturnType<typeof setTimeout> | undefined
    const onMessage = (event: MessageEvent): void => {
      if (isRelease(event.data)) {
        if (standbyNow.current === "silencio" && isVisible() && takeOver === undefined) {
          takeOver = setTimeout(() => {
            takeOver = undefined
            if (standbyNow.current === "silencio" && isVisible()) claim()
          }, RELEASE_GRACE_MS)
        }
        return
      }
      if (!isMessage(event.data) || event.data.suena === tab) return
      clearTimeout(takeOver) // alguien ha cogido el sonido
      takeOver = undefined
      const { at, suena } = event.data
      if (at > claimedAt.current || (at === claimedAt.current && suena > tab)) {
        setStandby((current) => (current === "no" ? "silencio" : current))
      }
    }
    const channel = broadcast.current
    channel?.addEventListener("message", onMessage)
    return () => {
      clearTimeout(takeOver)
      channel?.removeEventListener("message", onMessage)
    }
  }, [claim, tab, watching])

  // Al mirarla con un canal (o al abrir uno a la vista), suena esta.
  useEffect(() => {
    if (visible && watching !== undefined) claim()
  }, [claim, visible, watching])

  useEffect(() => {
    if (standby === "silencio" && !visible && stoppable) {
      const timer = setTimeout(() => setStandby("parado"), WAITS.silentMs)
      return () => clearTimeout(timer)
    }
    if (standby === "parado") {
      const timer = setTimeout(() => setWarm(false), WAITS.warmMs)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [standby, stoppable, visible])

  return { claim, standby, visible, warm }
}

// En la ventana muda, para que se entienda por qué calla: un clic en el vídeo le da el sonido (ChannelView, VodView). No
// recoge clics, así que ese clic llega al vídeo.
export const SoundElsewhere = () =>
  createElement(
    "div",
    { className: "sound-elsewhere", role: "status" },
    t("Suena en otra ventana · clic para oír esta"),
  )
