package app.cortex.assistant

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.provider.Settings
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.math.abs

/** The slider is real; WRITE_SETTINGS is used only to secure and restore its state. */
internal class FirstExperienceBrightness(private val context: Context, private val service: CortexScreenService) {
    data class Outcome(val performed: Boolean, val message: String)
    class RestoreFailed : IllegalStateException("Не удалось восстановить яркость. Откройте настройки дисплея.")
    private val navigation = VisualNavigation(context, service)

    private fun slider(frame: VisualFrame): VisualNode? = frame.tree.filter { node ->
        val range = node.range
        val identity = "${node.label} ${node.description} ${node.resource}".lowercase()
        node.enabled && node.progressSettable && range != null && range.min.isFinite() && range.max.isFinite() &&
            range.current.isFinite() && range.max > range.min && range.current in range.min..range.max &&
            node.role in setOf("SeekBar", "Slider") && !node.bounds.isEmpty &&
            ("brightness" in identity || "яркость" in identity || "яркости" in identity)
    }.singleOrNull()

    private fun panel(frame: VisualFrame) = frame.pkg in SYSTEM_UI && !frame.secure && !frame.hasPrivateFields

    private suspend fun animate(fraction: Float): Boolean {
        val initial = navigation.await(900L) { panel(it) && slider(it) != null } ?: return false
        val node = slider(initial) ?: return false
        val range = node.range ?: return false
        val start = (range.current - range.min) / (range.max - range.min)
        val reduced = context.getSharedPreferences("cortex-display", Context.MODE_PRIVATE).getBoolean("reduceMotion", false)
        val control = service.progressControl(initial, node) ?: return false
        val moved = control.use {
            if (reduced) it.set(range.min + fraction * (range.max - range.min))
            else FirstExperienceTempo.brightnessRamp(start, fraction, { relative ->
                it.set(range.min + relative * (range.max - range.min))
            })
        }
        if (!moved) return false
        return navigation.await(1_500L) { frame ->
            if (!panel(frame)) false else slider(frame)?.range?.let {
                val actual = (it.current - it.min) / (it.max - it.min)
                abs(actual - fraction) <= .045f
            } == true
        } != null
    }

