package io.github.mateozariquiey.goodttv

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource.HttpDataSourceException
import androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException
import androidx.media3.datasource.TransferListener
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

// La lista se retiene hasta 20 s (recarga bloqueante) e info hasta 20 s: algo más antes de darla por perdida.
private const val ESPERA_CABECERA_MS = 30_000L
private const val ESPERA_TROZO_MS = 25_000L

// Media3 con el motor (Motor.kt) en vez de HTTP: lo que pide a /stream/ en ORIGEN (la lista, info y los trozos del VOD,
// que la lista da con URL relativas) lo contesta la página. Media3 cancela una carga interrumpiendo su hilo y cerrando
// la fuente: las dos cosas avisan a la página para que aborte. Range solo importa en los trozos del VOD sin recortar
// (la página lo reenvía a Twitch); si la respuesta trae el cuerpo entero, se salta lo de antes.
@OptIn(UnstableApi::class)
class MotorDataSource(private val motor: Motor) : BaseDataSource(/* isNetwork= */ true) {
    private var spec: DataSpec? = null
    private var peticion: Peticion? = null
    private var abierta = false
    private var terminada = false
    private var trozo: ByteArray? = null
    private var leido = 0
    private var porSaltar = 0L
    private var quedan = 0L // C.LENGTH_UNSET si no se sabe

    override fun open(dataSpec: DataSpec): Long {
        spec = dataSpec
        terminada = false
        trozo = null
        transferInitializing(dataSpec)
        val uri = dataSpec.uri
        val ruta = uri.encodedPath + (uri.encodedQuery?.let { "?$it" } ?: "")
        val hasta = if (dataSpec.length == C.LENGTH_UNSET.toLong()) "" else "${dataSpec.position + dataSpec.length - 1}"
        val rango = if (dataSpec.position == 0L && hasta.isEmpty()) null else "bytes=${dataSpec.position}-$hasta"
        val nueva = try {
            motor.pedir(ruta, rango)
        } catch (error: InterruptedException) {
            throw InterruptedIOException()
        }
        peticion = nueva
        val cabecera = esperar(nueva, ESPERA_CABECERA_MS, HttpDataSourceException.TYPE_OPEN) as? Cabecera
            ?: throw fallo(PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSourceException.TYPE_OPEN)
        if (cabecera.estado !in 200..299) {
            throw InvalidResponseCodeException(cabecera.estado, null, null, emptyMap(), dataSpec, ByteArray(0))
        }
        porSaltar = if (cabecera.estado == 200) dataSpec.position else 0
        if (cabecera.longitud >= 0 && porSaltar > cabecera.longitud) {
            throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
        }
        quedan = when {
            dataSpec.length != C.LENGTH_UNSET.toLong() -> dataSpec.length
            cabecera.longitud >= 0 -> cabecera.longitud - porSaltar
            else -> C.LENGTH_UNSET.toLong()
        }
        abierta = true
        transferStarted(dataSpec)
        return quedan
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (quedan == 0L) return C.RESULT_END_OF_INPUT
        while (true) {
            val actual = trozo
            if (actual != null && leido < actual.size) {
                if (porSaltar > 0) {
                    val saltados = minOf(porSaltar, (actual.size - leido).toLong()).toInt()
                    leido += saltados
                    porSaltar -= saltados
                    continue
                }
                var n = minOf(length, actual.size - leido)
                if (quedan != C.LENGTH_UNSET.toLong()) n = minOf(n.toLong(), quedan).toInt()
                System.arraycopy(actual, leido, buffer, offset, n)
                leido += n
                if (quedan != C.LENGTH_UNSET.toLong()) quedan -= n
                bytesTransferred(n)
                return n
            }
            if (terminada) return C.RESULT_END_OF_INPUT
            val pendiente = peticion ?: return C.RESULT_END_OF_INPUT
            when (val parte = esperar(pendiente, ESPERA_TROZO_MS, HttpDataSourceException.TYPE_READ)) {
                is Trozo -> {
                    trozo = parte.bytes
                    leido = 4
                }
                Fin -> terminada = true
                else -> throw fallo(
                    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
                    HttpDataSourceException.TYPE_READ,
                )
            }
        }
    }

    // Media3 cancela interrumpiendo el hilo que espera aquí.
    private fun esperar(peticion: Peticion, ms: Long, tipo: Int): Parte {
        val parte = try {
            peticion.partes.poll(ms, TimeUnit.MILLISECONDS)
        } catch (error: InterruptedException) {
            throw InterruptedIOException()
        }
        return parte ?: throw HttpDataSourceException(
            SocketTimeoutException(),
            spec ?: DataSpec(Uri.EMPTY),
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            tipo,
        )
    }

    // La página falló o se cayó: sin más detalle, que podría llevar una URL de Twitch.
    private fun fallo(codigo: Int, tipo: Int) =
        HttpDataSourceException("el motor falló", spec ?: DataSpec(Uri.EMPTY), codigo, tipo)

    override fun getUri(): Uri? = spec?.uri

    override fun close() {
        peticion?.let { if (!terminada) motor.cancelar(it) }
        peticion = null
        trozo = null
        spec = null
        if (abierta) {
            abierta = false
            transferEnded()
        }
    }
}

// Lo que Media3 pide: a ORIGEN, al motor; lo demás (los fragmentos en directo, con URL absolutas de Twitch), por HTTP.
@OptIn(UnstableApi::class)
class EnrutadoDataSource(motor: Motor, private val http: DataSource) : DataSource {
    private val local = MotorDataSource(motor)
    private var actual: DataSource? = null

    override fun addTransferListener(transferListener: TransferListener) {
        local.addTransferListener(transferListener)
        http.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        val fuente = if (dataSpec.uri.host == HOST) local else http
        actual = fuente
        return fuente.open(dataSpec)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        actual?.read(buffer, offset, length) ?: C.RESULT_END_OF_INPUT

    override fun getUri(): Uri? = actual?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = actual?.responseHeaders ?: emptyMap()

    override fun close() {
        try {
            actual?.close()
        } finally {
            actual = null
        }
    }
}
