package io.github.mateozariquiey.goodttv

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler

// Para reaccionar cuando cambia la red, sin sondear (Reproductor.kt): «alCambiar», en «hilo», si llega una red nueva (vuelve
// la conexión) o se pierde una y queda otra (de wifi a datos, que suelen estar ya conectados, así que no «llegan»).
//
// Una VPN no cuenta como red: sin nada debajo, sigue siendo la red activa y dice tener internet. Con Tailscale en el S25,
// en modo avión no se veía «sin red» (seguía reintentando, despierto) y, al volver, el aviso de la red no siempre llegaba.
class AvisoDeRed(contexto: Context, private val hilo: Handler, private val alCambiar: () -> Unit) {
    private val conexiones = contexto.getSystemService(ConnectivityManager::class.java)
    private val conInternet = NetworkRequest.Builder()
        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
        .build()
    private var escucha: ConnectivityManager.NetworkCallback? = null
    val escuchando get() = escucha != null

    // allNetworks está en desuso a favor de escuchar siempre, y aquí solo se pregunta al abrir, al fallar y al empezar a escuchar.
    @Suppress("DEPRECATION")
    private fun redes(): List<Network> = conexiones.allNetworks.filter { red ->
        conexiones.getNetworkCapabilities(red)?.let { conInternet.canBeSatisfiedBy(it) } == true
    }

    fun hayRed(): Boolean = redes().isNotEmpty()

    fun escuchar() {
        if (escucha != null) return
        // Android avisa enseguida de las que ya hay, que no son novedad.
        val conocidas = redes().toMutableSet()
        val nueva = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (conocidas.add(network)) avisar()
            }

            override fun onLost(network: Network) {
                conocidas.remove(network)
                if (conocidas.isNotEmpty()) avisar()
            }

            private fun avisar() {
                hilo.post { if (escucha === this) alCambiar() }
            }
        }
        escucha = nueva
        conexiones.registerNetworkCallback(conInternet, nueva, hilo)
    }

    fun dejar() {
        escucha?.let { conexiones.unregisterNetworkCallback(it) }
        escucha = null
    }
}
