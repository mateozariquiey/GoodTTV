package io.github.mateozariquiey.goodttv

import androidx.annotation.OptIn
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

// Lo que ven los mandos del sistema (los controles de la notificación y de la pantalla de bloqueo, y los botones de los
// auriculares) por la sesión de medios de Reproductor.kt: el reproductor de lo que se ve, con solo reproducir y pausar, y
// con el título, el texto y la foto que manda la página. Reproducir y pausar van por «pausar» (Reproductor.pausar), como
// el botón del PiP: pausar el directo cuenta como retroceder, y reanudar sigue en el directo. Saltar, no: en directo, lo
// que cabe atrás lo sabe la página (DVR-1).
@OptIn(UnstableApi::class)
class Mando(reproductor: Player, private val pausar: (Boolean) -> Unit) : ForwardingSimpleBasePlayer(reproductor) {
    var datos: MediaMetadata = MediaMetadata.EMPTY
        set(valor) {
            field = valor
            invalidateState()
        }

    // Con el reproductor ya soltado (mientras llega el siguiente, o si el siguiente no llega a sonar: un canal sin directo):
    // parado. El ExoPlayer liberado no avisa de nada, y sin esto la sesión lo seguiría enseñando como estaba.
    var suelto = false
        set(valor) {
            field = valor
            invalidateState()
        }

    override fun getState(): State {
        val estado = super.getState()
        val nuevo = estado.buildUpon()
            .setAvailableCommands(ORDENES)
            .setPlaylist(estado.timeline, estado.currentTracks, datos)
        if (suelto) {
            nuevo.setPlaybackState(Player.STATE_IDLE)
                .setIsLoading(false)
                .setPlayWhenReady(false, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
        }
        return nuevo.build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        pausar(!playWhenReady)
        return Futures.immediateVoidFuture()
    }

    private companion object {
        // Reproducir y pausar, y lo que hace falta para enseñar qué suena y por dónde va.
        val ORDENES: Player.Commands = Player.Commands.Builder()
            .addAll(
                Player.COMMAND_PLAY_PAUSE,
                Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
                Player.COMMAND_GET_TIMELINE,
                Player.COMMAND_GET_METADATA,
                Player.COMMAND_GET_TRACKS,
                Player.COMMAND_GET_AUDIO_ATTRIBUTES,
                Player.COMMAND_GET_VOLUME,
                Player.COMMAND_GET_DEVICE_VOLUME,
            )
            .build()
    }
}
