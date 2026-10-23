package io.github.mateozariquiey.goodttv

import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.session.MediaSession
import android.os.IBinder
import java.lang.ref.WeakReference

// Servicio en primer plano de tipo mediaPlayback mientras hay un canal o un VOD abierto con «fondo» (Reproductor.kt): sin
// él, al pasar a segundo plano Android corta la red a la app a los ~2 s y congela el proceso hacia el minuto, y con él el
// motor (la WebView del empalme). Sigue en primer plano también en pausa, así que al reanudar el motor sigue al día.
// Su notificación lleva los mandos del sistema (AND-5): con la sesión de medios del reproductor (mandos()), Android pinta
// lo que suena con su foto, reproducir y pausar, en la notificación y en la pantalla de bloqueo. Con la sesión, se ve aunque
// la app no tenga permiso para notificaciones; sin ella (hasta que llega el reproductor), no.
// No es MediaSessionService de Media3: con su gestión de la notificación, sale del primer plano a los 10 min de pausa
// (D27).
// Se arranca y se para con empezar() y parar(), no con startForegroundService y stopService directamente: Android cierra
// la app si el servicio se para antes de pasar a primer plano (abrir un canal y salir enseguida), y también si se arranca
// con la app fuera de la vista (abrir un VOD y bloquear el teléfono antes de que llegue su lista).
class FondoService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("reproduccion", "Reproducción", NotificationManager.IMPORTANCE_LOW),
        )
        enPrimerPlano()
        actual = WeakReference(this)
        pendientes = maxOf(0, pendientes - 1)
        if (pendientes == 0 && pararAlEmpezar) {
            pararAlEmpezar = false
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        if (actual?.get() === this) actual = null
        super.onDestroy()
    }

    // También para cambiar la notificación del servicio, que ya está en primer plano.
    private fun enPrimerPlano() =
        startForeground(AVISO, aviso(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)

    // En el hilo principal, como onStartCommand: no hay carreras entre los dos. Lo que cuenta son los arranques
    // pendientes, no la instancia: tras stopService, un arranque nuevo puede crear otra antes de que se destruya la vieja.
    companion object {
        private const val AVISO = 1
        private var pendientes = 0 // startForegroundService que aún no han llegado a onStartCommand
        private var pararAlEmpezar = false
        private var actual: WeakReference<FondoService>? = null // entre onStartCommand y onDestroy
        private var sesion: MediaSession.Token? = null

        // false si Android no lo deja arrancar porque la app ya no está a la vista: se vuelve a intentar al volver a ella
        // (Reproductor.asegurarServicio).
        fun empezar(contexto: Context): Boolean {
            try {
                contexto.startForegroundService(Intent(contexto, FondoService::class.java))
            } catch (error: ForegroundServiceStartNotAllowedException) {
                return false
            }
            pararAlEmpezar = false
            pendientes++
            return true
        }

        // Con un arranque pendiente, se para en cuanto pase a primer plano.
        fun parar(contexto: Context) {
            sesion = null
            if (pendientes == 0) contexto.stopService(Intent(contexto, FondoService::class.java))
            else pararAlEmpezar = true
        }

        // La sesión de medios del reproductor, para los mandos de la notificación. Si el servicio aún no ha empezado, la
        // usará al empezar.
        fun mandos(token: MediaSession.Token) {
            sesion = token
            actual?.get()?.enPrimerPlano()
        }

        private fun aviso(contexto: Context): Notification {
            val aviso = Notification.Builder(contexto, "reproduccion")
                .setContentTitle("GoodTTV")
                .setSmallIcon(R.drawable.icono_aviso)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(abrirApp(contexto))
            sesion?.let { aviso.setStyle(Notification.MediaStyle().setMediaSession(it)) }
            return aviso.build()
        }

        // Tocar la notificación (o lo que suena, en la pantalla de bloqueo) trae la app como su icono: la tarea que hay.
        fun abrirApp(contexto: Context): PendingIntent? =
            contexto.packageManager.getLaunchIntentForPackage(contexto.packageName)?.let {
                PendingIntent.getActivity(contexto, 0, it, PendingIntent.FLAG_IMMUTABLE)
            }
    }
}
