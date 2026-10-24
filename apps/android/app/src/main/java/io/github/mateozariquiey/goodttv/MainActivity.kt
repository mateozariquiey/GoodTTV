package io.github.mateozariquiey.goodttv

import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.PictureInPictureUiState
import android.app.RemoteAction
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.util.Log
import android.util.Rational
import android.view.OrientationEventListener
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import android.window.OnBackInvokedDispatcher
import java.lang.ref.WeakReference
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import org.json.JSONObject

// GoodTTV: una WebView a pantalla completa con la página de web/, que la app sirve desde los assets del APK (Paginas.kt):
// Inicio, la búsqueda, el canal, los VOD y la cuenta (la sesión la guarda Sesion.kt). Solo hay una a la vez: es la dueña de la
// cuenta.
// El vídeo del canal (o del VOD) es Media3 (Reproductor.kt), debajo de la WebView: la página es transparente en el sitio que le
// reserva al vídeo y dice dónde está (videoZona), y sus controles y el chat se pintan encima. Así hay una sola página, con
// la cuenta y el chat, y girar el teléfono no recarga nada: la actividad no se recrea (configChanges), la página se
// recoloca y el vídeo la sigue. Como en la app de Twitch:
//   - al volver a Inicio, el canal sigue en una esquina, encima de la página (el minirreproductor, CajaVideo.kt);
//   - al salir de la app, en el PiP de Android;
//   - el botón de pantalla completa gira a horizontal aunque el giro automático esté bloqueado, y Atrás vuelve a vertical.
// Para medir (medir/webview.mjs): «ruta» abre otra dirección de la página, p. ej.
//   adb shell am start -n …/io.github.mateozariquiey.goodttv.MainActivity --es ruta "'/index.html?reproductor=b#/canal/x'"
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var caja: CajaVideo
    private lateinit var reproductor: Reproductor
    private val sesion by lazy { Sesion.de(this) }
    private var sitioAntesDelPip = CajaVideo.Sitio.OCULTO
    private var detenida = false // onStop: si el PiP termina así, es que se ha cerrado (no ampliado)
    // Lo que dicen ahora los ajustes del PiP (si entra solo y su botón de pausa), para no rehacerlos cada segundo.
    private var pipActivo: Boolean? = null
    private var pipPausado: Boolean? = null

    // Tras salir de la pantalla completa (vertical a la fuerza), cuando el teléfono está derecho se suelta la orientación:
    // con el giro automático activado vuelve a seguir al teléfono, y si no, se queda en vertical.
    private val enderezar by lazy {
        object : OrientationEventListener(this) {
            override fun onOrientationChanged(grados: Int) {
                if (grados == ORIENTATION_UNKNOWN || grados in 25..335) return
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                disable()
            }
        }
    }

    // La pausa del PiP (el botón de la ventana, una RemoteAction): llega como un aviso de la propia app.
    private val pausaPip = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = reproductor.pausar(!caja.pausado)
    }

    // La pantalla se apagó con la app a la vista (onStop): al encenderse, aún bloqueada, el vídeo empieza a volver
    // (Reproductor.relevar), para que al desbloquear ya esté; si se apaga sin llegar a desbloquear, otra vez solo audio.
    private var apagadaConLaApp = false
    private val pantalla = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (!apagadaConLaApp || !detenida) return
            reproductor.soloAudio(intent.action == Intent.ACTION_SCREEN_OFF)
        }
    }

    // JavaScript, porque la página es una app web; solo carga la del APK (Paginas no deja cargar otras).
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Otra a la vez (solo con un intent explícito, como los de adb: el icono trae la tarea que ya hay) tendría otra
        // página que renovaría la misma sesión de Twitch, y el token de renovación solo vale una vez. Se queda la que
        // había, con la ruta nueva si la trae.
        val otra = actual?.get()
        if (otra != null && otra !== this && !otra.isFinishing && !otra.isDestroyed) {
            if (intent.hasExtra("ruta")) otra.abrir(intent)
            finish()
            return
        }
        actual = WeakReference(this)
        // Las variantes debug y medida se pueden inspeccionar por CDP (chrome://inspect, README).
        if (BuildConfig.CDP) WebView.setWebContentsDebuggingEnabled(true)
        if (BuildConfig.MEDIDA) Bateria.empezar(this)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        // La página no lee archivos del teléfono ni de otras apps (file:// y content://).
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        // El directo empieza a sonar sin tocar la pantalla, como en la tele y la extensión.
        web.settings.mediaPlaybackRequiresUserGesture = false
        // localStorage: preferencias, recientes e Inicio de la última vez (api.ts). Queda en los datos de la app.
        web.settings.domStorageEnabled = true
        // Transparente, para que se vea el vídeo de debajo; el fondo lo pone el marco (sin destello blanco al cargar).
        web.setBackgroundColor(Color.TRANSPARENT)
        // Si el proceso de la página muere, la WebView ya no sirve: se crea otra con la actividad.
        // En el PiP no: la actividad nueva empezaría ya en el PiP, con la página a la vista y sin el canal, que se ha
        // caído con ella (el motor comparte su proceso). Se cierra la ventana.
        web.webViewClient = Paginas(assets, RedNativa(), alCaer = { if (isInPictureInPictureMode) finish() else recreate() }) { url ->
            // Twitch (twitch.tv/activate al vincular la cuenta) en una Custom Tab: el navegador del teléfono, con su
            // sesión de Twitch, encima de la app; al cerrarla se vuelve aquí. Sin navegador no se abre, y queda copiar
            // el código.
            // Con el paquete del navegador fijado: si no, Android le da el enlace a la app de Twitch, que reclama los de
            // twitch.tv y no siempre enseña la activación.
            try {
                val pestana = CustomTabsIntent.Builder().build()
                CustomTabsClient.getPackageName(this, null)?.let { pestana.intent.setPackage(it) }
                pestana.launchUrl(this, url)
            } catch (error: ActivityNotFoundException) {
                Log.w("GoodTTVPagina", "sin navegador para abrir ${url.host}")
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i("GoodTTVPagina", "${message.messageLevel()} ${message.message().take(300)}")
                return true
            }
        }
        web.addJavascriptInterface(Puente(), "GoodTTVAndroid")
        // Oculto hasta que se abre un canal o un VOD. Desde el minirreproductor: volver a él lo hace la página (es su ruta).
        caja = CajaVideo(
            this,
            alAmpliar = {
                val ampliar = JSONObject().put("accion", "ampliar")
                reproductor.canal?.let { avisarPagina("goodttv-mini", ampliar.put("canal", it)) }
                    ?: reproductor.vodAbierto?.let { avisarPagina("goodttv-mini", ampliar.put("vod", it)) }
            },
            alCerrar = {
                cerrarCanal()
                avisarPagina("goodttv-mini", JSONObject().put("accion", "cerrar"))
            },
            alPausar = { reproductor.pausar(it) },
            alMover = { caja.post { pip() } }, // tras colocarse
        )
        // Al registro, solo los relevos entre solo audio y vídeo (pocos, sin datos de la sesión): para ver en el teléfono
        // cómo fue cada uno.
        val registrar = { datos: JSONObject -> if (datos.has("relevo")) Log.i("GoodTTVMedia3", datos.toString()) }
        reproductor = Reproductor(this, caja.vista, registrar = registrar, alCambiar = { estado ->
            caja.pausado = estado.optBoolean("pausado")
            if (pipPausado != caja.pausado || pipActivo != pipConCanal()) pip()
            avisarPagina("goodttv-reproductor", estado)
        })
        registerReceiver(pausaPip, IntentFilter(PAUSA_PIP), RECEIVER_NOT_EXPORTED)
        val encenderYApagar = IntentFilter(Intent.ACTION_SCREEN_ON).apply { addAction(Intent.ACTION_SCREEN_OFF) }
        registerReceiver(pantalla, encenderYApagar, RECEIVER_NOT_EXPORTED)
        // Con targetSdk 35 o más, la app dibuja bajo las barras del sistema y la cámara: el marco deja la página (y el
        // vídeo) entre ellas, y encima del teclado.
        val marco = FrameLayout(this)
        marco.setBackgroundColor(getColor(R.color.fondo))
        marco.setOnApplyWindowInsetsListener { vista, insets ->
            val borde = insets.getInsets(
                WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime(),
            )
            vista.setPadding(borde.left, borde.top, borde.right, borde.bottom)
            WindowInsets.CONSUMED
        }
        marco.addView(caja, FrameLayout.LayoutParams(0, 0))
        marco.addView(web)
        // Al girar, con el teclado o al salir del PiP, el minirreproductor vuelve a caber en su esquina. Se mira la WebView,
        // que ocupa el sitio libre del marco: el teclado cambia el margen del marco, no su tamaño.
        web.addOnLayoutChangeListener { _, l, t, r, b, ol, ot, or, ob ->
            if (r - l != or - ol || b - t != ob - ot) caja.recolocar()
        }
        setContentView(marco)
        // Atrás: con el canal en horizontal, a vertical; si no, lo resuelve la página (goodttvAtras, de un canal a Inicio,
        // con el canal en la esquina) y, si ya está en Inicio, primero cierra el minirreproductor y después sale. No con
        // web.canGoBack(): Chromium se salta las entradas que la página añade sin un toque suyo (volver al canal desde el
        // minirreproductor), y saldría de la app. Con targetSdk 36 llega siempre por OnBackInvokedCallback y no como
        // tecla: la página nunca la ve.
        onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) {
            // En horizontal, primero lo que la página tenga abierto encima (una hoja), y si no, a vertical.
            if (caja.sitio == CajaVideo.Sitio.PAGINA && horizontal()) {
                return@registerOnBackInvokedCallback web.evaluateJavascript("globalThis.goodttvCerrar?.() === true") {
                    if (it != "true") pantallaCompleta(false)
                }
            }
            web.evaluateJavascript("globalThis.goodttvAtras?.() === true") { vuelto ->
                when {
                    vuelto == "true" -> Unit
                    caja.sitio == CajaVideo.Sitio.MINI -> {
                        cerrarCanal()
                        avisarPagina("goodttv-mini", JSONObject().put("accion", "cerrar"))
                    }
                    else -> finish()
                }
            }
        }
        abrir(intent)
    }

    // Con la actividad ya abierta, una «ruta» nueva la carga; sin ella (volver desde el lanzador), la página sigue igual.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasExtra("ruta")) abrir(intent)
    }

    // La página nueva empieza sin canal: el de la anterior se cierra (si no, seguiría sonando debajo).
    private fun abrir(intent: Intent) {
        val ruta = intent.getStringExtra("ruta")?.takeIf { it.startsWith("/") } ?: "/index.html"
        cerrarCanal()
        web.loadUrl(ORIGEN + ruta)
    }

    private fun cerrarCanal() {
        reproductor.soltar()
        caja.ocultar()
        soltarOrientacion()
        barras()
        pip()
    }

    // Fuera del canal, la orientación vuelve a ser la del teléfono.
    private fun soltarOrientacion() {
        enderezar.disable()
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    // El botón de pantalla completa: a horizontal (por el sensor, hacia el lado en que se tenga) o a vertical. Fijar
    // vertical es a propósito y dura poco: se suelta en cuanto el teléfono está derecho (enderezar).
    @SuppressLint("SourceLockedOrientationActivity")
    private fun pantallaCompleta(activa: Boolean) {
        enderezar.disable()
        if (activa) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            enderezar.enable()
        }
    }

    private fun horizontal() = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

    private fun avisarPagina(evento: String, datos: JSONObject) =
        web.evaluateJavascript("dispatchEvent(new CustomEvent('$evento',{detail:$datos}))", null)

    // El PiP de Android: al salir de la app con un canal abierto (en la página o en la esquina), entra solo, con el
    // botón de pausa. Se rehace al abrir o cerrar un canal y al pausar.
    private fun pipConCanal() =
        (caja.sitio == CajaVideo.Sitio.PAGINA || caja.sitio == CajaVideo.Sitio.MINI) && reproductor.enMarcha

    private fun pip() {
        pipPausado = caja.pausado
        pipActivo = pipConCanal()
        val nombre = if (caja.pausado) "Reproducir" else "Pausa"
        val pausa = RemoteAction(
            Icon.createWithResource(this, if (caja.pausado) R.drawable.mini_reproducir else R.drawable.mini_pausa),
            nombre,
            nombre,
            PendingIntent.getBroadcast(this, 0, Intent(PAUSA_PIP).setPackage(packageName), PendingIntent.FLAG_IMMUTABLE),
        )
        // El PiP sale de donde está el vídeo (en la página o en la esquina).
        val origen = Rect().takeIf { caja.sitio != CajaVideo.Sitio.PIP && caja.getGlobalVisibleRect(it) }
        setPictureInPictureParams(
            PictureInPictureParams.Builder()
                .setAspectRatio(Rational(16, 9))
                .setSourceRectHint(origen)
                .setAutoEnterEnabled(pipActivo == true)
                .setSeamlessResizeEnabled(true)
                .setActions(listOf(pausa))
                .build(),
        )
    }

    // Con Android 15 o más, la página y los controles de la esquina se ocultan en cuanto empieza a entrar en el PiP (si
    // no, se verían durante la animación); si al final no entra, vuelven.
    override fun onPictureInPictureUiStateChanged(estado: PictureInPictureUiState) {
        super.onPictureInPictureUiStateChanged(estado)
        if (Build.VERSION.SDK_INT < 35 || isInPictureInPictureMode) return
        if (estado.isTransitioningToPip) {
            web.visibility = View.INVISIBLE
            caja.quitarCapa()
        } else {
            web.visibility = View.VISIBLE
        }
    }

    // En el PiP solo se ve el vídeo. Al salir, vuelve a donde estaba; si se ha cerrado la ventana (la actividad ya
    // está detenida), se cierra el canal, como en la app de Twitch.
    override fun onPictureInPictureModeChanged(enPip: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(enPip, newConfig)
        if (enPip) {
            sitioAntesDelPip = caja.sitio
            web.visibility = View.INVISIBLE
            caja.enPip()
            return
        }
        web.visibility = View.VISIBLE
        when {
            detenida -> {
                cerrarCanal()
                avisarPagina("goodttv-mini", JSONObject().put("accion", "cerrar"))
            }
            sitioAntesDelPip == CajaVideo.Sitio.MINI -> caja.enMini()
            else -> caja.enPagina()
        }
    }

    override fun onStart() {
        super.onStart()
        detenida = false
        apagadaConLaApp = false
        // Otra vez a la vista: con vídeo (Reproductor.soloAudio).
        if (::reproductor.isInitialized) reproductor.soloAudio(false)
    }

    // Si algo se abrió con la app fuera de la vista, Android no dejó arrancar el servicio en primer plano: ahora sí.
    override fun onResume() {
        super.onResume()
        if (::reproductor.isInitialized) reproductor.asegurarServicio()
    }

    // Sin verse (la pantalla apagada, otra app delante sin PiP): el directo, en solo audio. En el PiP se sigue viendo,
    // salvo con la pantalla apagada.
    override fun onStop() {
        detenida = true
        val pantallaEncendida = getSystemService(PowerManager::class.java)?.isInteractive != false
        apagadaConLaApp = !pantallaEncendida
        if (::reproductor.isInitialized && (!isInPictureInPictureMode || !pantallaEncendida)) {
            reproductor.soloAudio(true)
        }
        super.onStop()
    }

    // En horizontal, con un canal abierto, el vídeo ocupa también el sitio de las barras del sistema; salen al deslizar
    // desde el borde.
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        barras()
    }

    private fun barras() {
        val controlador = window.insetsController ?: return
        if (horizontal() && caja.sitio == CajaVideo.Sitio.PAGINA) {
            controlador.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controlador.hide(WindowInsets.Type.systemBars())
        } else {
            controlador.show(WindowInsets.Type.systemBars())
        }
    }

    override fun onDestroy() {
        if (actual?.get() === this) actual = null
        if (::reproductor.isInitialized) {
            reproductor.soltar()
            unregisterReceiver(pausaPip)
            unregisterReceiver(pantalla)
            enderezar.disable()
        }
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    // Lo que la página puede pedir a la app (window.GoodTTVAndroid). Llega en un hilo de la WebView.
    inner class Puente {
        // Que la pantalla no se apague mientras se ve un directo (window.api.player.setWatching).
        @JavascriptInterface
        fun mantenerPantalla(activa: Boolean) = runOnUiThread {
            if (activa) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        // La sesión de Twitch, cifrada (Sesion.kt). Solo la página de la app llega aquí (Paginas no carga otras).
        @JavascriptInterface
        fun sesionLeer(): String? = sesion.leer()

        @JavascriptInterface
        fun sesionGuardar(texto: String) = sesion.guardar(texto)

        @JavascriptInterface
        fun sesionBorrar() = sesion.borrar()

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        // El código para vincular la cuenta, por si se escribe a mano en twitch.tv/activate.
        @JavascriptInterface
        fun copiar(texto: String) = runOnUiThread {
            getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("GoodTTV", texto))
        }

        // El canal con Media3, debajo de la página, que recibe su estado en el evento «goodttv-reproductor». Sigue
        // sonando con la app en segundo plano o la pantalla apagada (FondoService.kt). Si es el que sigue en la esquina,
        // no se vuelve a abrir: solo vuelve a la página.
        @JavascriptInterface
        fun canalAbrir(canal: String, modo: String) = runOnUiThread {
            if (!CANAL.matches(canal) || modo !in MODOS) return@runOnUiThread
            if (reproductor.tiene(canal, modo)) {
                reproductor.avisar()
            } else {
                reproductor.abrir(canal, modo, Motor.obtener(this@MainActivity, "/motor.html"), fondo = true)
            }
            caja.enPagina()
            barras()
            pip()
        }

        // La página deja el canal (vuelve a Inicio o a la búsqueda): sigue en la esquina si hay algo que ver.
        @JavascriptInterface
        fun canalMinimizar() = runOnUiThread {
            if (!reproductor.enMarcha) return@runOnUiThread cerrarCanal()
            caja.enMini()
            soltarOrientacion()
            barras()
            pip()
        }

        // El botón de pantalla completa del canal (y su flecha, en horizontal).
        @JavascriptInterface
        fun canalPantallaCompleta(activa: Boolean) = runOnUiThread {
            if (caja.sitio == CajaVideo.Sitio.PAGINA) pantallaCompleta(activa)
        }

        // Volver a abrir el canal tras un fallo.
        @JavascriptInterface
        fun canalReintentar() = runOnUiThread { reproductor.reabrir() }

        // La pausa, la esquina y la pantalla completa valen también para un VOD.
        @JavascriptInterface
        fun canalPausar(pausa: Boolean) = runOnUiThread { reproductor.pausar(pausa) }

        // Retroceder o avanzar el directo dentro de la lista del empalme (DVR-1), y «Ir al directo».
        @JavascriptInterface
        fun canalSaltar(segundos: Double) = runOnUiThread { if (segundos.isFinite()) reproductor.saltar(segundos) }

        @JavascriptInterface
        fun canalAlDirecto() = runOnUiThread { reproductor.alDirecto() }

        // Precalentar el empalme de un canal (mientras se retrocede, para volver rápido al directo).
        @JavascriptInterface
        fun canalPrecalentar(canal: String, modo: String) {
            if (!CANAL.matches(canal) || modo !in MODOS) return
            runOnUiThread { Reproductor.precalentar(Motor.obtener(this@MainActivity, "/motor.html"), canal, modo) }
        }

        // Un VOD (VOD-1), como un canal: debajo de la página, con su estado en «goodttv-reproductor» (con «vod»), y en la
        // esquina o en el PiP al dejarlo. Antes de pedir su lista, la página pregunta si ya está abierto (al volver a él
        // desde la esquina): si lo está, vuelve a la página; si no, se para lo que hubiera, para no verlo mientras llega
        // el VOD. Sin cerrar el canal del todo: al retroceder a pantalla completa, seguía en vertical, y el servicio y
        // los mandos del sistema se iban y volvían. Llega en el hilo de la WebView: vodAbierto se puede leer desde aquí.
        @JavascriptInterface
        fun vodPreparar(id: String): Boolean {
            val abierto = reproductor.vodAbierto == id
            runOnUiThread {
                if (!abierto) {
                    // Las barras del sistema, como estaban: vodAbrir las pone según quede el VOD.
                    reproductor.parar()
                    caja.ocultar()
                    pip()
                    return@runOnUiThread
                }
                caja.enPagina()
                reproductor.avisar()
                barras()
                pip()
            }
            return abierto
        }

        // «lista»: la maestra de usher (window.api.vods.playback), con su token; «desde», en segundos.
        @JavascriptInterface
        fun vodAbrir(id: String, lista: String, desde: Double) = runOnUiThread {
            if (!VOD.matches(id) || !lista.startsWith(USHER_VOD) || !desde.isFinite() || desde < 0) return@runOnUiThread
            reproductor.abrirVod(id, lista, (desde * 1000).toLong(), fondo = true)
            caja.enPagina()
            barras()
            pip()
        }

        @JavascriptInterface
        fun vodIrA(segundos: Double) = runOnUiThread { if (segundos.isFinite()) reproductor.irA(segundos) }

        @JavascriptInterface
        fun vodVelocidad(valor: Double) = runOnUiThread { if (valor.isFinite()) reproductor.velocidad(valor.toFloat()) }

        // La calidad como la da el estado (1080p60); vacía, la automática.
        @JavascriptInterface
        fun vodCalidad(nombre: String) = runOnUiThread { reproductor.calidad(nombre.ifEmpty { null }) }

        // Para los mandos del sistema (la notificación y la pantalla de bloqueo): qué se ve. «clave», su ruta en la página
        // (canal/<canal> o vod/<id>); la foto, solo de https.
        @JavascriptInterface
        fun reproductorDatos(clave: String, titulo: String, texto: String, foto: String) = runOnUiThread {
            if (!CLAVE.matches(clave)) return@runOnUiThread
            val imagen = Uri.parse(foto).takeIf { it.scheme == "https" }
            reproductor.datos(clave, titulo.take(200), texto.take(200), imagen)
        }

        // Dónde va el vídeo, en píxeles de la pantalla desde la esquina de la página.
        @JavascriptInterface
        fun videoZona(x: Int, y: Int, ancho: Int, alto: Int) = runOnUiThread {
            caja.zonaPedida(Rect(x, y, x + maxOf(0, ancho), y + maxOf(0, alto)))
        }

        // Dónde está la barra del tiempo (igual que videoZona), para que arrastrarla desde un borde no sea el gesto de
        // Atrás de Android: su franja, de lado a lado (la bola, al principio o al final, asoma fuera de la barra). Vacía,
        // ninguna.
        @JavascriptInterface
        fun barraZona(x: Int, y: Int, ancho: Int, alto: Int) = runOnUiThread {
            web.systemGestureExclusionRects =
                if (ancho <= 0 || alto <= 0) emptyList() else listOf(Rect(0, y, web.width, y + alto))
        }
    }

    private companion object {
        // La MainActivity que hay, si hay.
        var actual: WeakReference<MainActivity>? = null

        // La acción del botón de pausa del PiP.
        const val PAUSA_PIP = "io.github.mateozariquiey.goodttv.PAUSA_PIP"
    }
}

// Un nombre de canal de Twitch.
val CANAL = Regex("[a-z0-9_]{1,25}")

// Un VOD de Twitch, y dónde está su lista maestra.
private val VOD = Regex("\\d{1,20}")
private const val USHER_VOD = "https://usher.ttvnw.net/vod/"

// Lo que se ve, como su ruta en la página: canal/<canal> o vod/<id>.
private val CLAVE = Regex("canal/${CANAL.pattern}|vod/${VOD.pattern}")

