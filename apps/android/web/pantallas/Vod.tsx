import type { Preferences, Storyboard, VideoDetail } from "@goodttv/contratos"
import { formatAgo, formatClock, formatViewers, useReplayChat, vodDetail } from "@goodttv/interfaz"
import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ChatTextIcon,
  CornersInIcon,
  CornersOutIcon,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { android } from "../api"
import { BarraTiempo } from "./BarraTiempo"
import { Chat } from "./Chat"
import { Avatar } from "./comun"
import {
  Centro,
  Hoja,
  Opciones,
  type Pestana,
  Pestanas,
  useDespierto,
  useHorizontal,
} from "./controles"
import { seguirVod, useDeslizarParaVolver, useMandos, useMedia3Vod, vodDeCanal } from "./media3"
import { atras, navigate } from "./rutas"
import { ChannelVideos } from "./Videos"

// Un VOD (VOD-1): como un canal, con el vídeo arriba y, en horizontal, a pantalla completa. Encima, la barra para
// moverse por él (con sus miniaturas al arrastrar), pausa con 10 s a cada lado, la velocidad y la calidad; debajo, la
// ficha (su foto y su nombre llevan al canal) y, en pestañas, el chat del vídeo a la par de la imagen y los demás vídeos
// del canal, con este marcado: un VOD no es un callejón. Reanuda donde se dejó y lo dice, con la opción de empezar desde
// el principio. Retrocediendo un directo (DVR-1, «live»), sin guardar por dónde va y con «Ir al directo».

const REANUDADO_MS = 8000
const VELOCIDADES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const PRECALENTAR_MS = 20_000 // retrocediendo un directo, su empalme se mantiene caliente para volver rápido
const velocidadDe = (valor: number): string => valor.toLocaleString("es")

type Props = {
  readonly at?: number | undefined // DVR-1: desde este segundo del VOD de la emisión en curso
  readonly id: string
  readonly live?: string | undefined // DVR-1: el canal al que se vuelve
  readonly preferences: Preferences
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly video: VideoDetail }

