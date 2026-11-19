package app.cortex.assistant

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import kotlinx.coroutines.delay

/** Drives the installed calculator through fresh accessibility nodes and visible gestures. */
internal class FirstExperienceCalculator(
    private val context: Context,
    private val service: CortexScreenService,
    private val report: (String) -> Unit
) {
    private val navigation = VisualNavigation(context, service)
    private var app: VisualApp? = null
    private var indexedFrame: VisualFrame? = null
    private var indexedKeys = emptyMap<String, VisualNode>()
    private var indexedKeypad = FirstExperienceCalculatorScript.Keypad(emptySet(), emptySet())
    var failure: String? = null
        private set
    private val script = FirstExperienceCalculatorScript(object : FirstExperienceCalculatorScript.Driver {
        override suspend fun clear() = clearScreen()
        override suspend fun press(entry: FirstExperienceCalculatorScript.Entry) = pressAndConfirm(entry)
    })

    private fun resolve(): VisualApp? {
        val installed = navigation.apps.filter { it.pkg in PACKAGES }
        val default = context.packageManager.resolveActivity(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALCULATOR), PackageManager.MATCH_DEFAULT_ONLY
        )?.activityInfo?.packageName
        return installed.firstOrNull { it.pkg == default } ?: installed.singleOrNull()
            ?: PACKAGES.firstNotNullOfOrNull { pkg -> installed.firstOrNull { it.pkg == pkg } }
    }

    suspend fun open(): Boolean {
        failure = null
        val calculator = app ?: resolve()?.also { app = it } ?: return false
        // Fixed local launch sequence. Resolve the installed app, show the real Home,
        // then launch that exact package rather than racing a launcher search UI.
        report("Перехожу на рабочий стол")
        if (!service.global(AccessibilityService.GLOBAL_ACTION_HOME) ||
            navigation.await(5_000L) { it.pkg in navigation.home } == null) return false
        delay(FirstExperienceTempo.BEFORE_ACTION)
        val intent = context.packageManager.getLaunchIntentForPackage(calculator.pkg) ?: return false
        if (intent.`package` != calculator.pkg && intent.component?.packageName != calculator.pkg) return false
        report("Открываю калькулятор")
        if (!navigation.launch(intent) || navigation.await(8_000L, ::ready) == null) return false
        // Readiness alone does not mean that the user has had time to see the app.
        delay(FirstExperienceTempo.BEFORE_ACTION)
        return service.frame(fresh = true)?.let(::ready) == true
    }

    private fun controls(frame: VisualFrame): Map<String, VisualNode> {
        if (indexedFrame === frame) return indexedKeys
        val candidates = frame.tree.mapNotNull { node ->
            val key = FirstExperienceMath.key(node.label, node.description, node.resource)
            if (key == null || node.editable || node.bounds.isEmpty || FirstExperienceMath.isDisplay(node.resource) ||
                !(node.clickable || node.role in setOf("Button", "ImageButton") ||
                    FirstExperienceMath.key("", "", node.resource) == key)) null else key to node
        }.groupBy({ it.first }, { it.second })
        indexedKeys = candidates.mapNotNull { (key, nodes) ->
            val first = nodes.minByOrNull { it.bounds.width().toLong() * it.bounds.height() } ?: return@mapNotNull null
            if (nodes.all { Rect.intersects(first.bounds, it.bounds) }) key to first else null
        }.toMap()
        indexedFrame = frame
        indexedKeypad = FirstExperienceCalculatorScript.Keypad(indexedKeys.keys, indexedKeys.filterValues { it.enabled }.keys)
        return indexedKeys
    }

    private fun button(frame: VisualFrame, key: String): VisualNode? {
        val controls = controls(frame)
        return controls[key]?.takeIf { indexedKeypad.canPress(key) }
    }

    // OEM calculators legitimately disable = or C after clearing. That is not an unknown layout.
    private fun safeFrame(frame: VisualFrame) = frame.pkg == app?.pkg && !frame.secure && !frame.hasPrivateFields &&
        frame.tree.any { FirstExperienceMath.isDisplay(it.resource) }

    private fun ready(frame: VisualFrame): Boolean {
        if (!safeFrame(frame)) return false
        controls(frame)
        return indexedKeypad.known
    }

    private fun expressions(frame: VisualFrame): List<String> = frame.tree.filter {
        FirstExperienceMath.isDisplay(it.resource) && (it.editable || FirstExperienceMath.isExpression(it.resource))
    }.mapNotNull { service.localText(frame, it) }

    private fun results(frame: VisualFrame): List<String> = frame.tree.filter {
        FirstExperienceMath.isDisplay(it.resource) && !it.editable && !FirstExperienceMath.isExpression(it.resource)
    }.mapNotNull { service.localText(frame, it) }

    private fun cleared(frame: VisualFrame): Boolean {
        if (!ready(frame)) return false
        // A stale live-preview result must not veto an empty editable formula.
        return FirstExperienceCalculatorScript.Display(expressions(frame), results(frame)).cleared
    }

    private fun matches(frame: VisualFrame, entry: FirstExperienceCalculatorScript.Entry): Boolean {
        if (!safeFrame(frame)) return false
        return FirstExperienceCalculatorScript.Display(expressions(frame), results(frame)).matches(entry)
    }

    private fun failed(entry: FirstExperienceCalculatorScript.Entry): Boolean {
        failure = if (entry.key == "=") "Калькулятор не подтвердил результат ${entry.result} после «=»."
            else "Калькулятор не подтвердил ввод «${entry.key}»."
        return false
    }

    private suspend fun clearScreen(): Boolean {
        val frame = navigation.await(3_000L, ::ready) ?: return false
        val target = button(frame, "clear")
        if (target == null) return cleared(frame)
        report("Очищаю калькулятор")
        if (!service.tap(frame, target)) return false
        delay(FirstExperienceTempo.KEY)
        return navigation.await(3_000L, ::cleared) != null
    }

    private suspend fun pressAndConfirm(entry: FirstExperienceCalculatorScript.Entry): Boolean {
        repeat(2) { attempt ->
            val frame = navigation.await(3_000L) { safeFrame(it) && button(it, entry.key) != null } ?: return failed(entry)
            val target = button(frame, entry.key) ?: return failed(entry)
            val tapped = service.tap(frame, target)
            // Refresh after the gesture instead of declaring failure during a transient OEM layout update.
            if (tapped) {
                if (entry.operator) {
                    // The real, identified operator was tapped. An OEM may retain only the left
                    // operand or render an operator span differently. Do not wait for literal N×,
                    // and never tap it twice. The next operand and = result remain mandatory.
                    delay(120L)
                    return if (navigation.await(1_500L, ::safeFrame) != null) true else failed(entry)
                }
                var consecutive = 0
                val confirmed = navigation.await(3_000L) { current ->
                    consecutive = if (matches(current, entry)) consecutive + 1 else 0
                    consecutive >= 2
                } != null
                if (confirmed) return true
            }
            if (attempt == 1 || entry.key == "=" || entry.operator) return failed(entry)
            val current = service.frame(fresh = true)?.takeIf(::safeFrame) ?: return failed(entry)
            val unchanged = if (entry.before.isEmpty()) cleared(current) else expressions(current).any {
                FirstExperienceMath.expression(it) == FirstExperienceMath.expression(entry.before)
            }
            // Retry once only when the old expression is positively still on screen.
            // Never repeat a key blindly or double an already entered digit/operator.
            if (!unchanged) return failed(entry)
            delay(FirstExperienceTempo.KEY)
        }
        return failed(entry)
    }

    suspend fun clear() = script.clear().also { if (!it) failure = "Калькулятор не подтвердил очистку поля ввода." }
    suspend fun calculate(step: FirstExperienceMath.Calculation) = script.calculate(step)

    private companion object {
        // These packages use native calculator controls. Unknown interfaces are skipped.
        val PACKAGES = listOf("com.sec.android.app.popupcalculator", "com.google.android.calculator", "com.android.calculator2",
            "com.miui.calculator", "com.huawei.calculator", "com.hihonor.calculator", "com.coloros.calculator",
            "com.oplus.calculator", "com.asus.calculator")
    }
}
