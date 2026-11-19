package app.cortex.assistant

import kotlinx.coroutines.delay

/** A fixed script; the driver must acknowledge the real screen after every key. */
internal class FirstExperienceCalculatorScript(
    private val driver: Driver,
    private val pause: suspend (Long) -> Unit = { delay(it) }
) {
    data class Entry(val key: String, val before: String, val expression: String?, val result: Int?)
    data class Keypad(val identified: Set<String>, val enabled: Set<String>) {
        val known get() = identified.containsAll(FirstExperienceMath.keys)
        fun canPress(key: String) = key in enabled
    }
    data class Display(val expressions: List<String>, val results: List<String>) {
        val cleared get() = expressions.ifEmpty { results }.let { values ->
            values.isNotEmpty() && values.all(FirstExperienceMath::cleared)
        }
        fun matches(entry: Entry) = entry.expression?.let { expected -> expressions.any {
            FirstExperienceMath.expression(it) == FirstExperienceMath.expression(expected)
        } } ?: (expressions + results).any { FirstExperienceMath.displayedInteger(it) == entry.result }
    }
    interface Driver {
        suspend fun clear(): Boolean
        suspend fun press(entry: Entry): Boolean
    }

    private var previousResult: Int? = null

    suspend fun clear(): Boolean {
        previousResult = null
        return driver.clear()
    }

    suspend fun calculate(calculation: FirstExperienceMath.Calculation): Boolean {
        var expression = if (calculation.keys.firstOrNull() in setOf("+", "−", "×", "÷"))
            previousResult?.toString() ?: return false else ""
        pause(FirstExperienceTempo.BEFORE_ACTION)
        for (key in calculation.keys) {
            val before = expression
            if (key != "=") expression += key
            val entry = Entry(key, before, if (key == "=") null else expression,
                if (key == "=") calculation.result else null)
            if (!driver.press(entry)) { previousResult = null; return false }
            if (key != "=") pause(FirstExperienceTempo.KEY)
        }
        previousResult = calculation.result
        pause(FirstExperienceTempo.RESULT)
        return true
    }
}