    /**
     * Demonstrate brightness while the actual launcher is visible. Many OEMs do
     * not provide a readable SystemUI SeekBar; WRITE_SETTINGS is a supported
     * Android API and avoids guessing slider coordinates on those devices.
     */
    suspend fun runOnHome(): Outcome {
        if (!Settings.System.canWrite(context)) return Outcome(false,
            "Нет разрешения на изменение системной яркости.")
        if (!restorePending(context)) throw RestoreFailed()
        if (service.activePackage() !in navigation.home) return Outcome(false,
            "Главный экран ещё не открылся. Не меняю яркость в другом приложении.")
        val resolver = context.contentResolver
        val level = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, -1)
            .takeIf { it in 0..65_535 } ?: return Outcome(false, "Android не сообщил текущую яркость.")
        val mode = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, -1)
            .takeIf { it in 0..1 } ?: return Outcome(false, "Android не сообщил режим яркости.")
        val adjustment = Settings.System.getString(resolver, AUTO_BRIGHTNESS_ADJUSTMENT)
        // The provider brightness range varies across Android vendors.
        val scale = when {
            level <= 255 -> 255
            level <= 1023 -> 1023
            level <= 4095 -> 4095
            else -> 65_535
        }
        val target = (FirstExperienceMath.brightnessTarget(level.toFloat() / scale) * scale).toInt()
            .coerceIn(1, scale)
        if (!context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().clear()
                .putBoolean("pending", true).putInt("level", level).putInt("mode", mode)
                .putString("adjustment", adjustment).commit()) return Outcome(false,
            "Не получилось сохранить исходные настройки яркости.")
        try {
            if (!Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE,
                    Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL) ||
                Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, -1) !=
                    Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL) return Outcome(false,
                "Производитель запретил изменение режима яркости.")
            val write: (Int) -> Boolean = { value ->
                Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS, value)
            }
            val reduced = context.getSharedPreferences("cortex-display", Context.MODE_PRIVATE)
                .getBoolean("reduceMotion", false)
            val forward = if (reduced) write(target) else
                FirstExperienceTempo.brightnessRampFast(level, target, write)
            if (!forward || Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, -1) != target)
                return Outcome(false, "Android не подтвердил изменение яркости.")
            delay(400L)
            val backward = if (reduced) write(level) else
                FirstExperienceTempo.brightnessRampFast(target, level, write)
            if (!backward || Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, -1) != level)
                return Outcome(false, "Android не подтвердил возвращение исходной яркости.")
            return Outcome(true, "Я изменил яркость прямо на главном экране — и вернул её назад.")
        } finally {
            withContext(NonCancellable) {
                if (!restorePending(context)) throw RestoreFailed()
            }
        }
    }

    suspend fun run(): Outcome {
        if (!Settings.System.canWrite(context)) return Outcome(false,
            "Фокус с яркостью пропущен: нет разрешения на изменение системных настроек.")
        if (!restorePending(context)) throw RestoreFailed()
        val resolver = context.contentResolver
        val level = Settings.System.getString(resolver, Settings.System.SCREEN_BRIGHTNESS)?.toIntOrNull()
            ?.takeIf { it in 0..65_535 } ?: return Outcome(false, "Android не сообщил исходную яркость. Пропускаю фокус.")
        val mode = Settings.System.getString(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE)?.toIntOrNull()
            ?.takeIf { it in 0..1 } ?: return Outcome(false, "Android не сообщил режим яркости. Пропускаю фокус.")
        val adjustment = Settings.System.getString(resolver, AUTO_BRIGHTNESS_ADJUSTMENT)
        var opened = false
        try {
            if (!service.global(AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS)) {
                return Outcome(false, "Панель быстрых настроек недоступна. Пропускаю фокус.")
            }
            opened = true
            if (navigation.await(2_500L) { panel(it) && slider(it) != null } == null) {
                return Outcome(false, "Не распознал ползунок яркости на этом телефоне. Пропускаю фокус.")
            }
            delay(FirstExperienceTempo.BEFORE_ACTION)
            // Persist BEFORE the first write. A later app/service start can recover a killed session.
            val saved = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().clear()
                .putBoolean("pending", true).putInt("level", level).putInt("mode", mode)
                .putString("adjustment", adjustment).commit()
            if (!saved) return Outcome(false, "Не удалось сохранить настройки яркости. Пропускаю фокус.")
            if (!Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL) ||
                Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, -1) != Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL) {
                return Outcome(false, "Android не разрешил временно отключить автояркость. Пропускаю фокус.")
            }
            delay(400L)
            val manual = service.frame(fresh = true)?.takeIf(::panel) ?: return Outcome(false, "Панель закрыта. Возвращаю настройки яркости.")
            val range = slider(manual)?.range ?: return Outcome(false, "Ползунок изменился. Возвращаю настройки яркости.")
            // Use the live range after switching to manual, not the OEM's raw Settings scale.
            val original = (range.current - range.min) / (range.max - range.min)
            val target = FirstExperienceMath.brightnessTarget(original)
            if (!animate(target)) return Outcome(false, "Android не подтвердил изменение яркости. Возвращаю настройки.")
            val actual = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, level)
            if (actual == level) return Outcome(false, "Изменение яркости не подтверждено. Пропускаю фокус.")
            delay(1_300L)
            if (!animate(original)) return Outcome(false, "Возвращаю точные исходные настройки яркости.")
            delay(900L)
            return Outcome(true, "Я могу управлять не только приложениями.")
        } finally {
            withContext(NonCancellable) {
                val restored = restorePending(context)
                // Only dismiss the SystemUI panel that this step opened; never press Back in another app.
                if (opened) repeat(2) {
                    if (service.frame(fresh = true)?.let(::panel) == true) {
                        service.global(AccessibilityService.GLOBAL_ACTION_BACK)
                        delay(150L)
                    }
                }
                if (!restored) throw RestoreFailed()
            }
        }
    }

    companion object {
        private const val STORE = "cortex-first-experience-brightness"
        // Optional AOSP/OEM provider key, not an Android SDK constant. Never use hidden-API reflection.
        private const val AUTO_BRIGHTNESS_ADJUSTMENT = "screen_auto_brightness_adj"
        private val SYSTEM_UI = setOf("com.android.systemui", "com.miui.systemui", "com.huawei.systemui", "com.hihonor.systemui")

        fun hasPending(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getBoolean("pending", false)

        /** Synchronous, bounded recovery: works even when the screen/service has disappeared. */
        fun restorePending(context: Context): Boolean {
            val store = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
            if (!store.getBoolean("pending", false)) return true
            if (!Settings.System.canWrite(context)) return false
            val level = store.getInt("level", -1)
            val mode = store.getInt("mode", -1)
            if (level !in 0..65_535 || mode !in 0..1) return false
            return runCatching {
                val resolver = context.contentResolver
                val access = object : FirstExperienceRecovery.SettingsAccess {
                    override fun mode(value: Int) = Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, value)
                    override fun mode() = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, -1)
                    override fun level(value: Int) = Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS, value)
                    override fun level() = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, -1)
                    override fun adjustment(value: String) = Settings.System.putString(resolver, AUTO_BRIGHTNESS_ADJUSTMENT, value)
                    override fun adjustment() = Settings.System.getString(resolver, AUTO_BRIGHTNESS_ADJUSTMENT)
                }
                if (FirstExperienceRecovery.restore(FirstExperienceRecovery.Saved(level, mode, store.getString("adjustment", null)), access)) {
                    store.edit().clear().commit()
                } else false
            }.getOrDefault(false)
        }
    }
}
