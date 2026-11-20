package app.cortex.assistant

import android.graphics.PointF

internal object CortexRuntime {
    var appVisible = false
        private set
    var islandVisibility: (() -> Unit)? = null
    var islandTouchPassThrough: ((PointF?) -> Boolean)? = null
    var wakeLevel: ((Float) -> Unit)? = null
    var wakeCommand: ((String) -> Boolean)? = null
    var shutdownListener: (() -> Unit)? = null
    var scheduleChanged: (() -> Unit)? = null
    var reminder: ((String, String) -> Boolean)? = null
    var leaveForAction: (() -> Unit)? = null
    var firstExperienceActive = false
        set(value) {
            if (field == value) return
            field = value
            wakeHook?.invoke()
        }

    fun setAppVisible(value: Boolean) {
        appVisible = value
        islandVisibility?.invoke()
    }

    var wakeHook: (() -> Unit)? = null
    var wakeStatus: String? = null
    var wakeStatusListener: ((String?) -> Unit)? = null

    var recording = false
        set(value) {
            if (field == value) return
            field = value
            wakeHook?.invoke()
        }

    private val voicePlayers = mutableSetOf<Any>()
    val voicePlaying get() = voicePlayers.isNotEmpty()

    fun setVoicePlaying(player: Any, playing: Boolean) {
        val previous = voicePlaying
        if (playing) voicePlayers.add(player) else voicePlayers.remove(player)
        if (previous != voicePlaying) wakeHook?.invoke()
    }

    fun reportWake(value: String?) {
        if (wakeStatus == value) return
        wakeStatus = value
        wakeStatusListener?.invoke(value)
    }
}
