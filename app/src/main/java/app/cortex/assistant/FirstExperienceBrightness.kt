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
        val range = slider(initial)?.range ?: return false
        val start = (range.current - range.min) / (range.max - range.min)
        val reduced = context.getSharedPreferences("cortex-display", Context.MODE_PRIVATE).getBoolean("reduceMotion", false)
        val steps = if (reduced) 1 else 6
        for (index in 1..steps) {
            val frame = service.frame(fresh = true)?.takeIf(::panel) ?: return false
            val control = slider(frame) ?: return false
            val current = control.range ?: return false
            if (current.min != range.min || current.max != range.max) return false
            val relative = start + (fraction - start) * index / steps
            val wanted = range.min + relative * (range.max - range.min)
            if (!service.setProgress(frame, control, wanted)) return false
            delay(100L)
        }
        return navigation.await(900L) { frame ->
            if (!panel(frame)) false else slider(frame)?.range?.let {
                val actual = (it.current - it.min) / (it.max - it.min)
                abs(actual - fraction) <= .045f
            } == true
        } != null
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
        val adjustment = Settings.System.getString(resolver, Settings.System.SCREEN_AUTO_BRIGHTNESS_ADJ)
        var opened = false
        try {
            if (!service.global(AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS)) {
                return Outcome(false, "Панель быстрых настроек недоступна. Пропускаю фокус.")
            }
            opened = true
            if (navigation.await(2_500L) { panel(it) && slider(it) != null } == null) {
                return Outcome(false, "Не распознал ползунок яркости на этом телефоне. Пропускаю фокус.")
            }
            // Persist BEFORE the first write. A later app/service start can recover a killed session.
            val saved = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().clear()
                .putBoolean("pending", true).putInt("level", level).putInt("mode", mode)
                .putString("adjustment", adjustment).commit()
            if (!saved) return Outcome(false, "Не удалось сохранить настройки яркости. Пропускаю фокус.")
            if (!Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL) ||
                Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, -1) != Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL) {
                return Outcome(false, "Android не разрешил временно отключить автояркость. Пропускаю фокус.")
            }
            delay(180L)
            val manual = service.frame(fresh = true)?.takeIf(::panel) ?: return Outcome(false, "Панель закрыта. Возвращаю настройки яркости.")
            val range = slider(manual)?.range ?: return Outcome(false, "Ползунок изменился. Возвращаю настройки яркости.")
            // Use the live range after switching to manual, not the OEM's raw Settings scale.
            val original = (range.current - range.min) / (range.max - range.min)
            val target = FirstExperienceMath.brightnessTarget(original)
            if (!animate(target)) return Outcome(false, "Android не подтвердил изменение яркости. Возвращаю настройки.")
            val actual = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, level)
            if (actual == level) return Outcome(false, "Изменение яркости не подтверждено. Пропускаю фокус.")
            delay(650L)
            animate(original)
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
                    override fun adjustment(value: String) = Settings.System.putString(resolver, Settings.System.SCREEN_AUTO_BRIGHTNESS_ADJ, value)
                    override fun adjustment() = Settings.System.getString(resolver, Settings.System.SCREEN_AUTO_BRIGHTNESS_ADJ)
                }
                if (FirstExperienceRecovery.restore(FirstExperienceRecovery.Saved(level, mode, store.getString("adjustment", null)), access)) {
                    store.edit().clear().commit()
                } else false
            }.getOrDefault(false)
        }
    }
}
