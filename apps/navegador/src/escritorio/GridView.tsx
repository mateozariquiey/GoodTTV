import type { Preferences, PreferencesPatch } from "@goodttv/contratos"
import {
  type Channel,
  chooseVolume,
  chosenVolume,
  fromSearch,
  type PlayerPhase,
  prewarmStream,
  TWITCH_VIEWER_LATENCY,
  t,
  toRecent,
  useHlsPlayer,
  useWatchTime,
  type Volume,
} from "@goodttv/interfaz"
import {
  ArrowSquareOutIcon,
  ArrowsInLineHorizontalIcon,
  ArrowsOutLineHorizontalIcon,
  ChatTextIcon,
  CornersInIcon,
  CornersOutIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SpeakerHighIcon,
  SpeakerSimpleXIcon,
  XIcon,
} from "@phosphor-icons/react"
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ChannelChat } from "./ChannelView"
import { huecoOf, MAX_CELLS, placeInHuecos, rememberGrid } from "./cuadricula"
import { useFullscreen } from "./fullscreen"
import { navigate } from "./routes"
import { SKIP_S } from "./SkipButton"
import { contextOf, shortcutFor } from "./shortcuts"
import { SoundElsewhere, useSoleSound, WAITS } from "./sonido"

// Varios canales en una pestaña (EXT-6, D42): uno grande, el que suena y cuyo chat se ve, y los demás debajo. Un clic en
// una celda la hace la grande. Las celdas no se vuelven a crear al cambiar de una a otra: solo cambia dónde las coloca
// el CSS, así que su vídeo sigue sin un corte. Tampoco se corta al entrar o salir (useHlsPlayer).

const WARM_PING_MS = 20_000 // como en el canal: el directo para el empalme a los 30 s sin uso
const RECHECK_OFFLINE_MS = 60_000 // sin directo, se mira cada tanto si ha vuelto: no hay que tocar nada para que siga

// Lo que la vista necesita de cada celda para el chat y el teclado.
type CellHandle = {
  readonly goLive: () => void
  readonly latency: RefObject<number | null>
  readonly phase: PlayerPhase
  readonly play: () => void
  readonly seekBy: (seconds: number, orStart?: boolean) => number | null
  readonly toggle: () => void
}
type CellStatus = { readonly phase: PlayerPhase; readonly playing: boolean }

const failed = (status: CellStatus | undefined): boolean =>
  status?.phase === "offline" || status?.phase === "error" || status?.phase === "stalled"

