package app.cortex.assistant

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/** Drives the installed calculator through fresh accessibility nodes and visible gestures. */
internal class FirstExperienceCalculator(
    private val context: Context,
    private val service: CortexScreenService,
    private val report: (String) -> Unit
) {
    private val navigation = VisualNavigation(context, service)
    private var app: VisualApp? = null

    private fun resolve(): VisualApp? {
        val installed = navigation.apps.filter { it.pkg in PACKAGES }
        val default = context.packageManager.resolveActivity(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALCULATOR), PackageManager.MATCH_DEFAULT_ONLY
        )?.activityInfo?.packageName
        return installed.firstOrNull { it.pkg == default } ?: installed.singleOrNull()
            ?: PACKAGES.firstNotNullOfOrNull { pkg -> installed.firstOrNull { it.pkg == pkg } }
    }

    suspend fun open(): Boolean {
        val calculator = app ?: resolve()?.also { app = it } ?: return false
        report("Открываю калькулятор")
        // The shared launcher walker checks each page; the demo has a much shorter budget.
        val opened = withTimeoutOrNull(18_000L) { navigation.open(calculator, report, visual = true) } == true
        return opened && navigation.await(4_000L) { ready(it) } != null
    }

    private fun button(frame: VisualFrame, key: String): VisualNode? {
        val candidates = frame.tree.filter { node ->
            node.enabled && !node.editable && !node.bounds.isEmpty &&
                !FirstExperienceMath.isDisplay(node.resource) &&
                (node.clickable || node.role in setOf("Button", "ImageButton") ||
                    FirstExperienceMath.key("", "", node.resource) == key) &&
                FirstExperienceMath.key(node.label, node.description, node.resource) == key
        }
        val first = candidates.minByOrNull { it.bounds.width().toLong() * it.bounds.height() } ?: return null
        return first.takeIf { candidates.all { other -> Rect.intersects(first.bounds, other.bounds) } }
    }

    private fun ready(frame: VisualFrame) = frame.pkg == app?.pkg && !frame.secure && !frame.hasPrivateFields &&
        FirstExperienceMath.keys.all { button(frame, it) != null } && frame.tree.any { FirstExperienceMath.isDisplay(it.resource) }

    private fun displays(frame: VisualFrame): List<String> = frame.tree.filter {
        FirstExperienceMath.isDisplay(it.resource)
    }.mapNotNull { service.localText(frame, it) }

    private suspend fun press(key: String): Boolean {
        val frame = navigation.await(1_500L, ::ready) ?: return false
        val target = button(frame, key) ?: return false
        if (!service.tap(frame, target)) return false
        delay(210L) // The real key press and expression remain visible, including on fast devices.
        return service.frame(fresh = true)?.let(::ready) == true
    }

    suspend fun clear(): Boolean {
        if (!press("clear")) return false
        return navigation.await(1_500L) { frame ->
            ready(frame) && displays(frame).let { values -> values.isNotEmpty() && values.all {
                it.isBlank() || FirstExperienceMath.displayedInteger(it) == 0
            } }
        } != null
    }

    suspend fun calculate(step: FirstExperienceMath.Calculation): Boolean {
        for (key in step.keys) if (!press(key)) return false
        var consecutive = 0
        val result = navigation.await(2_500L) { frame ->
            val matches = ready(frame) && displays(frame).any { FirstExperienceMath.displayedInteger(it) == step.result }
            consecutive = if (matches) consecutive + 1 else 0
            consecutive >= 2
        } != null
        if (result) delay(750L)
        return result
    }

    private companion object {
        // These packages use native calculator controls. Unknown interfaces are skipped.
        val PACKAGES = listOf("com.sec.android.app.popupcalculator", "com.google.android.calculator", "com.android.calculator2",
            "com.miui.calculator", "com.huawei.calculator", "com.hihonor.calculator", "com.coloros.calculator",
            "com.oplus.calculator", "com.asus.calculator")
    }
}
