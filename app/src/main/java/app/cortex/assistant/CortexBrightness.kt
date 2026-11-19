package app.cortex.assistant

/** A verified Settings.System transaction. A successful putInt is not proof of a changed value. */
internal object CortexBrightness {
    private const val MANUAL = 0
    private const val AUTOMATIC = 1
    private const val MAX = 255

    interface Port {
        fun brightness(): Int?
        fun mode(): Int?
        fun writeBrightness(value: Int): Boolean
        fun writeMode(value: Int): Boolean
    }

    data class Outcome(val status: String, val percent: Int? = null, val automatic: Boolean? = null)

    private fun percentage(raw: Int) = (raw * 100 + MAX / 2) / MAX

    fun apply(port: Port, action: String, amount: Int = 10): Outcome {
        val original = port.brightness()?.takeIf { it in 0..MAX } ?: return Outcome("unavailable")
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
        val raw = ((desired * MAX + 50) / 100).coerceIn(1, MAX)

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
