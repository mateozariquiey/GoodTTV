package io.github.mateozariquiey.goodttv

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.util.Log
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// Solo en la variante «medida»: una muestra por segundo de la batería en logcat (GoodTTVBateria), de la que
// medir/comun.mjs saca la potencia del teléfono. En el S25, adb no puede leer /sys/class/power_supply ni el HAL de salud, y
// «dumpsys battery» repite el último valor durante decenas de segundos; BatteryManager sí la da al momento a la app.
// La corriente va en µA (negativa al descargar); la tensión, en mV, es la del último aviso de la batería, que cambia poco
// (en el S25, cada ~7 min).
object Bateria {
    private var empezada = false

    @Synchronized
    fun empezar(contexto: Context) {
        if (empezada) return
        empezada = true
        val app = contexto.applicationContext
        val bateria = app.getSystemService(BatteryManager::class.java)
        Executors.newSingleThreadScheduledExecutor().scheduleWithFixedDelay({
            // Una excepción pararía las muestras siguientes sin avisar: se anota y se sigue.
            try {
                val aviso = app.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED), Context.RECEIVER_NOT_EXPORTED)
                val corriente = bateria.getLongProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW)
                val datos = JSONObject()
                    .put("t", System.currentTimeMillis())
                    .put("tension", aviso?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1) ?: -1)
                // Long.MIN_VALUE: el teléfono no la da. Sin «corriente», la muestra no cuenta (comun.mjs).
                if (corriente != Long.MIN_VALUE) datos.put("corriente", corriente)
                Log.i("GoodTTVBateria", datos.toString())
            } catch (error: Exception) {
                Log.w("GoodTTVBateria", "sin muestra", error)
            }
        }, 0, 1, TimeUnit.SECONDS)
    }
}
