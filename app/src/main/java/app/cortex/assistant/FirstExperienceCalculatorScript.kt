package app.cortex.assistant

import kotlinx.coroutines.delay

/** Fixed real key sequences. Only equality results, never an OEM's formula serialization, advance calculations. */
internal class FirstExperienceCalculatorScript(
    private val driver: Driver,
    private val pause: suspend (Long) -> Unit = { delay(it) }
) {
    data class Entry(val key: String, val before: String, val expression: String?, val result: Int?) {
        val operator get() = key in setOf("×", "÷", "+", "−")
    }
    data class Keypad(val identified: Set<String>, val enabled: Set<String>) {
        // OEM calculators often do not expose C/AC until a value is entered.
        // A fully identified numeric/operator keypad is usable with a blank display.
        val known get() = identified.containsAll(FirstExperienceMath.keys - "clear")
        fun canPress(key: String) = key in enabled
    }
    data class Display(val expressions: List<String>, val results: List<String>) {
        val cleared get() = expressions.ifEmpty { results }.let { values ->
            values.isNotEmpty() && values.all(FirstExperienceMath::cleared)
        }
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
        val continuing = calculation.keys.firstOrNull() in setOf("+", "−", "×", "÷")
        val prefix = if (continuing) {
            val confirmed = previousResult ?: return false
            // Start from the last VERIFIED result explicitly. OEMs differ in what = leaves editable.
            if (!driver.clear()) { previousResult = null; return false }
            confirmed.toString().map(Char::toString)
        } else emptyList()
        var expression = ""
        pause(FirstExperienceTempo.BEFORE_ACTION)
        for (key in prefix + calculation.keys) {
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
