package app.cortex.assistant

import kotlinx.coroutines.delay

/** Deliberate, local presentation timing. Every pause remains cancellable. */
internal object FirstExperienceTempo {
    const val BEFORE_ACTION = 2_000L
    const val KEY = 650L
    const val RESULT = 2_200L
    const val SEALED = 2_400L
    const val BRIGHTNESS = 2_200L

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
