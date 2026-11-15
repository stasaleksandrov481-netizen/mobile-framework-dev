package app.cortex.assistant

import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.os.PowerManager
import android.provider.Settings
import android.view.Display
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

internal object CortexDisplaySettings {
    private fun screen(context: Context): Display? {
        @Suppress("DEPRECATION")
        return context.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)
    }

    private fun rates(display: Display?): List<Int> {
        val mode = display?.mode
        return display?.supportedModes.orEmpty().filter {
            mode == null || it.physicalWidth == mode.physicalWidth && it.physicalHeight == mode.physicalHeight
        }.map { it.refreshRate.roundToInt() }.distinct().sorted()
    }

    fun info(context: Context): JSONObject {
        val display = screen(context)
        return JSONObject().put("current_hz", display?.mode?.refreshRate?.roundToInt() ?: JSONObject.NULL)
            .put("supported_hz", JSONArray(rates(display)))
    }

    private val menuLabels = setOf("плавность движений", "плавность экрана", "частота обновления", "частота обновления экрана",
        "motion smoothness", "refresh rate", "screen refresh rate")
    private val highLabels = setOf("высокая", "высокая частота", "high", "high refresh rate")
    private val normalLabels = setOf("стандартная", "стандартная частота", "standard", "standard refresh rate")
    private val applyLabels = setOf("применить", "apply")

    suspend fun set(
        context: Context, value: Int, report: (String) -> Unit
    ): CortexActionEngine.Result {
        fun result(text: String, ok: Boolean = false) = CortexActionEngine.Result(text, ok)
        if (!CortexSchedule.screenReady(context)) return result("Разблокируйте телефон, чтобы изменить частоту экрана.")
        val supported = rates(screen(context))
        if (supported.isNotEmpty() && value !in supported) {
            val choices = supported.joinToString()
            return result("На этом разрешении Android показывает частоты $choices Гц. Режим $value Гц недоступен.")
        }
        if (context.getSystemService(PowerManager::class.java).isPowerSaveMode && value > 60) {
            return result("Сейчас включено энергосбережение. Выключите его, чтобы выбрать $value Гц.")
        }
        val intent = Intent(Settings.ACTION_DISPLAY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val expected = intent.resolveActivity(context.packageManager)?.packageName
        report("Открываю настройки дисплея…")
        if (runCatching { context.startActivity(intent) }.isFailure) return result("Android не открыл настройки дисплея.")
        val manual = "Откройте «Настройки» → «Дисплей». Выберите «Частота обновления» или «Плавность движений», затем $value Гц."
        val service = CortexScreenService.connected ?: return result(manual)
        if (expected == null) return result(manual)

        val navigation = VisualNavigation(context, service)
        suspend fun find(labels: Set<String>, timeout: Long): Pair<VisualFrame, VisualNode>? {
            val frame = navigation.await(timeout) { it.pkg == expected && !it.secure && !it.hasPrivateFields && node(it, labels) != null }
                ?: return null
            return node(frame, labels)?.let { frame to it }
        }
        suspend fun click(frame: VisualFrame, node: VisualNode) = service.click(frame, node) || service.tap(frame, node)
        val displayPage = navigation.await(1900) { it.pkg == expected && !it.secure && !it.hasPrivateFields }
            ?: return result(manual)
        val control = node(displayPage, menuLabels)?.let { displayPage to it } ?: run {
            val list = displayPage.nodes.firstOrNull { it.scrollable && it.enabled }
            if (list != null) service.semanticScroll(displayPage, list, "down")
            find(menuLabels, 1100)
        }
        val (page, menu) = control ?: return result(manual)
        if (!click(page, menu)) return result(manual)
        val labels = mutableSetOf("$value гц", "$value hz")
        if (supported.size == 2 && value == supported.last()) labels.addAll(highLabels)
        if (supported.size == 2 && value == supported.first()) labels.addAll(normalLabels)
        val (modes, target) = find(labels, 2000) ?: return result("Выберите $value Гц на открытом экране дисплея.")
        if (!target.selected && target.checked != true && !click(modes, target)) {
            return result("Android не подтвердил выбор $value Гц. Проверьте режим на открытом экране.")
        }
        report("Проверяю выбранную частоту…")
        find(applyLabels, 850)?.let { (frame, button) -> click(frame, button) }
        repeat(5) {
            if (screen(context)?.mode?.refreshRate?.roundToInt() == value) return result("Android сообщил $value Гц.", true)
            delay(140)
        }
        val checked = service.frame()?.takeIf { it.pkg == expected && !it.secure && !it.hasPrivateFields }
            ?.let { node(it, labels) }?.let { it.selected || it.checked == true } == true
        return if (checked) result("В настройках выбран режим $value Гц. Android меняет фактическую частоту в зависимости от нагрузки.", true)
        else result("Я выбрал $value Гц на экране. Проверьте, применился ли режим в настройках дисплея.")
    }

    private fun node(frame: VisualFrame, labels: Set<String>): VisualNode? = frame.nodes
        .firstOrNull { it.enabled && !it.ocr && !it.bounds.isEmpty &&
            sequenceOf(it.label, it.description).any { text ->
                VisualLabels.normalize(text.substringBefore('\n')) in labels
            }
        }
}
