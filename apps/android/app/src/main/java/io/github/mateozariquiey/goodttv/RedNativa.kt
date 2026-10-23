package io.github.mateozariquiey.goodttv

import android.os.SystemClock
import android.util.Base64
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

// Solo Twitch y sus CDN: la página no puede usar esto como un proxy abierto.
private val PERMITIDOS = listOf("twitch.tv", "ttvnw.net", "live-video.net", "cloudfront.net")

// Cabeceras de la petición original que no se reenvían: Origin y Referer son justo lo que Twitch no debe ver (la
// lista de variante da 403 con un Origin ajeno), y las demás las pone la conexión.
private val NO_REENVIAR = setOf("origin", "referer", "host", "content-length", "accept-encoding", "x-goodttv-peticion")

// Lo que la página pide a /red (web/red-nativa.ts): la petición original a Twitch, en JSON y en Base64, en la cabecera
// x-goodttv-peticion (shouldInterceptRequest no da el cuerpo de las peticiones). La app la hace sin Origin, como el
// fondo de la extensión, y devuelve la respuesta tal cual, leída a medida que llega. Corre en los hilos de Chromium,
// varias a la vez.
class RedNativa {
    private val enCurso = AtomicInteger()

    fun atender(request: WebResourceRequest): WebResourceResponse {
        val cabecera = request.requestHeaders.entries
            .firstOrNull { it.key.equals("x-goodttv-peticion", ignoreCase = true) }?.value
            ?: return vacia(400, "Bad Request")
        val peticion = JSONObject(String(Base64.decode(cabecera, Base64.DEFAULT), Charsets.UTF_8))
        val url = URL(peticion.getString("url"))
        if (url.protocol != "https" || PERMITIDOS.none { url.host == it || url.host.endsWith(".$it") }) {
            return vacia(403, "Forbidden")
        }
        val inicio = SystemClock.elapsedRealtime()
        val simultaneas = enCurso.incrementAndGet()
        try {
            val conexion = url.openConnection() as HttpURLConnection
            conexion.instanceFollowRedirects = false // como redirect: "error" en @goodttv/sin-anuncios
            conexion.connectTimeout = 10_000
            conexion.readTimeout = 25_000
            conexion.requestMethod = peticion.getString("method")
            val cabeceras = peticion.getJSONObject("headers")
            for (nombre in cabeceras.keys()) {
                if (nombre.lowercase() !in NO_REENVIAR) conexion.setRequestProperty(nombre, cabeceras.getString(nombre))
            }
            if (!peticion.isNull("body")) {
                conexion.doOutput = true
                conexion.outputStream.use { it.write(peticion.getString("body").toByteArray()) }
            }
            val estado = conexion.responseCode
            // Nunca la URL entera: la de usher y la de las listas llevan el token y la firma.
            Log.i(
                "GoodTTVRed",
                "${url.host} ${url.path.split('/').take(3).joinToString("/")} $estado " +
                    "${SystemClock.elapsedRealtime() - inicio}ms simultaneas=$simultaneas hilo=${Thread.currentThread().name}",
            )
            if (estado in 300..399) return vacia(502, "Bad Gateway") // una redirección es un error para quien pide
            val cuerpo: InputStream = (if (estado >= 400) conexion.errorStream else conexion.inputStream)
                ?: ByteArrayInputStream(ByteArray(0))
            val salida = conexion.headerFields
                .filterKeys { it != null && it.lowercase() !in setOf("content-encoding", "transfer-encoding", "connection") }
                .mapValues { it.value.joinToString(", ") }
            val tipo = conexion.contentType ?: "application/octet-stream"
            return WebResourceResponse(
                tipo.substringBefore(';').trim(),
                Regex("charset=([^;]+)").find(tipo)?.groupValues?.get(1),
                estado,
                conexion.responseMessage?.ifBlank { null } ?: "OK",
                salida,
                cuerpo,
            )
        } catch (error: IOException) {
            Log.w("GoodTTVRed", "${url.host} falló: ${error.javaClass.simpleName}")
            return vacia(502, "Bad Gateway")
        } finally {
            enCurso.decrementAndGet()
        }
    }
}
