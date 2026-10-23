package io.github.mateozariquiey.goodttv

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// La sesión de Twitch (los tokens, en el JSON que da @goodttv/servicios), cifrada con AES-GCM y una clave del Keystore
// de Android: la clave no sale del teléfono, así que el archivo no sirve copiado a otro sitio. Va en noBackupFilesDir,
// que no entra en las copias de seguridad. La página la lee y la guarda por el puente de MainActivity (api.ts). Una sola
// por proceso (Sesion.de), para que sus cerrojos valgan para cualquier actividad.
class Sesion private constructor(contexto: Context) {
    private val archivo = File(contexto.noBackupFilesDir, "sesion-twitch")

    // El texto guardado, o null si no hay sesión o no se puede leer ni descifrar (un archivo a medias, o la clave se
    // borró): entonces es como no haber iniciado sesión.
    @Synchronized
    fun leer(): String? {
        if (!archivo.isFile) return null
        return try {
            val datos = archivo.readBytes()
            val cifrador = Cipher.getInstance(TRANSFORMACION)
            cifrador.init(Cipher.DECRYPT_MODE, clave(), GCMParameterSpec(128, datos, 0, IV))
            String(cifrador.doFinal(datos, IV, datos.size - IV), Charsets.UTF_8)
        } catch (error: Exception) {
            Log.w("GoodTTVSesion", "no se pudo leer la sesión: ${error.javaClass.simpleName}")
            null
        }
    }

    // Se escribe en otro archivo y se cambia de nombre: si la app muere a medias, queda la sesión anterior entera.
    @Synchronized
    fun guardar(texto: String) {
        val cifrador = Cipher.getInstance(TRANSFORMACION)
        cifrador.init(Cipher.ENCRYPT_MODE, clave())
        val temporal = File(archivo.parentFile, "${archivo.name}.nuevo")
        temporal.writeBytes(cifrador.iv + cifrador.doFinal(texto.toByteArray(Charsets.UTF_8)))
        if (!temporal.renameTo(archivo)) throw IllegalStateException("no se pudo guardar la sesión")
    }

    @Synchronized
    fun borrar() {
        archivo.delete()
    }

    private fun clave(): SecretKey {
        val almacen = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (almacen.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generador.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generador.generateKey()
    }

    companion object {
        @Volatile
        private var unica: Sesion? = null

        fun de(contexto: Context): Sesion =
            unica ?: synchronized(this) { unica ?: Sesion(contexto.applicationContext).also { unica = it } }

        private const val ALIAS = "sesion-twitch"
        private const val TRANSFORMACION = "AES/GCM/NoPadding"
        private const val IV = 12 // bytes del vector de inicio de GCM, delante del texto cifrado
    }
}
