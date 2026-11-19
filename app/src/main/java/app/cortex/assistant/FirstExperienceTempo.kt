package app.cortex.assistant

import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/** Deliberate, local presentation timing. Every pause remains cancellable. */
internal object FirstExperienceTempo {
    const val BEFORE_ACTION = 2_000L
    const val KEY = 650L
    const val RESULT = 2_200L
    const val SEALED = 2_400L
    const val BRIGHTNESS = 2_200L

    /** A faster, bounded native brightness animation for OEMs without an accessible slider. */
    suspend fun brightnessRampFast(start: Int, target: Int, write: (Int) -> Boolean,
                                   pause: suspend (Long) -> Unit = { delay(it) }): Boolean {
        require(start in 0..65_535 && target in 0..65_535)
        var last = start
        for (index in 1..24) {
            pause(45L)
            val t = index / 24f
            val eased = t * t * (3f - 2f * t)
            val value = (start + (target - start) * eased).roundToInt()
            if (value != last) {
                if (!write(value)) return false
                last = value
            }
        }
        return last == target
    }

    /** An unchanged integer SeekBar value is already acknowledged, not an action failure. */
    fun setProgress(current: Float, wanted: Float, integral: Boolean, write: (Float) -> Boolean): Boolean {
        val value = if (integral) wanted.roundToInt().toFloat() else wanted
        return current == value || write(value)
    }

    suspend fun brightnessRamp(start: Float, target: Float, write: (Float) -> Boolean,
                              pause: suspend (Long) -> Unit = { delay(it) }): Boolean {
        require(start.isFinite() && target.isFinite() && start in 0f..1f && target in 0f..1f)
        var elapsed = 0L
        for (index in 1..60) {
            val at = BRIGHTNESS * index / 60
            pause(at - elapsed)
            elapsed = at
            val t = index / 60f
            val eased = t * t * (3f - 2f * t)
            if (!write(start + (target - start) * eased)) return false
        }
        return true
    }
}
