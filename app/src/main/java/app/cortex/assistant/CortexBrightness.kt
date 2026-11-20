package app.cortex.assistant

/** A verified Settings.System transaction. A successful putInt is not proof of a changed value. */
internal object CortexBrightness {
    private const val MANUAL = 0
    private const val AUTOMATIC = 1
    private const val LEGACY_MAX = 255

    interface Port {
        fun brightness(): Int?
        fun mode(): Int?
        fun writeBrightness(value: Int): Boolean
        fun writeMode(value: Int): Boolean
        /** The framework's Settings.System maximum when the device reports one. */
        fun maximum(): Int? = null
    }

    data class Outcome(val status: String, val percent: Int? = null, val automatic: Boolean? = null)

    /**
     * Many OEM builds (Xiaomi, some Samsung/vivo) store screen_brightness as 0..1023/2047/4095
     * rather than 0..255. Prefer the framework maximum; otherwise infer it from the current value.
     */
    fun scale(level: Int, reported: Int?): Int =
        reported?.takeIf { it in LEGACY_MAX..65_535 && it >= level } ?: when {
            level <= LEGACY_MAX -> LEGACY_MAX
            level <= 1023 -> 1023
            level <= 2047 -> 2047
            level <= 4095 -> 4095
            else -> 65_535
        }

    fun apply(port: Port, action: String, amount: Int = 10): Outcome {
        val original = port.brightness()?.takeIf { it in 0..65_535 } ?: return Outcome("unavailable")
        val max = scale(original, port.maximum())
        fun percentage(raw: Int) = (raw * 100 + max / 2) / max
        val originalMode = port.mode()?.takeIf { it == MANUAL || it == AUTOMATIC } ?: return Outcome("unavailable")
        if (action == "status") return Outcome("done", percentage(original), originalMode == AUTOMATIC)

        if (action == "auto" || action == "manual") {
            val wanted = if (action == "auto") AUTOMATIC else MANUAL
            if (originalMode != wanted && !port.writeMode(wanted)) return Outcome("unavailable")
            val actual = port.mode()
            return Outcome(if (actual == wanted) "done" else "requested", percentage(original), actual == AUTOMATIC)
        }

        val current = percentage(original)
        val desired = when (action) {
            "set" -> amount
            "up" -> current + amount
            "down" -> current - amount
            else -> return Outcome("invalid")
        }.coerceIn(1, 100)
        val raw = ((desired * max + 50) / 100).coerceIn(1, max)

        if (originalMode != MANUAL && !port.writeMode(MANUAL)) return Outcome("unavailable")
        if (port.mode() != MANUAL) {
            if (originalMode != MANUAL) port.writeMode(originalMode)
            return Outcome("requested")
        }
        val wrote = original == raw || port.writeBrightness(raw)
        val actual = port.brightness()
        if (wrote && actual == raw && port.mode() == MANUAL) {
            return Outcome("done", percentage(raw), false)
        }

        // An OEM can accept the write but reject the value. Restore the earlier
        // values where possible; never claim that the display changed.
        if (actual != original) port.writeBrightness(original)
        if (originalMode != MANUAL) port.writeMode(originalMode)
        val restored = port.brightness() == original && port.mode() == originalMode
        return Outcome(if (restored) "unavailable" else "requested")
    }
}
