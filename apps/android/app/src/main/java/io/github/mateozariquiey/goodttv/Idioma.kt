package io.github.mateozariquiey.goodttv

import java.util.Locale

// El idioma de lo poco que pinta la app. Lo elige la página (ajustes), que lo dice al abrirse y al cambiarlo; hasta
// entonces, el del sistema.
object Idioma {
    @Volatile
    var ingles = Locale.getDefault().language != "es"

    fun texto(espanol: String, english: String) = if (ingles) english else espanol
}
