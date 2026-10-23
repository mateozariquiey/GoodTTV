package io.github.mateozariquiey.goodttv

import android.content.res.AssetManager
import android.net.Uri
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.io.IOException

// Las páginas viven en este origen: https y un host reservado para contenido de la app (el de WebViewAssetLoader), así
// que son un contexto seguro y nunca salen a la red.
const val HOST = "appassets.androidplatform.net"
const val ORIGEN = "https://$HOST"

// Si una dirección es de la app: https, su host y el puerto de siempre. Mirar solo el host dejaría pasar, por ejemplo,
// content://appassets.androidplatform.net/…, que no sale del APK.
fun deLaApp(url: Uri): Boolean = url.scheme == "https" && url.host == HOST && (url.port == -1 || url.port == 443)

// Lo que sirve la app a sus dos WebView (la visible, MainActivity, y la del motor, Motor.kt): los archivos de la página,
// de los assets del APK, y en /red, las peticiones a Twitch que la página no puede hacer desde su origen (RedNativa.kt).
// Lo demás que pida la página (los fragmentos en directo de *.hls.ttvnw.net) va por la red de la WebView, pero ninguna
// página ajena llega a cargarse en ella: un enlace a Twitch se lo da a abrirFuera (una Custom Tab, en MainActivity), y
// cualquier otro no hace nada. Si el proceso de la página muere, alCaer decide qué hacer.
class Paginas(
    private val assets: AssetManager,
    private val red: RedNativa,
    private val alCaer: () -> Unit = {},
    private val abrirFuera: (Uri) -> Unit = {},
) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (deLaApp(url)) {
            if (url.path == "/red") return red.atender(request)
            return archivo(url.path?.trimStart('/').orEmpty().ifEmpty { "index.html" })
        }
        // Una navegación con POST (un formulario) no pasa por shouldOverrideUrlLoading: se para aquí.
        if (request.isForMainFrame) return vacia(403, "Forbidden")
        return null
    }

    // Navegar fuera de la página (un enlace) no se hace dentro de la WebView.
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url
        if (deLaApp(url)) return false
        if (deTwitch(url)) abrirFuera(url)
        return true
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        Log.w("GoodTTVPagina", "el proceso de la página se cayó (${if (detail.didCrash()) "fallo" else "memoria"})")
        alCaer()
        return true
    }

    private fun archivo(nombre: String): WebResourceResponse = try {
        WebResourceResponse(tipo(nombre), null, assets.open(nombre))
    } catch (error: IOException) {
        vacia(404, "Not Found")
    }

    private fun tipo(nombre: String): String = when (nombre.substringAfterLast('.')) {
        "html" -> "text/html"
        "js" -> "text/javascript"
        "css" -> "text/css"
        "woff2" -> "font/woff2"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        else -> "application/octet-stream"
    }
}

// https://twitch.tv o un subdominio (www.twitch.tv/activate, al vincular la cuenta).
fun deTwitch(url: Uri): Boolean =
    url.scheme == "https" && (url.host == "twitch.tv" || url.host?.endsWith(".twitch.tv") == true)

fun vacia(estado: Int, motivo: String) =
    WebResourceResponse("text/plain", "utf-8", estado, motivo, emptyMap(), ByteArrayInputStream(ByteArray(0)))
