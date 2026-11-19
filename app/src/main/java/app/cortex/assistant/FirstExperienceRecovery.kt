package app.cortex.assistant

/** All restore operations are attempted, even if a revoked permission or an OEM write throws. */
internal object FirstExperienceRecovery {
    data class Saved(val level: Int, val mode: Int, val adjustment: String?)
    interface SettingsAccess {
        fun mode(value: Int): Boolean
        fun mode(): Int
        fun level(value: Int): Boolean
        fun level(): Int
        fun adjustment(value: String): Boolean
        fun adjustment(): String?
    }

    fun restore(saved: Saved, access: SettingsAccess): Boolean {
        if (saved.level !in 0..65_535 || saved.mode !in 0..1) return false
        fun attempt(block: () -> Boolean) = runCatching(block).getOrDefault(false)
        val manual = attempt { access.mode(0) && access.mode() == 0 }
        val level = attempt { access.level(saved.level) && access.level() == saved.level }
        val adjustment = saved.adjustment == null || attempt {
            access.adjustment(saved.adjustment) && access.adjustment() == saved.adjustment
        }
        // Do not short-circuit this final write when an earlier restore failed.
        val mode = attempt { access.mode(saved.mode) && access.mode() == saved.mode }
        return manual && level && adjustment && mode
    }
}
