package app.cortex.assistant

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** UI protocol fixtures, not a claim that a physical Samsung was tested. */
class FirstExperienceOperatorTest {
    private enum class DisplayMode { HIDDEN_PENDING_OPERATOR, CURRENT_OPERAND, FORMATTED_FORMULA, GENERIC_DISPLAY }

    private class Calculator(private val mode: DisplayMode) : FirstExperienceCalculatorScript.Driver {
        val keys = mutableListOf<String>()
        val operatorDisplays = mutableListOf<String>()
        val answers = mutableListOf<Int>()
        var dropOperator = false
        var wrongAnswer = false
        private var formula = ""
        private var calculated = false
        private val binary = Regex("([0-9]+)([×÷+−])([0-9]*)")
        override suspend fun clear(): Boolean { formula = ""; calculated = false; return true }

        private fun display(): String {
            val parts = binary.matchEntire(formula)
            return when (mode) {
                DisplayMode.HIDDEN_PENDING_OPERATOR -> if (parts != null && parts.groupValues[3].isEmpty()) parts.groupValues[1] else formula
                DisplayMode.CURRENT_OPERAND, DisplayMode.GENERIC_DISPLAY -> parts?.groupValues?.get(3)?.ifEmpty { parts.groupValues[1] } ?: formula
                DisplayMode.FORMATTED_FORMULA -> formula.replace("×", "\u200b✕\uFE0F\u2060")
                    .replace("÷", "\uFEFF／\u200b").replace("+", "＋").replace("−", "－")
            }
        }

        override suspend fun press(entry: FirstExperienceCalculatorScript.Entry): Boolean {
            keys += entry.key
            if (entry.key == "=") {
                val parts = binary.matchEntire(formula) ?: return false
                val a = parts.groupValues[1].toInt()
                val b = parts.groupValues[3].toIntOrNull() ?: return false
                val answer = when (parts.groupValues[2]) { "×" -> a * b; "÷" -> a / b; "+" -> a + b; else -> a - b }
                formula = (if (wrongAnswer) answer + 1 else answer).toString()
                answers += formula.toInt()
                calculated = true
            } else if (entry.operator) {
                if (!dropOperator) formula += entry.key
                calculated = false
                operatorDisplays += display()
                // A dispatched real operator does not require an inline textual echo.
                return true
            } else {
                if (calculated) formula = ""
                calculated = false
                formula += entry.key
            }
            val shown = display()
            val actual = if (mode == DisplayMode.GENERIC_DISPLAY)
                FirstExperienceCalculatorScript.Display(emptyList(), listOf(shown))
                else FirstExperienceCalculatorScript.Display(listOf(shown), emptyList())
            return actual.matches(entry)
        }
    }

    @Test fun `a hidden pending multiplication does not stop before the second operand`() = runBlocking {
        val driver = Calculator(DisplayMode.HIDDEN_PENDING_OPERATOR)
        val script = FirstExperienceCalculatorScript(driver) { }
        assertTrue(script.clear())
        assertTrue(script.calculate(FirstExperienceMath.example))
        assertEquals(listOf("84"), driver.operatorDisplays)
        assertEquals(listOf("8", "4", "×", "7", "="), driver.keys)
        assertEquals(listOf(588), driver.answers)
    }

    @Test fun `all 99 predictions complete when the display shows only the current operand`() = runBlocking {
        for (mode in listOf(DisplayMode.CURRENT_OPERAND, DisplayMode.GENERIC_DISPLAY)) {
            for (number in 1..99) {
                val driver = Calculator(mode)
                val script = FirstExperienceCalculatorScript(driver) { }
                assertTrue(script.clear())
                assertTrue("$mode $number", FirstExperienceMath.performPrediction(number) { _, calculation -> script.calculate(calculation) })
                assertEquals(listOf(number * 2, number * 2 + 10, number + 5, 5), driver.answers)
            }
        }
    }

    @Test fun `zero width formatting and alternative operator glyphs preserve full formula acknowledgement`() = runBlocking {
        val driver = Calculator(DisplayMode.FORMATTED_FORMULA)
        val script = FirstExperienceCalculatorScript(driver) { }
        assertTrue(script.clear())
        assertTrue(script.calculate(FirstExperienceMath.example))
        assertTrue(script.clear())
        assertTrue(FirstExperienceMath.performPrediction(17) { _, calculation -> script.calculate(calculation) })
        assertEquals(listOf(588, 34, 44, 22, 5), driver.answers)
        assertEquals("84*7", FirstExperienceMath.expression("84\u200b✕\uFE0F\u20607"))
        assertNull(FirstExperienceMath.displayedInteger("84\u200b✕7"))
    }

    @Test fun `accepted gesture without a working operator cannot pass as a calculation`() = runBlocking {
        val driver = Calculator(DisplayMode.CURRENT_OPERAND).apply { dropOperator = true }
        val script = FirstExperienceCalculatorScript(driver) { }
        assertTrue(script.clear())
        assertFalse(script.calculate(FirstExperienceMath.example))
        assertEquals(listOf("8", "4", "×", "7"), driver.keys)
        assertTrue(driver.answers.isEmpty())
    }

    @Test fun `wrong equality result still blocks prediction and later operations`() = runBlocking {
        val driver = Calculator(DisplayMode.CURRENT_OPERAND).apply { wrongAnswer = true }
        val script = FirstExperienceCalculatorScript(driver) { }
        assertTrue(script.clear())
        assertFalse(FirstExperienceMath.performPrediction(17) { _, calculation -> script.calculate(calculation) })
        assertEquals(listOf(35), driver.answers)
        assertEquals(1, driver.keys.count { it == "=" })
        assertFalse("+" in driver.keys)
    }
}
