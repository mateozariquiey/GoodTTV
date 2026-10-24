package io.github.mateozariquiey.goodttv

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceUtil
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter
import androidx.media3.session.MediaSession
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.lang.ref.WeakReference
import java.util.UUID
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.roundToInt

// Latencia en la que se coloca al llegar la primera lista, respecto a la hora de los fragmentos (PDT), como la mide
// hls.js en medir/webview.mjs. Hasta el primer fotograma pasa ~1 s más: se acaba viendo a ~3 s, como hls.js, con ~2 s
// de búfer (informe §6).
private const val OBJETIVO_MS = 2000L
// Búfer para empezar a reproducir (bufferForPlaybackMs); en directo, Media3 usa como mucho la mitad del objetivo.
private const val BUFER_MS = 1000
// Al retroceder el directo, fragmentos que se dejan hasta el principio de la ventana: mientras se ve, la lista avanza a
// la par, y lo que sale de ella ya no se puede pedir (como SEEK_FLOOR_SEGMENTS en useHlsPlayer).
private const val SUELO_FRAGMENTOS = 3
// Lo que se queda detrás de la imagen, para que retroceder 10 s no tenga que volver a pedirlo (como backBufferLength en
// hls.js, que en la extensión mide 0,14-0,32 s).
private const val ATRAS_MS = 30_000
// Por debajo de esto, lo que se ha quedado por detrás del directo tras retroceder o pausar no cuenta como retrocedido.
private const val RETROCEDIDO_MS = 1500L
// Con la app sin verse (la pantalla apagada, o en segundo plano sin PiP), el directo va en solo audio: Twitch lo da a
// ~160 kbit/s, frente a los varios Mbit/s del vídeo (unos 70 MB por hora en vez de ~4 GB de datos). Para el motor es una
// calidad más (q=audio_only@0, en @goodttv/sin-anuncios).
private const val SOLO_AUDIO = "audio_only@0"
// El relevo al pasar a solo audio o volver al vídeo (relevar): el nuevo se coloca esto por delante de lo que suena (lo que
// tarda en tener sus datos). Si aun así el de antes llega antes, se vuelve a colocar; a la tercera, o si en este plazo no
// está, se cambia como antes, volviendo a abrir (un corte de ~1 s).
private const val ADELANTO_MS = 1500L
private const val RELEVO_INTENTOS = 3
private const val RELEVO_MAX_MS = 12_000L
private const val TIC_RELEVO_MS = 40L
// Un VOD dice por dónde va cuatro veces por segundo (el chat del vídeo y la barra); el directo, una.
private const val TIC_VOD_MS = 250L
// Para empezar un VOD en buena calidad: el ancho de banda medido la última vez o, la primera, uno que da 1080p60, como
// la extensión (useVodPlayer). Si la conexión no llega, Media3 baja tras el primer trozo.
private const val PRIMER_ANCHO_BPS = 20_000_000L
private const val ANCHO_DE_BANDA = "vod-ancho-de-banda"

val MODOS = setOf("sin-paradas", "adaptativo", "directo")