const Cell = ({
  active,
  bar,
  channel,
  enabled,
  hueco,
  mode,
  onPick,
  onRemove,
  onStatus,
  register,
  soundHere,
  sound,
}: {
  readonly active: boolean
  readonly bar: ReactNode
  readonly channel: Channel
  readonly enabled: boolean
  readonly hueco: number
  readonly mode: Preferences["latencyMode"]
  readonly onPick: () => void
  readonly onRemove: () => void
  readonly onStatus: (login: string, status: CellStatus | null) => void
  readonly register: (login: string, handle: CellHandle | null) => void
  readonly soundHere: boolean // esta pestaña es la que suena (EXT-5)
  readonly sound: Volume
}) => {
  const surface = useRef<HTMLDivElement>(null)
  const { login } = channel
  const player = useHlsPlayer(surface, login, enabled, mode, true, {
    hueco,
    inCell: true,
    silent: !active,
  })
  const { applySound, latency, play, retry, seekBy, state, toggle } = player
  const { blocked, phase, playing } = state
  useEffect(() => {
    applySound(active ? sound : { ...sound, muted: true })
  }, [active, applySound, sound])
  const goLive = useCallback(() => {
    seekBy(Number.POSITIVE_INFINITY)
    play()
  }, [play, seekBy])
  useEffect(() => {
    register(login, { goLive, latency, phase, play, seekBy, toggle })
    return () => register(login, null)
  }, [goLive, latency, login, phase, play, register, seekBy, toggle])
  useEffect(() => {
    onStatus(login, { phase, playing })
    return () => onStatus(login, null)
  }, [login, onStatus, phase, playing])

  // Sin directo no hay nada que quitar de la vista: se sigue mirando sin enseñar el giro de cada comprobación.
  const [rechecking, setRechecking] = useState(false)
  useEffect(() => {
    if (phase === "ready") setRechecking(false)
  }, [phase])
  const shown = rechecking && phase !== "ready" ? "offline" : phase
  useEffect(() => {
    if (shown !== "offline" || !enabled) return undefined
    const timer = setInterval(() => {
      setRechecking(true)
      retry()
    }, RECHECK_OFFLINE_MS)
    return () => clearInterval(timer)
  }, [enabled, retry, shown])

  const name = channel.displayName
  const label = !soundHere
    ? t("Escuchar aquí")
    : active
      ? t("Pausar o seguir")
      : `${t("Escuchar")} ${name}`
  return (
    <div
      className={`grid-cell${active ? " grid-cell--active" : ""}`}
      data-canal={login}
      data-fase={shown}
    >
      <div className="grid-cell__surface" ref={surface} />
      <button
        aria-label={label}
        aria-pressed={active}
        className="grid-cell__pick"
        onClick={(event) => {
          if (soundHere && active) toggle()
          else onPick()
          // Con el ratón, sin que le quede el foco: si no, la siguiente tecla le pinta un borde como el de la grande.
          if (event.detail > 0) event.currentTarget.blur()
        }}
        title={active && soundHere ? undefined : label}
        type="button"
      />
      {shown === "loading" ? (
        <div aria-label={t("Cargando")} className="spinner" role="status" />
      ) : shown === "offline" || shown === "error" || shown === "stalled" ? (
        <div className="grid-cell__notice" role="alert">
          <p>
            {shown === "offline"
              ? `${name} ${t("no está en directo ahora.")}`
              : shown === "error"
                ? t("No se pudo preparar el directo sin anuncios.")
                : t("Twitch no responde.")}
          </p>
          {shown === "offline" ? null : (
            <button className="button" onClick={retry} type="button">
              {t("Reintentar")}
            </button>
          )}
        </div>
      ) : blocked ? (
        <div className="grid-cell__notice" role="alert">
          <p>{t("El navegador no ha dejado empezar la reproducción.")}</p>
          <button className="button button--primary" onClick={play} type="button">
            {t("Reproducir")}
          </button>
        </div>
      ) : null}
      {active && !soundHere ? <SoundElsewhere /> : null}
      <span className="grid-cell__label">
        {active && soundHere && !sound.muted ? <SpeakerHighIcon aria-hidden="true" /> : null}
        {name}
      </span>
      <span className="grid-cell__actions">
        <button
          aria-label={`${t("Ver solo")} ${name}`}
          className="icon-button icon-button--light icon-button--small"
          onClick={() => navigate({ login, view: "channel" })}
          title={`${t("Ver solo")} ${name}`}
          type="button"
        >
          <ArrowSquareOutIcon />
        </button>
        <button
          aria-label={`${t("Quitar")} ${name}`}
          className="icon-button icon-button--light icon-button--small"
          onClick={onRemove}
          title={`${t("Quitar")} ${name}`}
          type="button"
        >
          <XIcon />
        </button>
      </span>
      {active ? (
        <>
          {player.rewound && phase === "ready" ? (
            <button className="grid-cell__live" onClick={goLive} type="button">
              <i aria-hidden="true" /> {t("Ir al directo")}
            </button>
          ) : null}
          {bar}
        </>
      ) : null}
    </div>
  )
}

