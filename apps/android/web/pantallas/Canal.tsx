import type { LiveArchive, Preferences } from "@goodttv/contratos"
import {
  type Channel,
  formatClock,
  formatUptime,
  formatViewers,
  fromSearch,
  fromStream,
  prefetchVod,
  renewVod,
  TWITCH_VIEWER_LATENCY,
  toRecent,
  useBehind,
  useChat,
  VOD_WARM_MS,
} from "@goodttv/interfaz"
import {
  ArrowLeftIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChatTextIcon,
  CornersInIcon,
  CornersOutIcon,
  HeartIcon,
  UserIcon,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { android } from "../api"
import { BarraTiempo } from "./BarraTiempo"
import { Chat, type Escritura } from "./Chat"
import { Avatar } from "./comun"
import { Centro, type Pestana, Pestanas, useDespierto, useHorizontal } from "./controles"
import { type EstadoMedia3, useDeslizarParaVolver, useMandos, useMedia3 } from "./media3"
import { atras, navigate } from "./rutas"
import { ChannelVideos } from "./Videos"

// Un canal. En vertical, el vídeo arriba y debajo la ficha y, en pestañas, el chat y sus vídeos (COL-2); en horizontal,
// el vídeo a pantalla completa y, si se pide, el chat al lado (estilos.css). Sin directo, el vídeo deja sitio a una
// franja con el aviso, y salen los vídeos. El vídeo es Media3, debajo de la página (media3.ts): aquí solo se le reserva
// el sitio, transparente, y se pintan encima los controles. Girar el teléfono solo recoloca: nada se vuelve a montar.
// Como en la app de Twitch, el botón de pantalla completa gira a horizontal (la app lo hace aunque el giro automático
// esté bloqueado) y, en horizontal, el chat empieza oculto; la flecha y Atrás vuelven a vertical.
// Retroceder el directo (DVR-1), como en la extensión: con el VOD que graba la emisión, la barra va desde que empezó.
// Lo que cabe en la lista del empalme (~100 s), los 10 s y la barra lo recorren en el mismo reproductor (la app no
// acelera ni vuelve sola al directo); más atrás, o al reanudar tras más de un minuto en pausa, se abre ese VOD en ese
// momento, con «Ir al directo» para volver.

// Retroceder menos que esto no lleva al VOD (que va unos segundos por detrás del directo); reanudar tras una pausa más
// larga sigue donde se pausó, en el VOD, en vez de seguir en el directo cada vez más atrás.
const DVR_MIN_BACK_S = 15
const DVR_PAUSE_MS = 60_000

type Props = {
  readonly canChat: boolean // la cuenta tiene permiso para escribir en el chat
  readonly channel: Channel
  readonly lineup: readonly Channel[] // la lista de la que salió: las flechas la recorren
  readonly onStep: (channel: Channel) => void
  readonly preferences: Preferences
  readonly preferencesLoaded: boolean // hasta leer el modo guardado, no se abre el canal
  readonly signedIn: boolean
}

export const Canal = ({
  canChat,
  channel,
  lineup,
  onStep,
  preferences,
  preferencesLoaded,
  signedIn,
}: Props) => {
  const stage = useRef<HTMLDivElement>(null)
  const pantalla = useRef<HTMLDivElement>(null)
  const player = useMedia3(channel.login, preferences.latencyMode, stage, preferencesLoaded)
  const { estado, latency } = player

  // Abierto por su nombre (la dirección, o «Abrir el canal» de la búsqueda): se completan su nombre, su foto y su id (que
  // el chat necesita también sin directo) sin cuenta, y con cuenta, los datos del directo (cuánto lleva), como en la
  // extensión.
  const [details, setDetails] = useState(channel)
  useEffect(() => {
    setDetails(channel)
    if (channel.userId !== undefined) return undefined
    let active = true
    window.api.catalog
      .channel?.(channel.login)
      .then((card) => {
        // Lo del directo, si ha llegado antes, se queda.
        if (active && card !== null)
          setDetails((current) =>
            current.userId === undefined
              ? fromSearch(card)
              : { ...current, profileImageUrl: current.profileImageUrl ?? card.thumbnailUrl },
          )
      })
      .catch(() => undefined)
    if (signedIn)
      window.api.catalog
        .streamsByLogin([channel.login])
        .then(([stream]) => {
          if (active && stream !== undefined)
            setDetails((current) => {
              const live = fromStream(stream)
              const picture = live.profileImageUrl ?? current.profileImageUrl
              return picture === undefined ? live : { ...live, profileImageUrl: picture }
            })
        })
        .catch(() => undefined)
    return () => {
      active = false
    }
  }, [channel, signedIn])
  // En los mandos del sistema, el canal con su foto y el título del directo.
  useMandos(
    `canal/${details.login}`,
    details.displayName,
    details.title ?? "En directo",
    details.profileImageUrl,
  )
  const latest = useRef(details)
  latest.current = details
  // A recientes al abrirlo, y otra vez cuando se completan sus datos (con su foto e id).
  const recentKey = `${details.login}|${details.userId ?? ""}`
  useEffect(() => {
    void window.api.recents.add(toRecent(latest.current))
  }, [recentKey])

  // SEG-1: si sigues el canal. Al volver a la app (tras seguirlo en twitch.tv), se mira otra vez.
  const [following, setFollowing] = useState<boolean | null>(null)
  const broadcasterId = details.userId
  useEffect(() => {
    setFollowing(null)
    const follows = window.api.catalog.follows
    if (!signedIn || broadcasterId === undefined || follows === undefined) return undefined
    let active = true
    const check = (): void => {
      follows(broadcasterId)
        .then((value) => {
          if (active) setFollowing(value)
        })
        .catch(() => undefined)
    }
    check()
    const onVisible = (): void => {
      if (document.visibilityState === "visible") check()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      active = false
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [broadcasterId, signedIn])

  // Cuánto va por detrás de un espectador normal de Twitch; el chat se retrasa lo mismo, para ir a la par de la imagen
  // (como en la extensión; comprobarlo es AND-4). Mientras no se sabe, el chat espera.
  const behind = useBehind(latency)
  const { fase } = estado
  const enDirecto = fase === "reproduciendo"
  const chatDelay = useCallback((): number | null => {
    const seconds = latency.current
    if (seconds !== null) return Math.max(0, seconds - TWITCH_VIEWER_LATENCY)
    return fase === "cargando" || fase === "reproduciendo" ? null : 0
  }, [latency, fase])

  // DVR-1: la emisión en curso y el VOD que la graba. Sin VOD público, solo se retrocede lo que cabe en la lista.
  const [archive, setArchive] = useState<LiveArchive | null>(null)
  useEffect(() => {
    setArchive(null)
    const vods = window.api.vods
    if (!enDirecto || vods === undefined) return undefined
    let active = true
    vods
      .archive(channel.login)
      .then((value) => {
        if (active) setArchive(value)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [channel.login, enDirecto])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = archive?.archiveId
    if (id == null) return undefined
    // Retroceder no espera a pedir su lista ni sus datos. Valen 5 min (vod-cache.ts): mientras se ve, se renuevan.
    prefetchVod(id)
    const warm = setInterval(() => renewVod(id), VOD_WARM_MS)
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(warm)
      clearInterval(timer)
    }
  }, [archive])
  // Un momento de la emisión (ms, en hora real) en el VOD: su segundo, contando desde que empezó a grabarse. Sin dejar el
  // canal en el historial: retroceder es seguir viendo lo mismo, y Atrás vuelve a donde se estaba antes.
  const openRewind = useCallback(
    (wallMs: number) => {
      const archiveId = archive?.archiveId
      if (archiveId == null) return
      const origin = Date.parse(archive?.recordedAt ?? archive?.startedAt ?? "")
      if (!Number.isFinite(origin)) return
      navigate(
        {
          at: Math.max(0, (wallMs - origin) / 1000),
          id: archiveId,
          live: channel.login,
          view: "vod",
        },
        true,
      )
    },
    [archive, channel.login],
  )
  // Lo que se ve, en hora real (ms): ahora, menos la latencia. En pausa, la latencia crece a la par: no cambia.
  const shownAt = useCallback((): number => Date.now() - (latency.current ?? 0) * 1000, [latency])
  const canRewind = archive?.archiveId != null
  const { alDirecto, pausar, saltar } = player
  // Los 10 s: dentro de la lista, al momento; más atrás, en el VOD de la emisión (sin él, hasta el principio de la
  // lista). Hacia delante, solo tras retroceder, y como mucho hasta donde se iba.
  const skip = (seconds: number): void => {
    if (seconds > 0) {
      if (estado.retrocedido) saltar(seconds)
    } else if (-seconds <= player.atras.current || !canRewind) saltar(seconds)
    else openRewind(shownAt() + seconds * 1000)
  }
  // Pausar es retroceder: al reanudar tras más de un minuto, sigue donde se pausó, en el VOD. La pausa la lleva la app
  // (estado.pausa): vale también si se pausó en la esquina o en el PiP. Reanudar desde ellas sigue en el directo, donde
  // quepa.
  const togglePausa = (): void => {
    const pausada = estado.pausa
    if (
      estado.pausado &&
      pausada !== null &&
      Date.now() - pausada.desde > DVR_PAUSE_MS &&
      canRewind
    )
      openRewind(pausada.imagen)
    else pausar(!estado.pausado)
  }
  // La barra del directo: desde que empezó la emisión hasta ahora; lo que se ve, la latencia antes de ahora.
  const startedAtMs = Date.parse(archive?.startedAt ?? "")
  const dvr =
    !canRewind || !Number.isFinite(startedAtMs) || !enDirecto
      ? null
      : {
          duration: Math.max(0, (now - startedAtMs) / 1000),
          position: Math.max(0, (now - startedAtMs) / 1000 - (latency.current ?? 0)),
          start: startedAtMs,
        }

  // En vertical, el chat o los vídeos, en pestañas: se empieza en el chat salvo que la preferencia lo oculte (Cuenta) o el
  // canal no esté en directo, y elegir la otra no cambia la preferencia (es mirar sus vídeos, no ocultar el chat). En
  // horizontal, el chat empieza oculto y se muestra con su botón (lo elegido vale mientras se esté en el canal). Mientras
  // se vea en uno de los dos, se sigue leyendo, también al girar.
  const horizontal = useHorizontal()
  const [chatHorizontal, setChatHorizontal] = useState(false)
  const [pestana, setPestana] = useState<Pestana>(preferences.chatVisible ? "chat" : "videos")
  const chatPreferido = useRef(preferences.chatVisible)
  chatPreferido.current = preferences.chatVisible
  // Otro canal (las flechas), como lo prefiere la persona.
  useEffect(() => setPestana(chatPreferido.current ? "chat" : "videos"), [channel.login])
  const sinDirecto = fase === "sin-directo"
  useEffect(() => {
    if (sinDirecto) setPestana("videos")
  }, [sinDirecto])
  const chatVisible = horizontal ? chatHorizontal : pestana === "chat"
  const chat = useChat(
    signedIn ? details.userId : undefined,
    pestana === "chat" || chatHorizontal,
    chatDelay,
  )

  // Los controles: al tocar el vídeo salen y se ocultan solos; siempre a la vista si no está reproduciendo.
  const { despertar, despierto, dormir } = useDespierto()
  const [arrastrando, setArrastrando] = useState(false)
  const playing = enDirecto && !estado.pausado
  const showControls = despierto || !playing || arrastrando
  const writing: Escritura =
    !signedIn || chat.send === undefined ? "no" : canChat ? "si" : "vincular"
  const toggleChat = (): void => {
    if (horizontal) setChatHorizontal(!chatHorizontal)
    else setPestana(chatVisible ? "videos" : "chat")
    despertar()
  }
  // Las flechas de los lados: el canal anterior y el siguiente de la lista, dando la vuelta al llegar al final.
  const position = lineup.findIndex((each) => each.login === channel.login)
  const vecino = (delta: number): Channel | undefined =>
    position < 0 || lineup.length < 2
      ? undefined
      : lineup[(position + delta + lineup.length) % lineup.length]
  const anterior = vecino(-1)
  const siguiente = vecino(1)

  // La flecha: en horizontal, a vertical (como Atrás, MainActivity); en vertical, fuera del canal (sigue en la esquina).
  const back = (): void => {
    if (horizontal) android.canalPantallaCompleta(false)
    else atras()
  }
  const franja = sinDirecto && !horizontal
  useDeslizarParaVolver(stage, pantalla, back, !sinDirecto)

  return (
    <div className={`pantalla canal${chatVisible ? "" : " canal--sin-chat"}`} ref={pantalla}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: tocar el vídeo muestra u oculta los controles, que son botones. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: ídem; sin teclado en el teléfono. */}
      <div
        className={`escenario${franja ? " escenario--franja" : ""}`}
        onClick={() => {
          if (showControls && playing) dormir()
          else despertar()
        }}
        ref={stage}
      >
        {franja ? (
          <div className="franja">
            <button
              aria-label="Volver"
              className="boton-icono"
              onClick={(event) => {
                event.stopPropagation()
                atras()
              }}
              type="button"
            >
              <ArrowLeftIcon />
            </button>
            <p role="status">
              {details.displayName} no está en directo ahora. Sus emisiones anteriores, debajo.
            </p>
          </div>
        ) : (
          <>
            <Aviso
              channel={details}
              estado={estado}
              onRetry={player.reintentar}
              showControls={showControls}
            />
            <div
              className={`controles${showControls ? "" : " controles--ocultos"}`}
              inert={!showControls}
            >
              <div className="controles__fila">
                <button
                  aria-label="Volver"
                  className="boton-icono boton-icono--claro"
                  onClick={(event) => {
                    event.stopPropagation()
                    back()
                  }}
                  type="button"
                >
                  <ArrowLeftIcon />
                </button>
                {horizontal ? <FichaEncima channel={details} /> : null}
              </div>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: solo evita que un toque entre botones oculte los controles. */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: ídem. */}
              <div
                className="controles__fila controles__fila--centro"
                onClick={(event) => event.stopPropagation()}
              >
                {anterior === undefined ? (
                  <span className="controles__lado" />
                ) : (
                  <button
                    aria-label={`Canal anterior: ${anterior.displayName}`}
                    className="boton-icono boton-icono--claro boton-icono--lado"
                    onClick={() => {
                      onStep(anterior)
                      despertar()
                    }}
                    type="button"
                  >
                    <CaretLeftIcon weight="bold" />
                  </button>
                )}
                {enDirecto ? (
                  <Centro
                    adelante={estado.retrocedido}
                    esperando={estado.esperando && !estado.pausado}
                    onPausa={() => {
                      togglePausa()
                      despertar()
                    }}
                    onSaltar={(seconds) => {
                      skip(seconds)
                      despertar()
                    }}
                    pausado={estado.pausado}
                  />
                ) : null}
                {siguiente === undefined ? (
                  <span className="controles__lado" />
                ) : (
                  <button
                    aria-label={`Canal siguiente: ${siguiente.displayName}`}
                    className="boton-icono boton-icono--claro boton-icono--lado"
                    onClick={() => {
                      onStep(siguiente)
                      despertar()
                    }}
                    type="button"
                  >
                    <CaretRightIcon weight="bold" />
                  </button>
                )}
              </div>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: ídem. */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: ídem. */}
              <div className="controles__pie" onClick={(event) => event.stopPropagation()}>
                {dvr === null ? null : (
                  <BarraTiempo
                    bufer={dvr.duration}
                    duracion={dvr.duration}
                    etiqueta={(at) =>
                      dvr.duration - at < DVR_MIN_BACK_S
                        ? "En directo"
                        : `−${formatClock(dvr.duration - at)}`
                    }
                    onArrastrar={(on) => {
                      setArrastrando(on)
                      if (!on) despertar()
                    }}
                    onSaltar={(to) => {
                      // Como en la extensión: dentro de la lista, sin salir del directo (hacia delante, como mucho
                      // hasta donde se iba); más atrás, salvo cerca del final, al VOD.
                      const delta = to - dvr.position
                      if (delta >= 0 || -delta <= player.atras.current) saltar(delta)
                      else if (dvr.duration - to >= DVR_MIN_BACK_S)
                        openRewind(dvr.start + to * 1000)
                    }}
                    posicion={dvr.position}
                    storyboard={null}
                  />
                )}
                <div className="controles__fila">
                  {enDirecto && estado.retrocedido ? (
                    <button
                      className="al-directo"
                      onClick={() => {
                        alDirecto()
                        despertar()
                      }}
                      type="button"
                    >
                      <i aria-hidden="true" />
                      Ir al directo
                    </button>
                  ) : enDirecto ? (
                    <span className="en-directo en-directo--claro">
                      <i aria-hidden="true" />
                      En directo
                    </span>
                  ) : null}
                  {enDirecto && !estado.retrocedido && behind !== null && behind >= 1 ? (
                    <span className="por-detras">{behind} s por detrás</span>
                  ) : null}
                  <span className="controles__hueco" />
                  {estado.calidad === null ? null : (
                    <span className="calidad">{estado.calidad}</span>
                  )}
                  <button
                    aria-label={chatVisible ? "Ocultar el chat" : "Mostrar el chat"}
                    aria-pressed={chatVisible}
                    className="boton-icono boton-icono--claro boton-icono--chat"
                    onClick={toggleChat}
                    type="button"
                  >
                    <ChatTextIcon />
                  </button>
                  <button
                    aria-label={horizontal ? "Salir de la pantalla completa" : "Pantalla completa"}
                    className="boton-icono boton-icono--claro"
                    onClick={() => {
                      android.canalPantallaCompleta(!horizontal)
                      despertar()
                    }}
                    type="button"
                  >
                    {horizontal ? <CornersInIcon /> : <CornersOutIcon />}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="canal__lado">
        {horizontal ? null : <Ficha channel={details} following={following} live={enDirecto} />}
        {horizontal ? null : <Pestanas elegida={pestana} onElegir={setPestana} videos="Vídeos" />}
        {chatVisible ? (
          <Chat chat={chat} scale={preferences.chatScale} writing={writing} />
        ) : horizontal ? null : (
          <div className="canal__videos">
            <ChannelVideos login={channel.login} />
          </div>
        )}
      </div>
    </div>
  )
}

// following: si la cuenta lo sigue (SEG-1; null mientras no se sabe o sin cuenta). Seguir y dejar de seguir, en
// twitch.tv (D24): el enlace sale de la app (Paginas.kt).
const Ficha = ({
  channel,
  following,
  live,
}: {
  readonly channel: Channel
  readonly following: boolean | null
  readonly live: boolean
}) => (
  <section className="ficha">
    <Avatar
      className={`avatar avatar--ficha${live ? " avatar--vivo" : ""}`}
      name={channel.displayName}
      url={channel.profileImageUrl}
    />
    <div className="ficha__texto">
      <h1>{channel.displayName}</h1>
      {channel.title === undefined ? null : <p className="ficha__titulo">{channel.title}</p>}
      <p className="ficha__datos">
        {channel.category === undefined || channel.category === "" ? null : (
          <span>{channel.category}</span>
        )}
        {channel.viewerCount === undefined ? null : (
          <span className="ficha__espectadores">
            <UserIcon aria-label="Espectadores" />
            {formatViewers(channel.viewerCount)}
          </span>
        )}
        {channel.startedAt === undefined ? null : (
          <span title="Tiempo en directo">{formatUptime(channel.startedAt)}</span>
        )}
      </p>
    </div>
    {following === null ? null : (
      <a
        className={`seguir${following ? " seguir--si" : ""}`}
        href={`https://www.twitch.tv/${channel.login}`}
      >
        <HeartIcon aria-hidden="true" size={18} weight={following ? "fill" : "regular"} />
        {following ? "Siguiendo" : "Seguir"}
      </a>
    )}
  </section>
)

// En horizontal, la ficha va encima del vídeo, con los controles (sale al tocar y se oculta con ellos), como en la app de
// Twitch: así no le quita sitio al chat.
const FichaEncima = ({ channel }: { readonly channel: Channel }) => (
  <div className="encima">
    <Avatar
      className="avatar avatar--encima"
      name={channel.displayName}
      url={channel.profileImageUrl}
    />
    <div className="encima__texto">
      <p>
        <b>{channel.displayName}</b>
        <span className="encima__datos">
          {channel.category === undefined || channel.category === ""
            ? null
            : ` · ${channel.category}`}
          {channel.viewerCount === undefined
            ? null
            : ` · ${formatViewers(channel.viewerCount)} espectadores`}
        </span>
      </p>
      {channel.title === undefined ? null : <p className="encima__titulo">{channel.title}</p>}
    </div>
  </div>
)

// Lo que tapa el vídeo cuando no hay nada que ver: cargando, sin directo (en horizontal; en vertical, la franja) y los
// fallos. Esperando datos con los controles a la vista, gira la pausa (Centro); con ellos ocultos, aquí.
const Aviso = ({
  channel,
  estado,
  onRetry,
  showControls,
}: {
  readonly channel: Channel
  readonly estado: EstadoMedia3
  readonly onRetry: () => void
  readonly showControls: boolean
}) => {
  const { fase } = estado
  if (
    fase === "cargando" ||
    (fase === "reproduciendo" && estado.esperando && !estado.pausado && !showControls)
  ) {
    return <div aria-label="Cargando" className="girando" role="status" />
  }
  if (fase === "reproduciendo") return null
  return (
    <div className="escenario__aviso" role="alert">
      {fase === "sin-directo" ? (
        <>
          <p>{channel.displayName} no está en directo ahora.</p>
          <button
            className="boton"
            onClick={(event) => {
              event.stopPropagation()
              atras()
            }}
            type="button"
          >
            Volver
          </button>
        </>
      ) : (
        <>
          <p>No se pudo preparar el directo sin anuncios.</p>
          <button
            className="boton boton--principal"
            onClick={(event) => {
              event.stopPropagation()
              onRetry()
            }}
            type="button"
          >
            Reintentar
          </button>
        </>
      )}
    </div>
  )
}
