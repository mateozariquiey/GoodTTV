package io.github.mateozariquiey.goodttv

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

// Lo que llega de la página para una petición, en orden: la cabecera, el cuerpo a trozos y el final (o un fallo).
sealed interface Parte
class Cabecera(val estado: Int, val longitud: Long) : Parte // longitud: -1 si no se sabe
class Trozo(val bytes: ByteArray) : Parte // los 4 primeros bytes son el número de la petición
object Fin : Parte
class Fallo(val tipo: String) : Parte

class Peticion(val id: Int) {
    val partes = LinkedBlockingQueue<Parte>()
}

// El directo sin anuncios dentro del teléfono para Media3 (ReproductorActivity.kt): @goodttv/sin-anuncios corre en una
// WebView sin mostrar (web/motor.ts) y la app le pasa las peticiones de Media3 a /stream/ por mensajes
// (addWebMessageListener de androidx.webkit). Cada petición lleva un número; la página contesta con la cabecera en
// texto, el cuerpo a trozos en ArrayBuffer (con el número delante) y el final, y cancelar aborta su AbortSignal. La red
// de Twitch de la página, como en MainActivity: /red, en nativo (Paginas.kt, RedNativa.kt).
// Uno por proceso y reutilizado entre actividades, como la página de la extensión al cambiar de canal: la WebView ya
// está cargada y el empalme del canal anterior se para solo al pedir otro. Una WebView que nunca se añade a una ventana
// cuenta como visible: sus temporizadores no se frenan, tampoco con la app en segundo plano (informe §6). Lleva
// JavaScript porque es una página, pero solo carga la del APK (Paginas). Lint no ve que los mensajes con la página
// (WEB_MESSAGE_LISTENER) se comprueban al crearlo.
@SuppressLint("SetJavaScriptEnabled", "RequiresFeature")
class Motor private constructor(app: Context, private val ruta: String) {
    val web = WebView(app)
    private val principal = Handler(Looper.getMainLooper())
    private val siguiente = AtomicInteger()
    private val enCurso = ConcurrentHashMap<Int, Peticion>()
    private val listo = CountDownLatch(1)
    private var pagina: JavaScriptReplyProxy? = null // solo en el hilo principal
    @Volatile private var caido = false

    // Lo que la página envía para el registro (eventos del empalme, estado del motor); en el hilo principal.
    var alRegistrar: (JSONObject) -> Unit = {}

    init {
        // Sin ArrayBuffer, los trozos del VOD (varios MB) irían en Base64 dentro de un texto: no se admite.
        check(
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
                WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER),
        ) { "La WebView no admite mensajes con ArrayBuffer" }
        web.settings.javaScriptEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        // Sin mostrar, su proceso no debe perder prioridad: el empalme tiene que seguir sondeando a Twitch.
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        WebViewCompat.addWebMessageListener(web, "GoodTTVMotor", setOf(ORIGEN)) { _, mensaje, _, _, respuesta ->
            recibir(mensaje, respuesta)
        }
        web.webViewClient = Paginas(app.assets, RedNativa(), alCaer = {
            Log.w("GoodTTVEmpalme", "el proceso del motor se cayó")
            cerrar()
        })
        web.loadUrl(ORIGEN + ruta)
    }

    // Desde cualquier hilo (los de carga de Media3): envía la petición en cuanto la página está lista.
    fun pedir(rutaPedida: String, rango: String?): Peticion {
        if (!listo.await(15, TimeUnit.SECONDS)) throw IOException("el motor no arrancó")
        if (caido) throw IOException("el motor se cayó")
        val peticion = Peticion(siguiente.incrementAndGet())
        enCurso[peticion.id] = peticion
        val texto = JSONObject().put("id", peticion.id).put("ruta", rutaPedida).put("rango", rango ?: JSONObject.NULL)
            .toString()
        // JavaScriptReplyProxy solo se usa en el hilo principal.
        principal.post {
            val destino = pagina
            when {
                !enCurso.containsKey(peticion.id) -> Unit // cancelada antes de salir: no debe llegar al motor
                caido || destino == null -> peticion.partes.add(Fallo("caido"))
                else -> destino.postMessage(texto)
            }
        }
        return peticion
    }

    // Media3 ya no espera la respuesta: la página aborta la petición (si no había terminado).
    fun cancelar(peticion: Peticion) {
        if (enCurso.remove(peticion.id) == null) return
        val texto = JSONObject().put("id", peticion.id).put("cancelar", true).toString()
        principal.post { if (!caido) pagina?.postMessage(texto) }
    }

    private fun recibir(mensaje: WebMessageCompat, respuesta: JavaScriptReplyProxy) {
        if (mensaje.type == WebMessageCompat.TYPE_ARRAY_BUFFER) {
            val bytes = mensaje.arrayBuffer
            enCurso[ByteBuffer.wrap(bytes).int]?.partes?.add(Trozo(bytes))
            return
        }
        val datos = JSONObject(mensaje.data ?: return)
        if (!datos.has("id")) {
            if (datos.has("listo")) {
                pagina = respuesta
                listo.countDown()
            }
            alRegistrar(datos)
            return
        }
        val id = datos.getInt("id")
        val peticion = enCurso[id] ?: return // cancelada
        if (datos.has("estado")) {
            peticion.partes.add(Cabecera(datos.getInt("estado"), datos.optLong("longitud", -1)))
            return
        }
        enCurso.remove(id)
        peticion.partes.add(if (datos.has("fin")) Fin else Fallo(datos.optString("fallo")))
    }

    // Si el proceso de la página muere (o se sustituye el motor), lo pendiente falla en vez de esperar hasta el límite.
    private fun cerrar() {
        caido = true
        if (actual === this) actual = null
        for (peticion in enCurso.values) peticion.partes.add(Fallo("caido"))
        enCurso.clear()
        web.destroy()
    }

    companion object {
        // El único motor del proceso, a propósito: su WebView usa el contexto de la aplicación, no el de una actividad.
        @SuppressLint("StaticFieldLeak")
        private var actual: Motor? = null

        // En el hilo principal. Con otra ruta (otras opciones de prueba: ?pausa=, ?registro) se crea otro.
        fun obtener(context: Context, ruta: String): Motor {
            actual?.let { if (it.ruta == ruta) return it else it.cerrar() }
            return Motor(context.applicationContext, ruta).also { actual = it }
        }
    }
}