export const GridView = ({
  active: chosen,
  canChat,
  known,
  logins,
  onActive,
  onAdd,
  onPreferences,
  onTheater,
  preferences,
  preferencesLoaded,
  signedIn,
  theater,
}: {
  readonly active: string | undefined
  readonly canChat: boolean
  readonly known: readonly Channel[] // lo que ya se sabe de los canales de las listas
  readonly logins: readonly string[]
  readonly onActive: (login: string) => void
  readonly onAdd: () => void
  readonly onPreferences: (patch: PreferencesPatch) => void
  readonly onTheater: (on: boolean) => void
  readonly preferences: Preferences
  readonly preferencesLoaded: boolean
  readonly signedIn: boolean
  readonly theater: boolean
}) => {
  const active = chosen !== undefined && logins.includes(chosen) ? chosen : logins[0]

  // Cómo va cada celda. Cambia poco: al empezar, al pausar y al terminar.
  const [statuses, setStatuses] = useState<Readonly<Record<string, CellStatus>>>({})
  const onStatus = useCallback((login: string, status: CellStatus | null) => {
    setStatuses((current) => {
      const { [login]: _, ...rest } = current
      return status === null ? rest : { ...rest, [login]: status }
    })
  }, [])
  const activeStatus = active === undefined ? undefined : statuses[active]

  // Con varias pestañas, suena una sola (sonido.ts). La que espera calla y, oculta un rato, para. Salvo si la persona ha
  // pausado la que suena: al volver no debe arrancar sola. Para useSoleSound la cuadrícula es una sola cosa, sea cual sea la
  // celda grande: si cambia sola porque otra ha terminado, no debe quitarle el sonido a otra ventana. Elegir una lo pide aparte.
  const sole = useSoleSound(
    "cuadricula",
    !(activeStatus?.phase === "ready" && !activeStatus.playing),
  )
  const { claim, standby } = sole
  const enabled = preferencesLoaded && standby !== "parado"
  const soundHere = standby === "no"

  // Oculta un rato, aunque esta pestaña sea la que suena, solo se gasta en lo que se oye: las otras celdas paran, como
  // el segundo escalón de las pestañas.
  const [hiddenLong, setHiddenLong] = useState(false)
  useEffect(() => {
    if (sole.visible) {
      setHiddenLong(false)
      return undefined
    }
    const timer = setTimeout(() => setHiddenLong(true), WAITS.silentMs)
    return () => clearTimeout(timer)
  }, [sole.visible])

  // Parada, los empalmes siguen calientes un rato: volver tarda lo de un canal precalentado (como en el canal).
  const { latencyMode } = preferences
  useEffect(() => {
    if (standby !== "parado" || !sole.warm || !preferencesLoaded) return undefined
    const ping = (): void => {
      for (const login of logins) prewarmStream(login, latencyMode, huecoOf(login))
    }
    ping()
    const timer = setInterval(ping, WARM_PING_MS)
    return () => clearInterval(timer)
  }, [latencyMode, logins, preferencesLoaded, sole.warm, standby])

  // Con todas las celdas a la vez, la pantalla encendida es de la vista: quitar una no debe soltarla.
  useEffect(() => {
    if (!enabled || logins.length === 0) return undefined
    void window.api.player.setWatching(true)
    return () => void window.api.player.setWatching(false)
  }, [enabled, logins.length])

  placeInHuecos(logins)

  // Lo que falta de los canales que no vienen de una lista (su id, para el chat).
  const [cards, setCards] = useState<Readonly<Record<string, Channel>>>({})
  const asked = useRef(new Set<string>())
  const channelOf = useCallback(
    (login: string): Channel =>
      known.find((each) => each.login === login && each.userId !== undefined) ??
      cards[login] ?? { displayName: login, login },
    [cards, known],
  )
  useEffect(() => {
    for (const login of logins) {
      if (channelOf(login).userId !== undefined || asked.current.has(login)) continue
      asked.current.add(login)
      window.api.catalog
        .channel?.(login)
        .then((card) => {
          if (card !== null) setCards((current) => ({ ...current, [login]: fromSearch(card) }))
        })
        .catch(() => undefined)
    }
  }, [channelOf, logins])

  // El que suena cuenta como visto: a recientes con sus datos, y sus minutos para ordenar los seguidos.
  useWatchTime(active, activeStatus?.playing === true && soundHere)
  const activeCard = active === undefined ? undefined : channelOf(active)
  const recentId = activeCard?.userId
  // biome-ignore lint/correctness/useExhaustiveDependencies: se guarda al saber su id, con los datos de ese momento.
  useEffect(() => {
    if (activeCard !== undefined && recentId !== undefined) {
      void window.api.recents.add(toRecent(activeCard))
    }
  }, [active, recentId])

  const [sound, setSound] = useState<Volume>(() => chosenVolume())
  const choose = useCallback(
    (next: Volume) => {
      setSound(next)
      chooseVolume(next)
      claim()
    },
    [claim],
  )
  const toggleMuted = useCallback(() => {
    choose(
      sound.muted && sound.volume === 0
        ? { muted: false, volume: 0.5 }
        : { ...sound, muted: !sound.muted },
    )
  }, [choose, sound])
  // En una pestaña que espera, sin sonido, pero lo elegido sigue ahí para cuando le toque.
  const heard = useMemo(() => (soundHere ? sound : { ...sound, muted: true }), [sound, soundHere])

  const cells = useRef(new Map<string, CellHandle>())
  const register = useCallback((login: string, handle: CellHandle | null) => {
    if (handle === null) cells.current.delete(login)
    else cells.current.set(login, handle)
  }, [])
  const chatDelay = useCallback((): number | null => {
    const cell = active === undefined ? undefined : cells.current.get(active)
    if (cell === undefined) return null
    const seconds = cell.latency.current
    if (seconds !== null) return Math.max(0, seconds - TWITCH_VIEWER_LATENCY)
    return cell.phase === "loading" || cell.phase === "ready" ? null : 0
  }, [active])

  // Si termina o falla el que suena, pasa a ser grande (y a sonar, con su chat) uno que siga: la grande no debe quedarse en
  // un aviso con otros en marcha. Una vez por fallo, y no si es la persona quien lo elige así: puede querer su chat.
  const staysFailed = useRef<string | null>(null)
  useEffect(() => {
    if (active === undefined) return
    // Solo al volver de verdad: mirar si ha vuelto pasa por «cargando», y una elegida a mano se queda mientras tanto.
    if (activeStatus?.phase === "ready" && staysFailed.current === active) {
      staysFailed.current = null
    }
    if (!failed(activeStatus) || staysFailed.current === active) return
    const next = logins.find((login) => statuses[login]?.phase === "ready")
    if (next !== undefined) onActive(next)
  }, [active, activeStatus, logins, onActive, statuses])

  const pick = useCallback(
    (login: string) => {
      staysFailed.current = failed(statuses[login]) ? login : null
      // Elegir una pausada es querer oírla (una miniatura no enseña que lo está), y un clic deja empezar a una bloqueada.
      const cell = cells.current.get(login)
      if (cell?.phase === "ready") cell.play()
      onActive(login)
      claim()
    },
    [claim, onActive, statuses],
  )
  const remove = useCallback(
    (login: string) => {
      const rest = logins.filter((each) => each !== login)
      rememberGrid(rest)
      navigate(rest.length === 0 ? { view: "home" } : { logins: rest, view: "grid" })
    },
    [logins],
  )

  const view = useRef<HTMLDivElement>(null)
  const onWindowChat = useCallback(
    (on: boolean) => onPreferences({ chatVisible: on }),
    [onPreferences],
  )
  const { chatShown, fullscreen, toggleChat, toggleFullscreen } = useFullscreen(
    view,
    preferences.chatVisible,
    onWindowChat,
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const context = contextOf(event.target)
      // 1-4: esa celda.
      const number = Number(event.key)
      if (
        !context.typing &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        number >= 1 &&
        number <= MAX_CELLS
      ) {
        const login = logins[number - 1]
        if (login !== undefined) pick(login)
        event.preventDefault()
        return
      }
      const shortcut = shortcutFor(event, context)
      const cell = active === undefined ? undefined : cells.current.get(active)
      if (shortcut === "play-pause") {
        if (soundHere) cell?.toggle()
        else claim()
      } else if (shortcut === "mute") toggleMuted()
      else if (shortcut === "fullscreen") toggleFullscreen()
      else if (shortcut === "theater" && !fullscreen) onTheater(!theater)
      else if (shortcut === "chat") toggleChat()
      else if (shortcut === "rewind") cell?.seekBy(-SKIP_S, true)
      else if (shortcut === "forward") cell?.seekBy(SKIP_S)
      else if (shortcut === "live") cell?.goLive()
      else return
      event.preventDefault()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [
    active,
    claim,
    fullscreen,
    logins,
    onTheater,
    pick,
    soundHere,
    theater,
    toggleChat,
    toggleFullscreen,
    toggleMuted,
  ])

  const hasRoom = logins.length < MAX_CELLS
  const muted = sound.muted || sound.volume === 0
  const pausedNow = activeStatus?.phase === "ready" && !activeStatus.playing
  const bar = (
    <div className="grid-bar">
      <button
        aria-label={pausedNow ? t("Reproducir") : t("Pausa")}
        className="icon-button icon-button--light"
        onClick={() => {
          if (active !== undefined) cells.current.get(active)?.toggle()
        }}
        title={pausedNow ? t("Reproducir (Espacio)") : t("Pausa (Espacio)")}
        type="button"
      >
        {pausedNow ? <PlayIcon /> : <PauseIcon />}
      </button>
      <button
        aria-label={muted ? t("Quitar el silencio") : t("Silenciar")}
        className="icon-button icon-button--light"
        onClick={toggleMuted}
        title={muted ? t("Quitar el silencio (M)") : t("Silenciar (M)")}
        type="button"
      >
        {muted ? <SpeakerSimpleXIcon /> : <SpeakerHighIcon />}
      </button>
      <input
        aria-label={t("Volumen")}
        className="volume"
        max={1}
        min={0}
        onChange={(event) => {
          const volume = Number(event.currentTarget.value)
          choose({ muted: volume === 0, volume })
        }}
        step={0.01}
        style={{ "--level": `${(muted ? 0 : sound.volume) * 100}%` } as CSSProperties}
        type="range"
        value={muted ? 0 : sound.volume}
      />
      <span className="grid-bar__end">
        <button
          aria-label={chatShown ? t("Ocultar el chat") : t("Mostrar el chat")}
          aria-pressed={chatShown}
          className="icon-button icon-button--light"
          onClick={toggleChat}
          title={chatShown ? t("Ocultar el chat (C)") : t("Mostrar el chat (C)")}
          type="button"
        >
          <ChatTextIcon />
        </button>
        {fullscreen ? null : (
          <button
            aria-label={t("Modo teatro")}
            aria-pressed={theater}
            className="icon-button icon-button--light icon-button--toggle"
            onClick={() => onTheater(!theater)}
            title={t("Modo teatro (T): el vídeo y el chat ocupan la ventana")}
            type="button"
          >
            {theater ? <ArrowsInLineHorizontalIcon /> : <ArrowsOutLineHorizontalIcon />}
          </button>
        )}
        <button
          aria-label={fullscreen ? t("Salir de la pantalla completa") : t("Pantalla completa")}
          className="icon-button icon-button--light"
          onClick={toggleFullscreen}
          title={fullscreen ? t("Salir de la pantalla completa (F)") : t("Pantalla completa (F)")}
          type="button"
        >
          {fullscreen ? <CornersInIcon /> : <CornersOutIcon />}
        </button>
      </span>
    </div>
  )

  return (
    <div className={`watch grid-view${chatShown ? " watch--chat" : ""}`} ref={view}>
      <div className="grid-view__area">
        <div className="grid-cells">
          {logins.map((login) => (
            <Cell
              active={login === active}
              bar={login === active ? bar : null}
              channel={channelOf(login)}
              enabled={enabled && (login === active || !hiddenLong)}
              hueco={huecoOf(login)}
              key={login}
              mode={preferences.latencyMode}
              onPick={() => pick(login)}
              onRemove={() => remove(login)}
              onStatus={onStatus}
              register={register}
              sound={heard}
              soundHere={soundHere}
            />
          ))}
          {hasRoom ? (
            <button className="grid-cell grid-cell--add" onClick={onAdd} type="button">
              <PlusIcon />
              {t("Añadir canal")}
              <small>{t("Búscalo arriba (/) o elígelo en la columna")}</small>
            </button>
          ) : null}
        </div>
      </div>
      <ChannelChat
        broadcasterId={signedIn && active !== undefined ? channelOf(active).userId : undefined}
        canChat={canChat}
        connected={sole.visible}
        delay={chatDelay}
        scale={preferences.chatScale}
        signedIn={signedIn}
        visible={chatShown}
      />
    </div>
  )
}
