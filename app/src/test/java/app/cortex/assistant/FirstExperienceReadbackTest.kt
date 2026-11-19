package app.cortex.assistant

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class FirstExperienceReadbackTest {
    private fun value(role: FirstExperienceReadback.Role, text: String) = FirstExperienceReadback.Value(role, text)
    private val primary = FirstExperienceReadback.Role.PRIMARY
    private val final = FirstExperienceReadback.Role.FINAL
    private val preview = FirstExperienceReadback.Role.PREVIEW

    @Test fun `localized descriptions and formatting are accepted only as whole numeric results`() {
        for (text in listOf("588", "= 588", "Результат: 588", "Result: 588", "Равно \u200e588\u200f"))
            assertEquals(text, 588, FirstExperienceReadback.integer(text))
        for (text in listOf("84 × 7", "Нажмите 5", "Кнопка 5", "Результат будет 5", "5 сообщений", "5+0"))
            assertNull(text, FirstExperienceReadback.integer(text))
    }

    @Test fun `preview does not confirm equality and a final result overrides an old primary value`() {
        assertFalse(FirstExperienceReadback.confirmed(listOf(value(primary, "84×7"), value(preview, "588")), 588))
        assertTrue(FirstExperienceReadback.confirmed(listOf(value(primary, "84×7"), value(final, "588")), 588))
        assertFalse(FirstExperienceReadback.confirmed(listOf(value(primary, "5"), value(final, "6")), 5))
        assertFalse(FirstExperienceReadback.confirmed(listOf(value(primary, "5"), value(final, "")), 5))
        assertFalse(FirstExperienceReadback.confirmed(listOf(value(primary, "5"), value(final, "Вычисляю")), 5))
        assertFalse(FirstExperienceReadback.confirmed(listOf(value(primary, "5"), value(primary, "6")), 5))
        assertFalse(FirstExperienceReadback.confirmed(listOf(value(primary, "5"), value(primary, "3+3")), 5))
        assertFalse(FirstExperienceReadback.confirmed(emptyList(), 5))
    }

    @Test fun `pixel readback never falls back from a visible final field to a stale primary or preview`() {
        assertEquals(listOf("final" to final), FirstExperienceReadback.resultFields(
            listOf("old" to primary, "preview" to preview, "final" to final)))
        assertEquals(listOf("primary" to primary), FirstExperienceReadback.resultFields(
            listOf("primary" to primary, "preview" to preview)))
        assertTrue(FirstExperienceReadback.resultFields(listOf("preview" to preview)).isEmpty())
    }

    @Test fun `each chained operation clears and reenters the previously confirmed result`() = runBlocking {
        val formulas = mutableListOf<String>()
        var formula = ""
        var clears = 0
        val driver = object : FirstExperienceCalculatorScript.Driver {
            override suspend fun clear(): Boolean { clears++; formula = ""; return true }
            override suspend fun press(entry: FirstExperienceCalculatorScript.Entry): Boolean {
                if (entry.key != "=") { formula += entry.key; return true }
                formulas += formula
                val parts = Regex("(\\d+)([×÷+−])(\\d+)").matchEntire(formula) ?: return false
                val a = parts.groupValues[1].toInt()
                val b = parts.groupValues[3].toInt()
                val answer = when (parts.groupValues[2]) { "×" -> a * b; "÷" -> a / b; "+" -> a + b; else -> a - b }
                // This UI erases its expression after =; continuation cannot depend on that state.
                formula = ""
                return FirstExperienceReadback.confirmed(listOf(value(final, answer.toString())), requireNotNull(entry.result))
            }
        }
        val script = FirstExperienceCalculatorScript(driver) { }
        assertTrue(script.clear())
        assertTrue(FirstExperienceMath.performPrediction(17) { _, calculation -> script.calculate(calculation) })
        assertEquals(listOf("17×2", "34+10", "44÷2", "22−17"), formulas)
        assertEquals(4, clears)
    }
}
