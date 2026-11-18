package app.cortex.assistant

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.location.LocationManager
import android.nfc.NfcAdapter
import android.os.PowerManager
import android.provider.Settings
import androidx.core.location.LocationManagerCompat

/** Taps a known SystemUI switch after visual control has been enabled. */
internal class CortexSystemTiles(private val context: Context, private val screen: CortexScreenService) {
    private val navigation = VisualNavigation(context, screen)

    suspend fun set(target: String, enabled: Boolean): Boolean {
        val names = labels[target] ?: return false
        if (read(target) == enabled) return true
        val wasOpen = screen.frame()?.let(::systemUi) == true
        if (!wasOpen && !screen.global(AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS)) return false
        try {
            val frame = navigation.await(3_500L) { systemUi(it) && tile(it, names) != null } ?: return false
            val control = tile(frame, names) ?: return false
            val before = state(control.checked, control.state, control.description, control.label) ?: read(target) ?: return false
            if (before == enabled) return true
            if (!screen.click(frame, control) && !screen.tap(frame, control)) return false
            return navigation.await(5_200L) { after ->
                systemUi(after) && (read(target) == enabled ||
                    tile(after, names)?.let { state(it.checked, it.state, it.description, it.label) } == enabled)
            } != null
        } finally {
            if (!wasOpen && screen.frame()?.let(::systemUi) == true) {
                screen.global(AccessibilityService.GLOBAL_ACTION_BACK)
            }
        }
    }

    private fun systemUi(frame: VisualFrame) = frame.pkg == "com.android.systemui" && !frame.secure && !frame.hasPrivateFields

    private fun tile(frame: VisualFrame, names: Set<String>) = frame.tree.filter { node ->
        node.enabled && node.clickable && !node.editable &&
            (node.checked != null || node.role in setOf("Switch", "ToggleButton", "Button") ||
                state(null, node.state, node.description, node.label) != null) &&
            listOf(node.label, node.description, node.resource.substringAfterLast('/')).any { text ->
                val label = VisualLabels.normalize(text)
                names.any { label == it || label.startsWith("$it ") }
            }
    }.distinctBy { it.bounds }.singleOrNull()

    private fun read(target: String): Boolean? = runCatching {
        when (target) {
            "airplane" -> Settings.Global.getInt(context.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) != 0
            "location" -> LocationManagerCompat.isLocationEnabled(context.getSystemService(LocationManager::class.java))
            "battery_saver" -> context.getSystemService(PowerManager::class.java).isPowerSaveMode
            "nfc" -> NfcAdapter.getDefaultAdapter(context)?.isEnabled
            else -> null
        }
    }.getOrNull()

    companion object {
        private val labels = mapOf(
            "bluetooth" to setOf("bluetooth", "блютуз", "блютус"),
            "airplane" to setOf("режим полета", "авиарежим", "режим в самолете", "airplane mode", "flight mode"),
            "location" to setOf("местоположение", "геолокация", "location", "gps"),
            "nfc" to setOf("nfc", "нфс"),
            "battery_saver" to setOf("энергосбережение", "режим энергосбережения", "battery saver", "power saving"),
            "mobile" to setOf("мобильные данные", "передача данных", "mobile data", "cellular data")
        )
        private val on = Regex("""(?:^| )(?:вкл|включено|активно|on|enabled)(?: |$)""")
        private val off = Regex("""(?:^| )(?:выкл|выключено|отключено|off|disabled)(?: |$)""")

        fun state(checked: Boolean?, vararg values: String): Boolean? {
            if (checked != null) return checked
            for (value in values) {
                val normalized = VisualLabels.normalize(value)
                val enabled = on.containsMatchIn(normalized)
                if (enabled != off.containsMatchIn(normalized)) return enabled
            }
            return null
        }
    }
}