export const Vod = ({ at, id, live, preferences }: Props) => {
  const stage = useRef<HTMLDivElement>(null)
  const pantalla = useRef<HTMLDivElement>(null)
  const player = useMedia3Vod(id, at ?? null, stage)
  const { estado, reanudado } = player

  // Los datos del vídeo (título, canal, miniaturas, chat), a la vez que su lista (useMedia3Vod).
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" })
  const [intento, setIntento] = useState(0)
  // «intento» vuelve a pedirlo.
  useEffect(() => {
    if (window.api.vods === undefined) {
      setLoaded({ kind: "error" })
      return undefined
    }
    let active = true
    setLoaded({ kind: "loading" })
    // Retrocediendo un directo, ya pedidos al ver el canal (vod-cache.ts).
    vodDetail(id)
      .then((video) => {
        if (active) setLoaded(video === null ? { kind: "missing" } : { kind: "ready", video })
      })
      .catch(() => {
        if (active) setLoaded({ kind: "error" })
      })
    return () => {
      active = false
    }
  }, [id, intento])
  const video = loaded.kind === "ready" ? loaded.video : null
  // Por dónde va, también en la esquina; retrocediendo un directo, no: no es un vídeo a medias. Los minutos, sí cuentan
  // para su canal.
  useEffect(() => seguirVod(live === undefined ? video : null), [live, video])
  useEffect(() => {
    if (video !== null) vodDeCanal(video)
  }, [video])
  // En los mandos del sistema, el título del vídeo y su canal, con su foto. Solo los de este: al pasar de un VOD a otro,
  // el primer render ya trae el id nuevo con los datos del anterior.
  const deEste = video?.id === id ? video : null
  useMandos(
    `vod/${id}`,
    deEste === null ? "" : deEste.title || "Sin título",
    deEste?.owner.displayName ?? "",
    deEste?.owner.avatar ?? undefined,
  )

  const [storyboard, setStoryboard] = useState<Storyboard | null>(null)
  useEffect(() => {
    setStoryboard(null)
    const url = video?.storyboard
    if (url == null || window.api.vods === undefined) return undefined
    let active = true
    window.api.vods
      .storyboard(url)
      .then((board) => {
        if (active) setStoryboard(board)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [video])

  // DVR-1: «Ir al directo» vuelve al canal, sin dejar este VOD en el historial (Atrás, a donde se estaba antes).
  const { latencyMode } = preferences
  const goLive = useCallback(() => {
    if (live !== undefined) navigate({ login: live, view: "channel" }, true)
  }, [live])
  useEffect(() => {
    if (live === undefined) return undefined
    const ping = (): void => android.canalPrecalentar(live, latencyMode)
    ping()
    const timer = setInterval(ping, PRECALENTAR_MS)
    return () => clearInterval(timer)
  }, [latencyMode, live])

  const horizontal = useHorizontal()
  const [chatHorizontal, setChatHorizontal] = useState(false)
  const [pestana, setPestana] = useState<Pestana>(preferences.chatVisible ? "chat" : "videos")
  const chatVisible = horizontal ? chatHorizontal : pestana === "chat"
  const chat = useReplayChat(video?.id, video?.owner.id, estado.posicion, chatVisible)

  const { despertar, despierto, dormir } = useDespierto()
  const [hoja, setHoja] = useState<"velocidad" | "calidad" | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const reproduciendo = estado.fase === "reproduciendo"
  const playing = reproduciendo && !estado.pausado
  const showControls = despierto || !playing || hoja !== null || arrastrando

  // Reanudado: lo dice unos segundos, con la opción de empezar desde el principio.
  const [reanudadoVisible, setReanudadoVisible] = useState(false)
  useEffect(() => {
    if (reanudado === null) return undefined
    setReanudadoVisible(true)
    const timer = setTimeout(() => setReanudadoVisible(false), REANUDADO_MS)
    return () => clearTimeout(timer)
  }, [reanudado])

  const duracion = estado.duracion ?? video?.seconds ?? 0
  const { irA, saltar } = player
  // Retrocediendo un directo, avanzar más allá de lo grabado lleva al directo.
  const saltarA = (segundos: number): void => {
    if (segundos > 0 && live !== undefined && estado.posicion + segundos >= duracion - 1) goLive()
    else saltar(segundos)
    despertar()
  }
  const toggleChat = (): void => {
    if (horizontal) setChatHorizontal(!chatHorizontal)
    else setPestana(chatVisible ? "videos" : "chat")
    despertar()
  }
  const back = (): void => {
    if (horizontal) android.canalPantallaCompleta(false)
    else atras()
  }
  useDeslizarParaVolver(stage, pantalla, back, true)
  const twitchUrl = `https://www.twitch.tv/videos/${id}`
  const calidad = estado.calidad ?? (estado.sonando === null ? "Auto" : `Auto (${estado.sonando})`)

  return (
    <div className={`pantalla canal${chatVisible ? "" : " canal--sin-chat"}`} ref={pantalla}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: tocar el vídeo muestra u oculta los controles, que son botones. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: ídem; sin teclado en el teléfono. */}
      <div
        className="escenario"
        onClick={() => {
          if (showControls && playing) dormir()
          else despertar()
        }}
        ref={stage}
      >
        {estado.fase === "cargando" ||
        loaded.kind === "loading" ||
        (reproduciendo && estado.esperando && !estado.pausado && !showControls) ? (
          <div aria-label="Cargando" className="girando" role="status" />
        ) : estado.fase === "error" ||
          estado.fase === "solo-suscriptores" ||
          loaded.kind !== "ready" ? (
          <div className="escenario__aviso" role="alert">
            <p>
              {loaded.kind === "missing"
                ? "Este vídeo ya no existe o no se puede ver."
                : estado.fase === "solo-suscriptores"
                  ? "Este vídeo es solo para suscriptores."
                  : "No se pudo reproducir el vídeo."}
            </p>
            <span className="botones">
              {estado.fase === "error" || loaded.kind === "error" ? (
                <button
                  className="boton boton--principal"
                  onClick={(event) => {
                    event.stopPropagation()
                    if (loaded.kind === "error") setIntento((value) => value + 1)
                    if (estado.fase === "error") player.reintentar()
                  }}
                  type="button"
                >
                  Reintentar
                </button>
              ) : null}
              {loaded.kind === "missing" ? null : (
                <a className="boton" href={twitchUrl}>
                  Abrir en twitch.tv
                </a>
              )}
            </span>
          </div>
        ) : null}
        {reanudadoVisible && reanudado !== null ? (
          <div className="reanudado" role="status">
            Sigues donde lo dejaste ({formatClock(reanudado)}).
            <button
              className="reanudado__principio"
              onClick={(event) => {
                event.stopPropagation()
                setReanudadoVisible(false)
                irA(0)
              }}
              type="button"
            >
              <ArrowCounterClockwiseIcon aria-hidden="true" />
              Desde el principio
            </button>
          </div>
        ) : null}
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
            {horizontal && video !== null ? (
              <FichaEncima video={video} />
            ) : (
              <span className="controles__hueco" />
            )}
            {/* Arriba, porque abajo no cabe con la velocidad y la calidad. */}
            {live === undefined ? null : (
              <button
                className="al-directo"
                onClick={(event) => {
                  event.stopPropagation()
                  goLive()
                }}
                type="button"
              >
                <i aria-hidden="true" />
                Ir al directo
              </button>
            )}
          </div>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: solo evita que un toque entre botones oculte los controles. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: ídem. */}
          <div
            className="controles__fila controles__fila--centro"
            onClick={(event) => event.stopPropagation()}
          >
            {reproduciendo ? (
              <Centro
                esperando={estado.esperando && !estado.pausado}
                onPausa={() => {
                  player.pausar(!estado.pausado)
                  despertar()
                }}
                onSaltar={saltarA}
                pausado={estado.pausado}
              />
            ) : null}
          </div>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: ídem. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: ídem. */}
          <div className="controles__pie" onClick={(event) => event.stopPropagation()}>
            {reproduciendo ? (
              <BarraTiempo
                bufer={estado.bufer}
                duracion={duracion}
                onArrastrar={(on) => {
                  setArrastrando(on)
                  if (!on) despertar()
                }}
                onSaltar={irA}
                posicion={estado.posicion}
                storyboard={storyboard}
              />
            ) : null}
            <div className="controles__fila">
              {reproduciendo ? (
                <span className="reloj">
                  {formatClock(estado.posicion)} / {formatClock(duracion)}
                </span>
              ) : null}
              <span className="controles__hueco" />
              {reproduciendo ? (
                <button
                  aria-label="Velocidad"
                  className="ajuste-video"
                  onClick={() => setHoja("velocidad")}
                  type="button"
                >
                  {`${velocidadDe(estado.velocidad)}×`}
                </button>
              ) : null}
              {estado.calidades.length > 0 ? (
                <button
                  aria-label="Calidad"
                  className="ajuste-video"
                  onClick={() => setHoja("calidad")}
                  type="button"
                >
                  {calidad}
                </button>
              ) : null}
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
      </div>
      <div className="canal__lado">
        {horizontal || video === null ? null : <Ficha video={video} />}
        {horizontal || video === null ? null : (
          <Pestanas elegida={pestana} onElegir={setPestana} videos="Más vídeos" />
        )}
        {chatVisible ? (
          <Chat chat={chat} replay scale={preferences.chatScale} writing="no" />
        ) : horizontal || video === null ? null : (
          <div className="canal__videos">
            <ChannelVideos current={video.id} login={video.owner.login} />
          </div>
        )}
      </div>
      {hoja === "velocidad" ? (
        <Hoja onClose={() => setHoja(null)} titulo="Velocidad">
          <Opciones
            elegida={estado.velocidad}
            onElegir={(valor) => {
              player.velocidad(valor)
              setHoja(null)
            }}
            opciones={VELOCIDADES.map((valor) => ({
              nombre: valor === 1 ? "Normal" : `${velocidadDe(valor)}×`,
              valor,
            }))}
          />
        </Hoja>
      ) : hoja === "calidad" ? (
        <Hoja onClose={() => setHoja(null)} titulo="Calidad">
          <Opciones
            elegida={estado.calidad}
            onElegir={(valor) => {
              player.calidad(valor)
              setHoja(null)
            }}
            opciones={[
              {
                nombre: estado.sonando === null ? "Automática" : `Automática (${estado.sonando})`,
                valor: null,
              },
              ...estado.calidades.map((nombre) => ({ nombre, valor: nombre })),
            ]}
          />
        </Hoja>
      ) : null}
    </div>
  )
}

