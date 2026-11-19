package app.cortex.assistant

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException

/** Drives the installed calculator through fresh accessibility nodes and visible gestures. */
internal class FirstExperienceCalculator(
    private val context: Context,
    private val service: CortexScreenService,
    private val report: (String) -> Unit,
    installedCalculator: VisualApp? = null,
    private val pause: suspend (Long) -> Unit = { delay(it) }
) {
    private val navigation = VisualNavigation(context, service)
    private var app: VisualApp? = installedCalculator
    private var indexedFrame: VisualFrame? = null
    private var indexedKeys = emptyMap<String, VisualNode>()
    private var indexedKeypad = FirstExperienceCalculatorScript.Keypad(emptySet(), emptySet())
    var failure: String? = null
        private set
    private val script = FirstExperienceCalculatorScript(object : FirstExperienceCalculatorScript.Driver {
        override suspend fun clear() = clearScreen()
        override suspend fun press(entry: FirstExperienceCalculatorScript.Entry) = pressAndConfirm(entry)
    }, pause)

    private fun resolve(): VisualApp? {
        val manager = context.packageManager
        val category = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALCULATOR)
        // The standard calculator category is more reliable than hard-coded
        // Samsung/Google/Xiaomi package names on vivo, OPPO and other OEMs.
        val categoryApps = manager.queryIntentActivities(category, 0).mapNotNull { activity ->
            val pkg = activity.activityInfo.packageName
            if (pkg == context.packageName || manager.getLaunchIntentForPackage(pkg) == null) null
            else VisualApp(activity.loadLabel(manager).toString(), pkg)
        }.distinctBy { it.pkg }
        val preferred = manager.resolveActivity(category, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
        categoryApps.firstOrNull { it.pkg == preferred }?.let { return it }
        if (categoryApps.size == 1) return categoryApps.single()
        // Some OEMs do not advertise CATEGORY_APP_CALCULATOR at all.
        // Prefer a uniquely identified launchable calculator; never guess an app.
        val installed = navigation.apps.filter { candidate ->
            candidate.pkg in PACKAGES || VisualLabels.normalize(candidate.label) in CALCULATOR_NAMES
        }
        installed.firstOrNull { it.pkg == preferred }?.let { return it }
        return installed.singleOrNull() ?: installed.singleOrNull { it.pkg in PACKAGES }
    }

    suspend fun open(): Boolean {
        failure = null
        val calculator = app ?: resolve()?.also { app = it } ?: run {
            failure = "На телефоне не найден калькулятор, который Android разрешает запустить."
            return false
        }
        // Fixed local launch sequence. Resolve the installed app, show the real Home,
        // then launch that exact package rather than racing a launcher search UI.
        report("Перехожу на рабочий стол")
        if (!service.global(AccessibilityService.GLOBAL_ACTION_HOME) ||
            navigation.await(5_000L) { it.pkg in navigation.home } == null) return false
        pause(FirstExperienceTempo.BEFORE_ACTION)
        val intent = context.packageManager.getLaunchIntentForPackage(calculator.pkg) ?: return false
        if (intent.`package` != calculator.pkg && intent.component?.packageName != calculator.pkg) return false
        report("Открываю калькулятор")
        if (!navigation.launch(intent) || navigation.await(8_000L, ::ready) == null) return false
        // Readiness alone does not mean that the user has had time to see the app.
        pause(FirstExperienceTempo.BEFORE_ACTION)
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
        (frame.tree.any { FirstExperienceMath.isDisplay(it.resource) } || inferredDisplays(frame).isNotEmpty())

    private fun inferredDisplays(frame: VisualFrame): List<VisualNode> {
        val keys = controls(frame).values
        if (keys.size < 12) return emptyList()
        val keypadTop = keys.minOfOrNull { it.bounds.top } ?: return emptyList()
        // A text field above a fully identified keypad is a candidate display
        // even when the OEM exposes an unfamiliar resource ID.
        return frame.tree.filter { node ->
            val resource = node.resource.substringAfterLast('/').lowercase()
            val text = service.localText(frame, node).orEmpty()
            val numeric = text.isBlank() || FirstExperienceReadback.integer(text) != null ||
                FirstExperienceMath.formula(text).matches(Regex("""[0-9.+*/-]{1,40}"""))
            !node.clickable && !node.scrollable &&
                (node.role in setOf("TextView", "EditText", "TextInputEditText") ||
                    node.role.endsWith("TextView") || node.role.endsWith("Display")) &&
                !node.bounds.isEmpty && node.bounds.bottom <= keypadTop &&
                node.bounds.width() >= frame.bounds.width() * .18f &&
                node.bounds.top > frame.bounds.top + frame.bounds.height() * .06f &&
                !resource.contains("history") &&
                !resource.contains("preview") && !resource.contains("trace") &&
                numeric
        }.take(3)
    }

    private fun ready(frame: VisualFrame): Boolean {
        if (!safeFrame(frame)) return false
        controls(frame)
        return indexedKeypad.known
    }

    private fun expressions(frame: VisualFrame): List<String> = displayFields(frame).filter {
        it.second == FirstExperienceReadback.Role.PRIMARY
    }.mapNotNull { service.localText(frame, it.first) }

    private fun results(frame: VisualFrame): List<String> = displayFields(frame).filter {
        it.second != FirstExperienceReadback.Role.PRIMARY
    }.mapNotNull { service.localText(frame, it.first) }

    private fun cleared(frame: VisualFrame): Boolean {
        if (!ready(frame)) return false
        // A stale live-preview result must not veto an empty editable formula.
        return FirstExperienceCalculatorScript.Display(expressions(frame), results(frame)).cleared
    }

    private fun displayFields(frame: VisualFrame): List<Pair<VisualNode, FirstExperienceReadback.Role>> {
        val identified = frame.tree.filter { FirstExperienceMath.isDisplay(it.resource) }
        val inferred = inferredDisplays(frame).filter { node ->
            identified.none { it.path == node.path }
        }
        val fields = identified + inferred
        val hasFormula = fields.any { it.editable || FirstExperienceMath.isExpression(it.resource) }
        return fields.map { node -> node to when {
            node.resource.substringAfterLast('/') == "result_final" -> FirstExperienceReadback.Role.FINAL
            node in inferred -> FirstExperienceReadback.Role.PRIMARY
            node.editable || FirstExperienceMath.isExpression(node.resource) || !hasFormula && inferred.isEmpty() ->
                FirstExperienceReadback.Role.PRIMARY
            else -> FirstExperienceReadback.Role.PREVIEW
        } }
    }

    private fun confirmed(frame: VisualFrame, expected: Int): Boolean {
        if (!safeFrame(frame)) return false
        val values = displayFields(frame).map { (node, role) ->
            FirstExperienceReadback.Value(role, service.localText(frame, node).orEmpty())
        }
        return FirstExperienceReadback.confirmed(values, expected)
    }

    private suspend fun confirmResult(expected: Int): Boolean {
        // Allow the calculator's equality animation/state transition to complete first.
        delay(450L)
        var consecutive = 0
        if (navigation.await(3_000L) { frame ->
                consecutive = if (confirmed(frame, expected)) consecutive + 1 else 0
                consecutive >= 2
            } != null) return true
        // Some OEM display spans do not expose their rendered value as accessible text.
        // Read only recognized display rectangles; never search the keypad/history for a 5.
        var matchingCaptures = 0
        repeat(4) {
            val frame = service.frame(fresh = true)?.takeIf(::safeFrame) ?: return false
            val keys = controls(frame).values
            val regions = FirstExperienceReadback.resultFields(displayFields(frame)).filter { (node, _) ->
                !node.bounds.isEmpty &&
                    keys.none { Rect.intersects(it.bounds, node.bounds) }
            }.take(2)
            var matched = false
            for ((node, _) in regions) {
                val text = try { service.readCalculatorRegion(frame, node.bounds) }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { null }
                if (FirstExperienceReadback.integer(text.orEmpty()) == expected) { matched = true; break }
                delay(500L)
            }
            matchingCaptures = if (matched) matchingCaptures + 1 else 0
            if (matchingCaptures >= 2) return true
            delay(500L)
        }
        return false
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
        pause(FirstExperienceTempo.KEY)
        return navigation.await(3_000L, ::cleared) != null
    }

    private suspend fun pressAndConfirm(entry: FirstExperienceCalculatorScript.Entry): Boolean {
        val frame = navigation.await(3_000L) { safeFrame(it) && button(it, entry.key) != null } ?: return failed(entry)
        val target = button(frame, entry.key) ?: return failed(entry)
        if (!service.tap(frame, target)) return failed(entry)
        if (entry.key == "=") return if (entry.result != null && confirmResult(entry.result)) true else failed(entry)
        // A real, identity-checked gesture is the input acknowledgement. A serialized
        // expression is not an OEM-independent protocol. Never retry digits/operators blindly.
        pause(120L)
        return if (navigation.await(1_500L, ::safeFrame) != null) true else failed(entry)
    }

    suspend fun clear() = script.clear().also { if (!it) failure = "Калькулятор не подтвердил очистку поля ввода." }
    suspend fun calculate(step: FirstExperienceMath.Calculation) = script.calculate(step)

    private companion object {
        val CALCULATOR_NAMES = setOf("calculator", "калькулятор", "calculadora", "calculatrice", "rechner", "calcolatrice")
        val PACKAGES = setOf("com.sec.android.app.popupcalculator", "com.google.android.calculator", "com.android.calculator2",
            "com.miui.calculator", "com.huawei.calculator", "com.hihonor.calculator", "com.coloros.calculator",
            "com.oplus.calculator", "com.asus.calculator", "com.vivo.calculator", "com.vivo.calculator2",
            "com.bbk.calculator", "com.iqoo.calculator")
    }
}