// Media3 (ExoPlayer) con el directo sin anuncios calculado en el propio teléfono: el empalme corre en una WebView sin
// mostrar (Motor.kt, web/motor.ts) y Media3 le pide la lista y los trozos del VOD por mensajes (MotorDataSource.kt); los
// fragmentos en directo los pide él mismo a Twitch. Lo usan la pantalla del canal de la app (MainActivity, con el vídeo
// debajo de la página) y ReproductorActivity, para medir. Un canal cada vez: abrir otro suelta antes el anterior, porque
// una petición tardía del anterior pararía el empalme del nuevo (informe §6.4).
// También los VOD (VOD-1, y DVR-1 al retroceder más atrás de la lista del empalme), sin el motor: la lista maestra de
// usher, que no lleva anuncios, por la red del teléfono. Uno cada vez, como los canales: abrir un VOD suelta el canal.
// Arranque: Media3 empieza a OBJETIVO_MS de la hora actual según el PDT (LiveConfiguration.targetOffsetMs), pero
// redondea hacia atrás al principio del fragmento: hasta 2 s más. Aquí, al llegar la primera lista, se coloca justo en el
// objetivo. hls.js, en cambio, cuenta su objetivo desde el final de la lista, que con los PREFETCH de Twitch va ~2 s por
// delante de la hora: sus 2,5 fragmentos (5 s) son ~3 s de latencia. Si se empieza con relleno (info.filling) o sin
// paradas, como useHlsPlayer: a 16 o 24 s del final de la lista. Sin ajuste de velocidad, como hls.js en adaptativo
// tras el primer relleno: por eso, tras retroceder (saltar), Media3 no vuelve solo al directo.
// Ojo: colocarse y medir por el PDT depende del reloj del teléfono (un reloj 1 s atrasado ve el directo 1 s más atrás).
// Todo en el hilo principal, salvo la petición de info.
//   - registrar: los eventos y una muestra por segundo, para medir (ReproductorActivity los escribe en logcat).
//   - alCambiar: el estado para la pantalla del canal o del VOD (estado()), al cambiar y a cada tic.
//   - recuperar: si una pausa larga deja atrás la ventana del directo, volver a abrirlo. Al medir, no: la medida
//     mezclaría dos reproductores con el mismo identificador.
@OptIn(UnstableApi::class)
class Reproductor(
    private val contexto: Context,
    private val vista: PlayerView,
    private val registrar: (JSONObject) -> Unit = {},
    private val alCambiar: (JSONObject) -> Unit = {},
    private val recuperar: Boolean = true,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val preferencias = contexto.getSharedPreferences("reproductor", Context.MODE_PRIVATE)
    private var player: ExoPlayer? = null
    private var medidor: DefaultBandwidthMeter? = null // el de un VOD, para guardar lo medido al soltarlo
    private var arranque: Thread? = null // pide info al motor; se interrumpe al soltar
    private var abierto: Abierto? = null
    // Los mandos del sistema (AND-5), con «fondo»: una sesión de medios desde que se abre algo hasta soltar(), con el
    // reproductor de cada visita (Mando.kt). Su notificación es la de FondoService.
    private var sesion: MediaSession? = null
    private var mando: Mando? = null
    private var datos: Pair<String, MediaMetadata>? = null // lo que mandó la página para los mandos, y de qué (clave())

    // El VOD abierto (su id), para la página, que lo pregunta desde el hilo de la WebView (MainActivity.vodPreparar).
    @Volatile var vodAbierto: String? = null
        private set

    // Lo que se ve: un canal en directo o un VOD.
    private sealed interface Que

    private class Directo(val canal: String, val modo: String, val motor: Motor, val calidad: String?) : Que

    // lista: la maestra de usher, con el token y la firma: nunca al registro.
    private class Vod(val id: String, val lista: String, val desdeMs: Long) : Que

    // Una pausa del directo (DVR-1): desde cuándo y qué momento se veía (ms, en hora real), para que la página, al
    // reanudar tras más de un minuto, siga donde se pausó en el VOD de la emisión. Aquí y no en la página: también se
    // pausa desde la esquina o el PiP, y la pantalla del canal se desmonta al dejarlo.
    // «fuera»: lo que se veía al pausar ya no está en la ventana de este reproductor (se volvió a abrir en pausa): al
    // reanudar, la página lo abre en el VOD de la emisión, como tras una pausa larga.
    private class Pausa(val desde: Long, val imagen: Long, val fuera: Boolean = false)

    // Lo que se pidió, para volver a abrirlo (reintentar, o si una pausa larga deja atrás la ventana del directo). Con
    // «pausa», se abre en pausa (la que había).
    private class Abierto(val que: Que, val fondo: Boolean, val inicio: Long, var pausa: Pausa?) {
        val pausado = pausa != null // al abrir
        val visita: String = UUID.randomUUID().toString().replace("-", "")
        val marcas = JSONObject()
        var fase = "cargando" // cargando, reproduciendo, sin-directo, solo-suscriptores, error
        var etiqueta: String? = null // la calidad que suena, como la nombra Twitch (1080p60)
        var colocado = false
        var esperas = 0
        var perdidos = 0
        var decodificador: String? = null
        var trozosVod = 0
        var fragmentoMs = 2000L
        var ajusteDePausa = false // saltar() movió en pausa lo que se veía: falta el ajuste al fotograma clave
        // Tras retroceder o pausar el directo: el desfase (ms) al que vuelve «Ir al directo», el de antes. null si no.
        var directoMs: Long? = null
        // Un VOD: sus calidades (las mejores primero) y la elegida (null: automática).
        var calidades: List<String> = emptyList()
        var calidad: String? = null
    }

    // Abre el canal (con «calidad», la que se pida; si no, la del empalme). Con «fondo», mientras está abierto hay un
    // servicio en primer plano (FondoService.kt), para seguir en segundo plano o con la pantalla apagada, con los mandos
    // del sistema en su notificación (conectarMandos). «inicio» es desde cuándo se cuentan las marcas del arranque. Con
    // «pausado», listo pero sin reproducir.
    fun abrir(
        canal: String,
        modo: String,
        motor: Motor,
        calidad: String? = null,
        fondo: Boolean = false,
        inicio: Long = SystemClock.elapsedRealtime(),
    ) = abrirDirecto(Directo(canal, modo, motor, calidad), fondo, inicio, null)

    private fun abrirDirecto(que: Directo, fondo: Boolean, inicio: Long, pausa: Pausa?) {
        val canal = que.canal
        val modo = que.modo
        val calidad = que.calidad
        val visita = empezarVisita(que, fondo, inicio, pausa)
        arranque = thread {
            val info = try {
                JSONObject(
                    leer(que.motor, "/stream/$canal/info?modo=$modo&visita=${visita.visita}" + (calidad?.let { "&q=$it" } ?: "")),
                )
            } catch (error: IOException) {
                handler.post {
                    if (abierto !== visita) return@post // interrumpido por soltar()
                    registrar(JSONObject().put("error", "info").put("causa", error.javaClass.simpleName))
                    fase(visita, "error")
                }
                return@thread
            }
            val llegada = SystemClock.elapsedRealtime() // la marca, cuando llega, no cuando le toca al hilo principal
            handler.post { if (abierto === visita) empezar(visita, info, llegada) }
        }
    }

    // Un VOD desde «desdeMs», con su lista maestra de usher (window.api.vods.playback, en la página).
    fun abrirVod(id: String, lista: String, desdeMs: Long, fondo: Boolean = false) {
        val visita = empezarVisita(Vod(id, lista, desdeMs), fondo, SystemClock.elapsedRealtime(), null)
        reproducirVod(visita, lista, desdeMs)
    }

    private fun empezarVisita(que: Que, fondo: Boolean, inicio: Long, pausa: Pausa?): Abierto {
        soltarReproductor()
        val visita = Abierto(que, fondo, inicio, pausa)
        abierto = visita
        vodAbierto = (que as? Vod)?.id
        // Entre un canal y otro con «fondo», el servicio sigue, y los mandos también, ya con lo que se abre.
        if (!fondo) {
            soltarMandos()
            pararServicio()
        } else {
            asegurarServicio()
            mando?.datos = datosDe(que)
        }
        cambio()
        return visita
    }

    // El servicio en primer plano, si lo abierto va con «fondo» y no lo tiene ya este reproductor, con la sesión de sus
    // mandos. Si Android no lo deja arrancar (la app ya no está a la vista), se vuelve a intentar al volver a ella
    // (MainActivity.onStart).
    fun asegurarServicio() {
        if (abierto?.fondo != true || conServicio?.get() === this) return
        if (!FondoService.empezar(contexto)) return
        conServicio = WeakReference(this)
        sesion?.let { FondoService.mandos(it.platformToken) }
    }

    // Lo mismo que había abierto, desde el principio (un canal; un VOD lo vuelve a pedir la página, con su lista al día).
    // Con «pausado», en pausa y con la pausa de antes.
    fun reabrir(pausado: Boolean = false) {
        val antes = abierto ?: return
        val que = antes.que as? Directo ?: return
        val pausa = if (pausado) enOtroReproductor(antes.pausa) else null
        abrirDirecto(que, antes.fondo, SystemClock.elapsedRealtime(), pausa)
    }

    // La pausa de un reproductor que se vuelve a abrir: lo que se veía queda fuera de la ventana del nuevo.
    private fun enOtroReproductor(pausa: Pausa?): Pausa {
        val ahora = System.currentTimeMillis()
        return Pausa(pausa?.desde ?: ahora, pausa?.imagen ?: ahora, fuera = true)
    }

    // La calidad con vídeo que había antes de pasar a solo audio, para volver a ella.
    private var calidadConVideo: String? = null
    // La app no se ve (MainActivity.onStop, sin el PiP a la vista): el directo, en solo audio.
    private var sinVerse = false

    // Un relevo en marcha (relevar): la visita y el reproductor nuevos, callados hasta que el de antes llega a donde están.
    private class Relevo(val visita: Abierto) {
        var player: ExoPlayer? = null
        var colocado = false
        var intentos = 0
    }
    private var relevo: Relevo? = null

    // Con la app sin verse, el directo en solo audio; al volver a verse, con vídeo otra vez, sin corte (relevar). Se
    // vuelve a mirar al empezar a sonar y al reanudar (ajustarAudio): si se dejó de ver mientras se abría o en pausa,
    // también.
    fun soloAudio(activo: Boolean) {
        sinVerse = activo
        ajustarAudio()
    }

    private fun ajustarAudio() {
        val visita = abierto ?: return
        val que = visita.que as? Directo ?: return
        // Ya está como toca: si iba hacia lo otro (se volvió a ver, o dejó de verse, mientras), ya no.
        if (sinVerse == (que.calidad == SOLO_AUDIO)) return cancelarRelevo()
        if (relevo != null) return
        val p = player
        if (sinVerse) {
            // Solo si suena en el directo, sin pausa ni retroceder: en pausa no gasta, y lo retrocedido puede no estar en
            // la lista del nuevo.
            if (p == null || !p.playWhenReady || visita.directoMs != null || visita.fase != "reproduciendo") return
            calidadConVideo = que.calidad
            relevar(visita, Directo(que.canal, que.modo, que.motor, SOLO_AUDIO))
            return
        }
        // Con vídeo otra vez. Si suena, con relevo. Si aún se estaba abriendo, volviendo a abrir. En pausa (los mandos
        // del sistema pueden pausarlo mientras), en pausa: lo que se veía no está en la lista del nuevo, y al reanudar la
        // página lo abre en el VOD de la emisión, como tras una pausa larga.
        val nuevo = Directo(que.canal, que.modo, que.motor, calidadConVideo)
        val pausado = p != null && !p.playWhenReady && visita.fase == "reproduciendo"
        if (p != null && !pausado && visita.fase == "reproduciendo") return relevar(visita, nuevo)
        val pausa = if (pausado) enOtroReproductor(visita.pausa) else null
        registrar(JSONObject().put("relevo", "reabrir").put("pausado", pausado).put("fuera", pausa?.fuera == true))
        abrirDirecto(nuevo, visita.fondo, SystemClock.elapsedRealtime(), pausa)
    }

    // El relevo: pasar a solo audio o volver al vídeo sin corte. El nuevo se abre al lado, callado, mientras el de antes
    // sigue sonando (el motor le sigue sirviendo su lista: directo.ts), y se coloca en la misma hora de los fragmentos,
    // ADELANTO_MS por delante; cuando el de antes llega ahí, suena el nuevo y se suelta el de antes. Lo retrocedido sigue
    // retrocedido. Si algo falla o tarda, se cambia como antes, volviendo a abrir.
    private fun relevar(antes: Abierto, que: Directo) {
        val r = Relevo(Abierto(que, antes.fondo, SystemClock.elapsedRealtime(), null))
        relevo = r
        registrar(JSONObject().put("relevo", "empieza").put("audio", que.calidad == SOLO_AUDIO))
        val ruta = "/stream/${que.canal}/info?modo=${que.modo}&visita=${r.visita.visita}" + (que.calidad?.let { "&q=$it" } ?: "")
        thread {
            val info = try {
                JSONObject(leer(que.motor, ruta))
            } catch (error: IOException) {
                null
            }
            handler.post { if (relevo === r) prepararRelevo(r, info) }
        }
        handler.postDelayed({ if (relevo === r) sinRelevo(r, "plazo") }, RELEVO_MAX_MS)
    }

    private fun prepararRelevo(r: Relevo, info: JSONObject?) {
        if (info == null || info.optBoolean("offline")) return sinRelevo(r, "info")
        val visita = r.visita
        val que = visita.que as Directo
        val lista = leerInfo(visita, info)
        val nuevo = crearDirecto(que)
        r.player = nuevo
        nuevo.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                if (relevo === r) sinRelevo(r, error.errorCodeName)
            }
        })
        nuevo.setMediaItem(sinAcelerar(lista))
        nuevo.playWhenReady = false
        nuevo.prepare()
        vigilarRelevo(r)
    }

    // Cada TIC_RELEVO_MS: en cuanto el nuevo tiene lista, se coloca; cuando tiene datos, espera a que el de antes llegue.
    private fun vigilarRelevo(r: Relevo) {
        if (relevo !== r) return
        val nuevo = r.player ?: return
        val antes = player ?: return sinRelevo(r, "sin reproductor")
        if (!r.colocado) {
            if (ventana(nuevo) != null && !colocarRelevo(r, nuevo, antes)) return
        } else if (nuevo.playbackState == Player.STATE_READY) {
            val hora = horaDe(nuevo)
            val ahora = horaDe(antes)
            if (hora == null || ahora == null) return sinRelevo(r, "sin hora")
            val falta = hora - ahora
            when {
                falta < -TIC_RELEVO_MS * 2 -> if (r.intentos < RELEVO_INTENTOS) {
                    if (!colocarRelevo(r, nuevo, antes)) return
                } else return sinRelevo(r, "tarde")
                falta <= TIC_RELEVO_MS -> {
                    handler.postDelayed({ if (relevo === r) entregar(r, hora - (horaDe(antes) ?: hora)) }, maxOf(0, falta))
                    return
                }
            }
        }
        handler.postDelayed({ vigilarRelevo(r) }, TIC_RELEVO_MS)
    }

    // El nuevo, ADELANTO_MS por delante de la hora del de antes, sin acercarse al final de su lista. false si no cabe.
    private fun colocarRelevo(r: Relevo, nuevo: ExoPlayer, antes: ExoPlayer): Boolean {
        val ventana = ventana(nuevo)
        val ahora = horaDe(antes)
        if (ventana == null || ventana.windowStartTimeMs == C.TIME_UNSET || ahora == null) {
            sinRelevo(r, "sin hora")
            return false
        }
        val posicion = minOf(ahora + ADELANTO_MS - ventana.windowStartTimeMs, ventana.durationMs - 1000)
        if (posicion < r.visita.fragmentoMs) {
            sinRelevo(r, "fuera de la lista")
            return false
        }
        r.colocado = true
        r.intentos++
        nuevo.seekTo(posicion)
        return true
    }

    // La hora (ms, la de los fragmentos) de lo que se ve.
    private fun horaDe(p: ExoPlayer): Long? {
        val ventana = ventana(p) ?: return null
        if (ventana.windowStartTimeMs == C.TIME_UNSET) return null
        return ventana.windowStartTimeMs + p.currentPosition
    }

    // El nuevo suena y el de antes se suelta. «desfase»: lo que el de antes aún no había llegado (+) o se había pasado (-).
    private fun entregar(r: Relevo, desfase: Long) {
        val nuevo = r.player ?: return
        val antes = abierto ?: return
        relevo = null
        val viejo = player
        r.visita.directoMs = antes.directoMs
        r.visita.fase = "reproduciendo"
        abierto = r.visita
        // Conectado antes de sonar: Media3 avisa de que suena al darle, y lo que avisa (la pantalla encendida, la página)
        // es del nuevo.
        conectar(r.visita, nuevo)
        nuevo.playWhenReady = true
        viejo?.release()
        registrar(
            JSONObject().put("relevo", "entregado").put("desfaseMs", desfase).put("intentos", r.intentos)
                .put("ms", SystemClock.elapsedRealtime() - r.visita.inicio),
        )
        cambio()
    }

    // No se pudo: como antes, volviendo a abrir (un corte de ~1 s).
    private fun sinRelevo(r: Relevo, causa: String) {
        if (relevo !== r) return
        cancelarRelevo()
        val antes = abierto ?: return
        registrar(JSONObject().put("relevo", "sin").put("causa", causa))
        abrirDirecto(r.visita.que as Directo, antes.fondo, SystemClock.elapsedRealtime(), null)
    }

    private fun cancelarRelevo() {
        relevo?.player?.release()
        relevo = null
    }

    // Si ese canal ya está abierto con ese modo y sin fallos: al volver a él desde el minirreproductor no se reabre.
    fun tiene(canal: String, modo: String): Boolean {
        val visita = abierto ?: return false
        val que = visita.que as? Directo ?: return false
        return que.canal == canal && que.modo == modo && visita.fase != "error" && visita.fase != "sin-directo"
    }

    // El canal abierto, o null si no hay o es un VOD.
    val canal: String? get() = (abierto?.que as? Directo)?.canal

    // Si hay algo que ver (o que está por llegar): lo que vale la pena dejar en la esquina o en el PiP.
    val enMarcha: Boolean get() = abierto?.fase.let { it == "cargando" || it == "reproduciendo" }

    // El estado otra vez, ahora (para la página que vuelve al canal).
    fun avisar() = cambio()

    // Pausar el directo es retroceder (DVR-1): al reanudar sigue donde se pausó, y «Ir al directo» vuelve a donde iba.
    // Un VOD terminado vuelve a empezar.
    fun pausar(pausa: Boolean) {
        val p = player ?: return
        val visita = abierto ?: return
        cancelarRelevo() // al reanudar, se vuelve a mirar (ajustarAudio)
        if (pausa && visita.que is Directo) {
            if (visita.directoMs == null) visita.directoMs = desfase(p)
            if (visita.pausa == null) {
                val ahora = System.currentTimeMillis()
                visita.pausa = Pausa(ahora, ahora - desfase(p))
            }
        }
        if (!pausa) visita.pausa = null
        if (!pausa && p.playbackState == Player.STATE_ENDED) p.seekTo(0)
        p.playWhenReady = !pausa
        cambio()
        if (!pausa) handler.post { if (abierto === visita) ajustarAudio() }
    }

    // Mueve la imagen «segundos». En directo (DVR-1), dentro de la ventana (la lista del empalme), en el mismo
    // reproductor: hacia atrás, hasta SUELO_FRAGMENTOS del principio; hacia delante, como mucho hasta donde iba antes de
    // retroceder. La página solo pide lo que cabe (atras, en estado()); lo de más atrás lo abre en el VOD de la emisión.
    // En un VOD, desde donde va.
    fun saltar(segundos: Double) {
        val p = player ?: return
        val visita = abierto ?: return
        if (visita.que is Vod) return irA(p.currentPosition / 1000.0 + segundos)
        val ventana = ventana(p) ?: return
        if (relevo != null) {
            // El relevo se coloca por donde iba: se vuelve a empezar desde donde se queda.
            cancelarRelevo()
            handler.post { if (abierto === visita) ajustarAudio() }
        }
        val desde = p.currentPosition
        if (segundos < 0 && visita.directoMs == null) visita.directoMs = desfase(p)
        val directo = posicionDelDirecto(visita, ventana) ?: desde
        val destino = minOf(desde + (segundos * 1000).toLong(), directo)
            .coerceAtLeast(minOf(desde, suelo(visita)))
        if (destino >= directo - RETROCEDIDO_MS) visita.directoMs = null
        // En pausa, lo que se veía se mueve con la imagen: al reanudar tras más de un minuto, el VOD abre donde se dejó, no
        // donde se pausó. Media3 cae en el fotograma clave anterior (PREVIOUS_SYNC): ese ajuste llega después
        // (onPositionDiscontinuity). Si lo pausado estaba «fuera» (reabierto en pausa), lo que se ve es de este
        // reproductor: su hora.
        visita.pausa?.let {
            val movido = destino - desde
            val imagen = if (it.fuera) System.currentTimeMillis() - (desfase(p) - movido) else it.imagen + movido
            visita.pausa = Pausa(it.desde, imagen)
            visita.ajusteDePausa = true
        }
        irHacia(p, destino, SeekParameters.PREVIOUS_SYNC)
        cambio()
    }

    // «Ir al directo»: a donde iba antes de retroceder o pausar.
    fun alDirecto() {
        val p = player ?: return
        val visita = abierto ?: return
        val ventana = ventana(p) ?: return
        val directo = posicionDelDirecto(visita, ventana) ?: return
        cancelarRelevo() // ídem: se vuelve a mirar abajo
        visita.directoMs = null
        // Sigue en el directo: sin la pausa de antes, que si no seguía contando y, al pausar otra vez y reanudar, abría el
        // VOD donde se pausó la primera vez.
        visita.pausa = null
        irHacia(p, directo, SeekParameters.PREVIOUS_SYNC)
        p.playWhenReady = true
        cambio()
        handler.post { if (abierto === visita) ajustarAudio() }
    }

    // Un VOD: a ese segundo (sin pasar del final).
    fun irA(segundos: Double) {
        val p = player ?: return
        if (abierto?.que !is Vod) return
        val fin = p.duration.takeIf { it != C.TIME_UNSET } ?: Long.MAX_VALUE
        irHacia(p, (segundos * 1000).toLong().coerceIn(0, maxOf(0, fin - 500)), SeekParameters.CLOSEST_SYNC)
        cambio()
    }

    // Los saltos de la persona van al fotograma clave (cada 2 s en Twitch): en el emulador, 0,05-0,2 s, frente a 0,4-1,5 s
    // decodificando hasta el punto exacto. En directo, al de antes, para no acercarse al final de la lista más de lo
    // pedido. Colocarse al empezar el directo sigue siendo exacto (colocar()).
    private fun irHacia(p: ExoPlayer, ms: Long, ajuste: SeekParameters) {
        p.setSeekParameters(ajuste)
        p.seekTo(ms)
    }

    fun velocidad(valor: Float) {
        val p = player ?: return
        if (abierto?.que !is Vod) return
        p.setPlaybackSpeed(valor.coerceIn(0.25f, 2f))
        cambio()
    }

    // La calidad de un VOD, como la dice estado() (1080p60); null, la automática.
    fun calidad(nombre: String?) {
        val p = player ?: return
        val visita = abierto ?: return
        if (visita.que !is Vod) return
        val grupo = p.currentTracks.groups.firstOrNull { it.type == C.TRACK_TYPE_VIDEO }
        val pista = grupo?.let { g -> (0 until g.length).firstOrNull { etiqueta(g.getTrackFormat(it)) == nombre } }
        val parametros = p.trackSelectionParameters.buildUpon()
        if (nombre == null || grupo == null || pista == null) {
            parametros.clearOverridesOfType(C.TRACK_TYPE_VIDEO)
            visita.calidad = null
        } else {
            parametros.setOverrideForType(TrackSelectionOverride(grupo.mediaTrackGroup, pista))
            visita.calidad = nombre
        }
        p.trackSelectionParameters = parametros.build()
        cambio()
    }

    // Para los mandos del sistema: el título, el texto de debajo y la foto de «clave» (canal/<canal> o vod/<id>, como su
    // ruta en la página). Si llega antes de abrirlo, se usa al abrirlo.
    fun datos(clave: String, titulo: String, texto: String, foto: Uri?) {
        datos = clave to MediaMetadata.Builder()
            .setTitle(titulo)
            .setArtist(texto.ifEmpty { null })
            .setArtworkUri(foto)
            .build()
        val visita = abierto ?: return
        mando?.datos = datosDe(visita.que)
    }

    private fun clave(que: Que) = when (que) {
        is Directo -> "canal/${que.canal}"
        is Vod -> "vod/${que.id}"
    }

    // Lo que mandó la página para eso o, si no, el nombre del canal.
    private fun datosDe(que: Que): MediaMetadata = datos?.takeIf { it.first == clave(que) }?.second
        ?: MediaMetadata.Builder().setTitle(if (que is Directo) que.canal else "Vídeo").setArtist("GoodTTV").build()

    // La sesión es la misma para todo lo que se abra hasta soltar(): así la notificación no cambia de sesión al pasar de un
    // canal a otro. Su id, el de la visita: dos sesiones con el mismo id no pueden convivir (ReproductorActivity, al medir).
    private fun conectarMandos(visita: Abierto, nuevo: ExoPlayer) {
        val envoltorio = Mando(nuevo) { pausar(it) }
        envoltorio.datos = datosDe(visita.que)
        mando = envoltorio
        sesion?.let { return it.setPlayer(envoltorio) }
        val nueva = MediaSession.Builder(contexto, envoltorio).setId(visita.visita)
        FondoService.abrirApp(contexto)?.let { nueva.setSessionActivity(it) }
        sesion = nueva.build().also { FondoService.mandos(it.platformToken) }
    }

    // Suelta el reproductor y para la petición de info si aún no ha vuelto (el motor la contaría como del canal actual).
    fun soltar() {
        soltarReproductor()
        soltarMandos()
        pararServicio()
    }

    // Deja de verse lo abierto, sin soltar el servicio ni los mandos: lo que se abre después (el VOD al retroceder) los
    // sigue usando, como entre un canal y otro.
    fun parar() = soltarReproductor()

    private fun soltarMandos() {
        sesion?.release()
        sesion = null
        mando = null
    }

    private fun soltarReproductor() {
        cancelarRelevo()
        arranque?.interrupt()
        arranque = null
        handler.removeCallbacksAndMessages(null)
        mando?.suelto = true // el ExoPlayer liberado ya no avisa: que los mandos no lo enseñen sonando
        medidor?.bitrateEstimate?.takeIf { it > 1_000_000 }?.let { preferencias.edit().putLong(ANCHO_DE_BANDA, it).apply() }
        medidor = null
        player?.release()
        player = null
        vista.player = null
        vista.keepScreenOn = false
        abierto = null
        vodAbierto = null
    }

    // Si otro reproductor ha arrancado el servicio después (otro canal en otra actividad), el servicio es suyo.
    private fun pararServicio() {
        if (conServicio?.get() !== this) return
        FondoService.parar(contexto)
        conServicio = null
    }

    // Para la pantalla del canal: el canal, la fase, si espera datos o está en pausa, la latencia (s), la calidad y, para
    // retroceder (DVR-1), cuánto cabe en la ventana (atras, s) y si va por detrás de donde iba (retrocedido). Para la de
    // un VOD: el vídeo, la posición, la duración y hasta dónde hay datos (s), la velocidad y las calidades.
    fun estado(): JSONObject {
        val visita = abierto ?: return JSONObject().put("fase", "cerrado")
        val p = player
        val estado = JSONObject()
            .put("fase", visita.fase)
            .put("esperando", p?.playbackState == Player.STATE_BUFFERING)
            // Sin reproductor (al abrir), como se abre: reabierto en pausa, en pausa.
            .put(
                "pausado",
                if (p == null) visita.pausado else !p.playWhenReady || p.playbackState == Player.STATE_ENDED,
            )
        when (val que = visita.que) {
            is Directo -> {
                val desfase = p?.currentLiveOffset ?: C.TIME_UNSET
                val ventana = p?.let { ventana(it) }
                val directo = ventana?.let { posicionDelDirecto(visita, it) }
                estado
                    .put("canal", que.canal)
                    .put("latencia", if (desfase == C.TIME_UNSET) JSONObject.NULL else desfase / 1000.0)
                    .put("calidad", visita.etiqueta ?: JSONObject.NULL)
                    .put(
                        "atras",
                        if (p == null || ventana == null) 0.0 else maxOf(0L, p.currentPosition - suelo(visita)) / 1000.0,
                    )
                    .put("retrocedido", p != null && directo != null && p.currentPosition < directo - RETROCEDIDO_MS)
                    .put("pausadoDesde", visita.pausa?.desde ?: JSONObject.NULL)
                    .put("imagenPausada", visita.pausa?.imagen ?: JSONObject.NULL)
                    .put("pausaFuera", visita.pausa?.fuera == true)
            }
            is Vod -> estado
                .put("vod", que.id)
                .put("posicion", (p?.currentPosition ?: que.desdeMs) / 1000.0)
                .put("duracion", p?.duration?.takeIf { it != C.TIME_UNSET }?.let { it / 1000.0 } ?: JSONObject.NULL)
                .put("bufer", (p?.bufferedPosition ?: 0) / 1000.0)
                .put("velocidad", p?.playbackParameters?.speed ?: 1f)
                .put("calidades", JSONArray(visita.calidades))
                .put("calidad", visita.calidad ?: JSONObject.NULL)
                .put("sonando", p?.videoFormat?.let { etiqueta(it) } ?: JSONObject.NULL)
        }
        return estado
    }

    private fun cambio() = alCambiar(estado())

    private fun fase(visita: Abierto, fase: String) {
        visita.fase = fase
        cambio()
    }

    // La ventana del directo, si ya hay lista.
    private fun ventana(p: ExoPlayer): Timeline.Window? {
        if (p.currentTimeline.isEmpty) return null
        val ventana = p.currentTimeline.getWindow(p.currentMediaItemIndex, Timeline.Window())
        return ventana.takeIf { it.isLive && it.durationMs != C.TIME_UNSET }
    }

    private fun desfase(p: ExoPlayer): Long = p.currentLiveOffset.takeIf { it != C.TIME_UNSET } ?: OBJETIVO_MS

    private fun suelo(visita: Abierto) = SUELO_FRAGMENTOS * visita.fragmentoMs

    // Dónde queda, en la ventana, lo que se veía antes de retroceder: la hora de ahora menos aquel desfase. null si no se
    // ha retrocedido o la lista no trae hora.
    private fun posicionDelDirecto(visita: Abierto, ventana: Timeline.Window): Long? {
        val desfase = visita.directoMs ?: return null
        if (ventana.windowStartTimeMs == C.TIME_UNSET) return null
        return (ventana.currentUnixTimeMs - ventana.windowStartTimeMs - desfase).coerceIn(0, ventana.durationMs)
    }

    private fun empezar(visita: Abierto, info: JSONObject, llegada: Long) {
        marca(visita, "info", llegada)
        if (info.optBoolean("offline")) {
            registrar(JSONObject().put("fin", "sin directo"))
            return fase(visita, "sin-directo")
        }
        val que = visita.que as Directo
        val lista = leerInfo(visita, info)
        val fragmento = visita.fragmentoMs / 1000.0
        val desdeElFinal = when {
            que.modo == "sin-paradas" -> maxOf(24.0, 2.5 * fragmento)
            info.optBoolean("filling") -> maxOf(16.0, 2.5 * fragmento)
            else -> null
        }
        reproducir(visita, que, lista, desdeElFinal?.let { (it * 1000).toLong() })
    }

    // De la info del motor: la calidad que suena y lo que dura un fragmento. Devuelve la lista del directo.
    private fun leerInfo(visita: Abierto, info: JSONObject): String {
        val que = visita.que as Directo
        val calidad = info.optString("quality").takeIf { it.isNotEmpty() && it != "null" }
        val calidades = info.optJSONArray("qualities")
        visita.etiqueta = (0 until (calidades?.length() ?: 0))
            .mapNotNull { calidades?.optJSONObject(it) }
            .firstOrNull { it.optString("id") == calidad }
            ?.optString("label")
        val fragmento = info.optDouble("segmentDuration", 2.0).takeIf { !it.isNaN() } ?: 2.0
        visita.fragmentoMs = (fragmento * 1000).toLong()
        return "$ORIGEN/stream/${que.canal}/live.m3u8?modo=${que.modo}&visita=${visita.visita}" +
            (calidad?.let { "&q=$it" } ?: "")
    }

    private fun reproducir(visita: Abierto, que: Directo, lista: String, desdeElFinalMs: Long?) {
        val nuevo = crearDirecto(que)
        nuevo.addListener(object : Player.Listener {
            override fun onTimelineChanged(timeline: Timeline, reason: Int) =
                colocar(visita, nuevo, timeline, desdeElFinalMs)
        })
        montar(visita, nuevo, sinAcelerar(lista), C.TIME_UNSET)
    }

    // Un reproductor del directo: la lista, del motor; los fragmentos, de Twitch (EnrutadoDataSource).
    private fun crearDirecto(que: Directo): ExoPlayer {
        val http = DefaultHttpDataSource.Factory()
        val fuentes = DataSource.Factory { EnrutadoDataSource(que.motor, http.createDataSource()) }
        return ExoPlayer.Builder(contexto)
            .setMediaSourceFactory(HlsMediaSource.Factory(fuentes))
            .setLoadControl(
                DefaultLoadControl.Builder()
                    .setBufferDurationsMs(
                        DefaultLoadControl.DEFAULT_MIN_BUFFER_MS,
                        DefaultLoadControl.DEFAULT_MAX_BUFFER_MS,
                        BUFER_MS,
                        DefaultLoadControl.DEFAULT_BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS,
                    )
                    .setBackBuffer(ATRAS_MS, true)
                    .build(),
            )
            .build()
    }

    private fun reproducirVod(visita: Abierto, lista: String, desdeMs: Long) {
        val estimado = preferencias.getLong(ANCHO_DE_BANDA, PRIMER_ANCHO_BPS)
        val nuevoMedidor = DefaultBandwidthMeter.Builder(contexto).setInitialBitrateEstimate(estimado).build()
        medidor = nuevoMedidor
        // Twitch no sirve los trozos «-unmuted» del VOD: la versión silenciada, como en el relleno y en la extensión.
        val fuentes = ResolvingDataSource.Factory(DefaultHttpDataSource.Factory()) { spec ->
            val ruta = spec.uri.encodedPath
            if (ruta == null || !ruta.endsWith("-unmuted.ts")) spec
            else spec.withUri(spec.uri.buildUpon().encodedPath(ruta.removeSuffix("-unmuted.ts") + "-muted.ts").build())
        }
        val nuevo = ExoPlayer.Builder(contexto)
            .setBandwidthMeter(nuevoMedidor)
            .setMediaSourceFactory(HlsMediaSource.Factory(fuentes))
            .setLoadControl(DefaultLoadControl.Builder().setBackBuffer(ATRAS_MS, true).build())
            .build()
        nuevo.addListener(object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) {
                visita.calidades = tracks.groups
                    .filter { it.type == C.TRACK_TYPE_VIDEO }
                    .flatMap { g -> (0 until g.length).filter { g.isTrackSupported(it) }.map { g.getTrackFormat(it) } }
                    .sortedWith(compareByDescending<Format> { it.height }.thenByDescending { it.frameRate })
                    .mapNotNull { etiqueta(it) }
                    .distinct()
                cambio()
            }
        })
        // Desde 1 ms y no desde 0: en el VOD de una emisión en curso (lista EVENT, una ventana en directo), Media3 toma el 0
        // por «sin posición» y empieza por el final (MaskingMediaSource, en Media3 1.11).
        montar(visita, nuevo, sinAcelerar(lista), maxOf(1, desdeMs))
    }

    // Sin acelerar ni frenar para acercarse al directo: ni al empezar (se coloca en colocar()) ni tras saltar (DVR-1).
    // También en un VOD que sigue grabándose (lista EVENT, que Media3 trata como un directo).
    private fun sinAcelerar(lista: String) = MediaItem.Builder()
        .setUri(lista)
        .setLiveConfiguration(
            MediaItem.LiveConfiguration.Builder()
                .setTargetOffsetMs(OBJETIVO_MS)
                .setMinPlaybackSpeed(1f)
                .setMaxPlaybackSpeed(1f)
                .build(),
        )
        .build()

    // Lo común del directo y del VOD: el estado para la página, las marcas y lo que se registra al medir.
    private fun montar(visita: Abierto, nuevo: ExoPlayer, item: MediaItem, desdeMs: Long) {
        conectar(visita, nuevo)
        if (desdeMs == C.TIME_UNSET) nuevo.setMediaItem(item) else nuevo.setMediaItem(item, desdeMs)
        nuevo.playWhenReady = !visita.pausado
        nuevo.prepare()
        marca(visita, "reproductor")
    }

    // El reproductor de lo que se ve (al montarlo, o al entregar un relevo): en la vista, en los mandos, y con lo que
    // avisa a la página y lo que se registra.
    private fun conectar(visita: Abierto, nuevo: ExoPlayer) {
        player = nuevo
        vista.player = nuevo
        if (visita.fondo) conectarMandos(visita, nuevo)
        nuevo.addAnalyticsListener(object : AnalyticsListener {
            override fun onRenderedFirstFrame(eventTime: AnalyticsListener.EventTime, output: Any, renderTimeMs: Long) =
                marca(visita, "fotograma")

            override fun onVideoDecoderInitialized(
                eventTime: AnalyticsListener.EventTime,
                decoderName: String,
                initializedTimestampMs: Long,
                initializationDurationMs: Long,
            ) {
                visita.decodificador = decoderName
            }

            override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
                visita.perdidos += droppedFrames
            }

            // El primer fotograma se pinta aunque aún no reproduzca (espera a tener búfer): «reproduciendo» es cuando
            // empieza a avanzar. Mientras avanza, la pantalla no se apaga.
            override fun onIsPlayingChanged(eventTime: AnalyticsListener.EventTime, isPlaying: Boolean) {
                vista.keepScreenOn = isPlaying
                if (isPlaying) {
                    marca(visita, "reproduciendo")
                    visita.fase = "reproduciendo"
                    // Si mientras se abría se dejó de ver la app (o volvió a verse), ahora toca.
                    handler.post { if (abierto === visita) ajustarAudio() }
                }
                cambio()
            }

            // En pausa (reabierto tras una pausa larga, o pausado antes de empezar): reproduciendo en cuanto está listo,
            // aunque no avance.
            override fun onPlaybackStateChanged(eventTime: AnalyticsListener.EventTime, state: Int) {
                if (state == Player.STATE_BUFFERING && visita.marcas.has("fotograma")) visita.esperas++
                if (state == Player.STATE_READY && !nuevo.playWhenReady) visita.fase = "reproduciendo"
                cambio()
            }

            // Tras una pausa larga, lo que se estaba viendo ya no está en la lista: con «recuperar», se vuelve a abrir, en el
            // directo (y en pausa, si lo estaba: al reanudar, la página sigue donde se pausó, en el VOD de la emisión). Un VOD
            // solo para suscriptores: usher contesta 403.
            override fun onPlayerError(eventTime: AnalyticsListener.EventTime, error: PlaybackException) {
                registrar(
                    JSONObject().put("error", error.errorCodeName).put("causa", error.cause?.javaClass?.simpleName),
                )
                when {
                    recuperar && visita.que is Directo &&
                        error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW -> {
                        val pausado = !nuevo.playWhenReady
                        handler.post { reabrir(pausado) }
                    }
                    visita.que is Vod && (error.cause as? InvalidResponseCodeException)?.responseCode == 403 &&
                        visita.fase == "cargando" -> fase(visita, "solo-suscriptores")
                    else -> fase(visita, "error")
                }
            }

            // Para comprobar el relleno: los trozos del VOD que Media3 ha cargado del motor (con lo que ocupan y lo que
            // tardaron, para ver cuánto da el puente), y los fallos de carga (sin la URL, que en los fragmentos en
            // directo es de Twitch).
            override fun onLoadCompleted(
                eventTime: AnalyticsListener.EventTime,
                loadEventInfo: LoadEventInfo,
                mediaLoadData: MediaLoadData,
            ) {
                if (loadEventInfo.uri.host == HOST && loadEventInfo.uri.path == "/stream/vod" &&
                    mediaLoadData.dataType == C.DATA_TYPE_MEDIA
                ) {
                    visita.trozosVod++
                    registrar(
                        JSONObject().put("cargaVod", loadEventInfo.bytesLoaded).put("ms", loadEventInfo.loadDurationMs),
                    )
                }
            }

            override fun onLoadError(
                eventTime: AnalyticsListener.EventTime,
                loadEventInfo: LoadEventInfo,
                mediaLoadData: MediaLoadData,
                error: IOException,
                wasCanceled: Boolean,
            ) = registrar(
                JSONObject()
                    .put("errorCarga", error.javaClass.simpleName)
                    .put("tipo", mediaLoadData.dataType)
                    .put("motor", loadEventInfo.uri.host == HOST),
            )

            // El ajuste al fotograma clave de un salto en pausa (saltar): lo que se veía, adonde de verdad cae. Solo ese:
            // colocarse al abrir también salta, y no es moverse.
            override fun onPositionDiscontinuity(
                eventTime: AnalyticsListener.EventTime,
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int,
            ) {
                if (abierto === visita && reason == Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT && visita.ajusteDePausa) {
                    visita.ajusteDePausa = false
                    visita.pausa?.let {
                        visita.pausa = Pausa(it.desde, it.imagen + (newPosition.positionMs - oldPosition.positionMs))
                    }
                }
                registrar(
                    JSONObject().put("salto", reason).put("deMs", oldPosition.positionMs).put("aMs", newPosition.positionMs),
                )
            }
        })
        val vod = visita.que is Vod
        handler.post(object : Runnable {
            override fun run() {
                if (abierto !== visita) return // tras un relevo, el del nuevo
                if (!vod) muestra(visita)
                cambio()
                handler.postDelayed(this, if (vod) TIC_VOD_MS else 1000)
            }
        })
    }

    // Con la primera lista: justo en el objetivo, sin el redondeo de Media3 al principio del fragmento.
    private fun colocar(visita: Abierto, p: ExoPlayer, timeline: Timeline, desdeElFinalMs: Long?) {
        if (visita.colocado || timeline.isEmpty) return
        val ventana = timeline.getWindow(p.currentMediaItemIndex, Timeline.Window())
        if (!ventana.isLive || ventana.durationMs == C.TIME_UNSET) return
        visita.colocado = true
        marca(visita, "lista")
        val posicion = desdeElFinalMs?.let { ventana.durationMs - it }
            ?: (ventana.currentUnixTimeMs - ventana.windowStartTimeMs - OBJETIVO_MS)
        val destino = posicion.coerceIn(0, maxOf(0, ventana.durationMs - 1000))
        if (abs(destino - p.currentPosition) > 100) p.seekTo(destino)
    }

    private fun muestra(visita: Abierto) {
        val p = player ?: return
        val contadores = p.videoDecoderCounters
        contadores?.ensureUpdated()
        val desfase = p.currentLiveOffset
        // currentPosition cuenta desde el principio de la ventana del directo, que avanza con la lista (en cuanto el
        // empalme publica sus 20 fragmentos, deja de crecer aunque el vídeo avance): «tiempo» es la posición en el
        // periodo, que solo se para si se para el vídeo.
        val ventana = p.currentTimeline.takeUnless { it.isEmpty }?.getWindow(p.currentMediaItemIndex, Timeline.Window())
        registrar(
            JSONObject()
                .put("s", segundos(visita))
                .put("estado", p.playbackState)
                .put("reproduce", p.isPlaying)
                .put("latencia", if (desfase == C.TIME_UNSET) JSONObject.NULL else desfase / 1000.0)
                .put("bufer", (p.bufferedPosition - p.currentPosition) / 1000.0)
                .put("tiempo", (p.currentPosition + (ventana?.positionInFirstPeriodMs ?: 0)) / 1000.0)
                .put("velocidad", p.playbackParameters.speed)
                .put("alto", p.videoFormat?.height ?: 0)
                .put("fps", p.videoFormat?.frameRate ?: 0)
                .put("decodificador", visita.decodificador ?: JSONObject.NULL)
                .put("pintados", contadores?.renderedOutputBufferCount ?: 0)
                .put("perdidos", visita.perdidos)
                .put("saltados", contadores?.skippedOutputBufferCount ?: 0)
                .put("esperas", visita.esperas)
                .put("trozosVod", visita.trozosVod)
                .put("marcas", visita.marcas),
        )
    }

    private fun segundos(visita: Abierto) = (SystemClock.elapsedRealtime() - visita.inicio) / 1000.0

    private fun marca(visita: Abierto, nombre: String, cuando: Long = SystemClock.elapsedRealtime()) {
        if (!visita.marcas.has(nombre)) visita.marcas.put(nombre, cuando - visita.inicio)
    }

    // Una petición al motor fuera del hilo principal (info espera a que haya algo publicado).
    private fun leer(motor: Motor, ruta: String): String {
        val fuente = MotorDataSource(motor)
        try {
            fuente.open(DataSpec(Uri.parse(ORIGEN + ruta)))
            return String(DataSourceUtil.readToEnd(fuente), Charsets.UTF_8)
        } finally {
            fuente.close()
        }
    }

    companion object {
        // El último que arrancó FondoService (hilo principal). Débil: lo suelta al cerrarse, pero así no lo retiene.
        private var conServicio: WeakReference<Reproductor>? = null

        // Una calidad como la nombra Twitch: el alto y los fotogramas por segundo (1080p60, 480p30).
        fun etiqueta(formato: Format): String? {
            if (formato.height <= 0) return null
            val fps = formato.frameRate
            return if (fps > 0) "${formato.height}p${fps.roundToInt()}" else "${formato.height}p"
        }

        // Precalentar el canal en el motor (DVR-1: mientras se retrocede, para que «Ir al directo» sea rápido), fuera del
        // hilo principal. Si falla, no pasa nada: al volver, el canal se abre sin el adelanto.
        fun precalentar(motor: Motor, canal: String, modo: String) {
            thread {
                val fuente = MotorDataSource(motor)
                try {
                    fuente.open(DataSpec(Uri.parse("$ORIGEN/stream/$canal/precalentar?modo=$modo")))
                    DataSourceUtil.readToEnd(fuente)
                } catch (error: IOException) {
                    // Sin adelanto.
                } finally {
                    fuente.close()
                }
            }
        }
    }
}
