package io.github.mateozariquiey.goodttv

import android.app.Activity
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.WindowManager
import androidx.media3.ui.PlayerView

private val CALIDAD = Regex("\\d{3,4}x\\d{3,4}@\\d{2,3}")
private val PAUSA = Regex("\\d+(\\.\\d+)?(,\\d+(\\.\\d+)?){1,2}")

// Media3 a pantalla completa, solo para medir (medir/media3.mjs): en la app, el canal se ve en MainActivity, con el vídeo
// debajo de la página. El reproductor es el mismo (Reproductor.kt). Escribe una muestra por segundo en logcat
// (GoodTTVMedia3) y, con «registro», los eventos del empalme (GoodTTVEmpalme).
//   adb shell am start -n …/io.github.mateozariquiey.goodttv.ReproductorActivity --es canal x [--es modo adaptativo]
//     [--es calidad 1280x720@60] [--es pausa cada,duración[,arranque]] [--ez registro true] [--ez fondo true]
//     [--es medida x]   (se repite en cada línea, para que la medida no lea las de la actividad anterior)
// Sin «canal» solo prepara el motor (para medir sin contar lo que tarda en cargar la WebView). Con «fondo», sigue en
// segundo plano o con la pantalla apagada (FondoService.kt). El arranque se cuenta desde que se crea la actividad.
class ReproductorActivity : Activity() {
    private val inicio = SystemClock.elapsedRealtime()
    private var reproductor: Reproductor? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.MEDIDA) Bateria.empezar(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val vista = PlayerView(this)
        setContentView(vista)
        val opciones = listOfNotNull(
            "registro".takeIf { intent.getBooleanExtra("registro", false) },
            intent.getStringExtra("pausa")?.takeIf { PAUSA.matches(it) }?.let { "pausa=$it" },
        )
        val motor = Motor.obtener(this, "/motor.html" + if (opciones.isEmpty()) "" else "?" + opciones.joinToString("&"))
        motor.alRegistrar = { datos -> Log.i("GoodTTVEmpalme", datos.put("t", segundos()).toString()) }
        val canal = intent.getStringExtra("canal")?.takeIf { CANAL.matches(it) } ?: return
        val medida = intent.getStringExtra("medida")
        val nuevo = Reproductor(this, vista, recuperar = false, registrar = { datos ->
            medida?.let { datos.put("medida", it) }
            Log.i("GoodTTVMedia3", datos.toString())
        })
        reproductor = nuevo
        nuevo.abrir(
            canal,
            intent.getStringExtra("modo")?.takeIf { it in MODOS } ?: "adaptativo",
            motor,
            calidad = intent.getStringExtra("calidad")?.takeIf { CALIDAD.matches(it) },
            fondo = intent.getBooleanExtra("fondo", false),
            inicio = inicio,
        )
    }

    private fun segundos() = (SystemClock.elapsedRealtime() - inicio) / 1000.0

    // Al abrir otro canal (otra ReproductorActivity, con --activity-clear-task), esta sigue viva hasta que la nueva está
    // delante, a veces varios segundos. Si su reproductor sigue pidiendo la lista de su canal, el motor (un canal cada
    // vez) para el empalme del nuevo y los dos se lo van quitando. onPause llega antes de que se cree la nueva: si esta
    // ya se está cerrando, se suelta ahí. Con la app al fondo no se cierra, y sigue reproduciendo.
    override fun onPause() {
        super.onPause()
        if (isFinishing) reproductor?.soltar()
    }

    override fun onDestroy() {
        reproductor?.soltar()
        super.onDestroy()
    }
}
