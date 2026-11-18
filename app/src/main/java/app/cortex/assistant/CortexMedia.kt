package app.cortex.assistant

import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.SystemClock
import android.view.KeyEvent
import org.json.JSONObject

internal object CortexMedia {
    data class Player(val title: String, val playing: Boolean?)

    private fun sessions(context: Context): List<MediaController> = runCatching {
        context.getSystemService(MediaSessionManager::class.java)
            .getActiveSessions(ComponentName(context, CortexNotificationListener::class.java))
    }.getOrDefault(emptyList())

    private fun playing(state: PlaybackState?) =
        state?.state in setOf(PlaybackState.STATE_PLAYING, PlaybackState.STATE_BUFFERING)

    private fun active(context: Context): MediaController? {
        val sessions = sessions(context)
        return sessions.firstOrNull { playing(it.playbackState) } ?: sessions.firstOrNull()
    }

    fun player(context: Context): Player? {
        val session = active(context)
        if (session != null) {
            val metadata = session.metadata
            val title = metadata?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)
                ?: metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)
            return Player(title?.take(100)?.ifBlank { "Мультимедиа" } ?: "Мультимедиа",
                session.playbackState?.let(::playing))
        }
        return if (context.getSystemService(AudioManager::class.java).isMusicActive)
            Player("Мультимедиа", null) else null
    }

    fun execute(context: Context, mode: String): JSONObject {
        fun result(status: String, message: String) = JSONObject().put("status", status).put("message", message)
        val key = when (mode) {
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "toggle" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            else -> return result("unsupported", "Неизвестная команда мультимедиа.")
        }
        val controller = active(context)
        val state = controller?.playbackState
        if (state != null) {
            if (mode == "play" && state.state == PlaybackState.STATE_PLAYING) return result("done", "Музыка уже играет.")
            if (mode == "pause" && state.state == PlaybackState.STATE_PAUSED) return result("done", "Музыка уже на паузе.")
        }
        val now = SystemClock.uptimeMillis()
        val down = KeyEvent(now, now, KeyEvent.ACTION_DOWN, key, 0)
        val up = KeyEvent(now, now, KeyEvent.ACTION_UP, key, 0)
        if (controller != null) {
            val controls = controller.transportControls
            val actions = state?.actions ?: 0L
            val dispatched = when (mode) {
                "play" -> if ((actions and PlaybackState.ACTION_PLAY) != 0L) { controls.play(); true } else false
                "pause" -> if ((actions and PlaybackState.ACTION_PAUSE) != 0L) { controls.pause(); true } else false
                "next" -> if ((actions and PlaybackState.ACTION_SKIP_TO_NEXT) != 0L) { controls.skipToNext(); true } else false
                "previous" -> if ((actions and PlaybackState.ACTION_SKIP_TO_PREVIOUS) != 0L) { controls.skipToPrevious(); true } else false
                else -> false
            }
            if (dispatched) return result("requested", "Команда передана медиаплееру.")
            if (!controller.dispatchMediaButtonEvent(down)) {
                return result("unsupported", "Текущий плеер не принял эту команду.")
            }
            controller.dispatchMediaButtonEvent(up)
        } else {
            val audio = context.getSystemService(AudioManager::class.java)
            audio.dispatchMediaKeyEvent(down)
            audio.dispatchMediaKeyEvent(up)
        }
        return result("requested", "Команда передана медиаплееру.")
    }
}
