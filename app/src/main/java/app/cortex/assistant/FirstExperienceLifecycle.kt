package app.cortex.assistant

/** A visible old view cannot acknowledge a queued Android service-start request. */
internal class FirstExperienceIslandSession {
    private var requested: String? = null
    private var acknowledged: String? = null

    fun request(session: String) {
        require(session.isNotBlank())
        requested = session
        acknowledged = null
    }

    fun accepts(session: String) = session.isNotBlank() && requested == session

    /** False for a stale or repeated intent, so it cannot restart the entrance animation. */
    fun acknowledge(session: String): Boolean {
        if (!accepts(session) || acknowledged == session) return false
        acknowledged = session
        return true
    }

    fun available(session: String, attached: Boolean, stopping: Boolean) =
        accepts(session) && acknowledged == session && attached && !stopping

    fun ready(session: String, attached: Boolean, stopping: Boolean, opacity: Float) =
        available(session, attached, stopping) && opacity.isFinite() && opacity >= .95f

    fun release(session: String): Boolean {
        if (!accepts(session)) return false
        requested = null
        acknowledged = null
        return true
    }
}

internal enum class FirstExperienceStopReason(val message: String) {
    ACCESSIBILITY("Знакомство остановлено: служба управления экраном отключилась или перезапустилась. Дождитесь её подключения и повторите знакомство."),
    SCREEN_LOCKED("Знакомство остановлено: экран выключен или заблокирован. Разблокируйте телефон и повторите знакомство."),
    OVERLAY_PERMISSION("Знакомство остановлено: Android отключил доступ «Поверх других приложений». Проверьте разрешение для островка."),
    ORIENTATION("Знакомство остановлено: в этой ориентации островок скрыт. Поверните телефон вертикально и повторите знакомство."),
    ISLAND("Знакомство остановлено: островок с кнопкой остановки недоступен. Разрешения могли остаться включёнными — повторите знакомство.")
}

internal object FirstExperienceHealth {
    fun failure(connected: Boolean, unlocked: Boolean, overlay: Boolean, orientation: Boolean,
                islandAvailable: Boolean): FirstExperienceStopReason? = when {
        !connected -> FirstExperienceStopReason.ACCESSIBILITY
        !unlocked -> FirstExperienceStopReason.SCREEN_LOCKED
        !overlay -> FirstExperienceStopReason.OVERLAY_PERMISSION
        !orientation -> FirstExperienceStopReason.ORIENTATION
        !islandAvailable -> FirstExperienceStopReason.ISLAND
        else -> null
    }
}