// La ficha del VOD: su foto y su nombre llevan al canal (con sus demás vídeos y, si está en directo, el directo).
const Ficha = ({ video }: { readonly video: VideoDetail }) => (
  <section className="ficha">
    <a
      aria-label={`Ir al canal de ${video.owner.displayName}`}
      href={`#/canal/${video.owner.login}`}
    >
      <Avatar
        className="avatar avatar--ficha"
        name={video.owner.displayName}
        url={video.owner.avatar ?? undefined}
      />
    </a>
    <div className="ficha__texto">
      <h1>
        <a href={`#/canal/${video.owner.login}`}>{video.owner.displayName}</a>
      </h1>
      <p className="ficha__titulo">{video.title || "Sin título"}</p>
      <p className="ficha__datos">
        {[
          video.category,
          formatAgo(video.createdAt),
          `${formatViewers(video.views)} visualizaciones`,
        ]
          .filter((each) => each !== null && each !== "")
          .join(" · ")}
      </p>
    </div>
  </section>
)

// En horizontal, encima del vídeo con los controles, como la del canal.
const FichaEncima = ({ video }: { readonly video: VideoDetail }) => (
  <div className="encima">
    <Avatar
      className="avatar avatar--encima"
      name={video.owner.displayName}
      url={video.owner.avatar ?? undefined}
    />
    <div className="encima__texto">
      <p>
        <b>{video.owner.displayName}</b>
        <span className="encima__datos"> · {formatAgo(video.createdAt)}</span>
      </p>
      <p className="encima__titulo">{video.title || "Sin título"}</p>
    </div>
  </div>
)
