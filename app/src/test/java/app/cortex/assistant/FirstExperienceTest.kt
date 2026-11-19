package app.cortex.assistant

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class FirstExperienceTest {
    @Test fun `all 99 choices produce correct visible intermediate results`() {
        for (number in 1..99) {
            val script = FirstExperienceMath.prediction(number)
            assertEquals(listOf(number * 2, number * 2 + 10, number + 5, 5), script.map { it.result })
            assertEquals(number.toString().map(Char::toString) + listOf("×", "2", "="), script[0].keys)
            assertEquals(listOf("+", "1", "0", "="), script[1].keys)
            assertEquals(listOf("÷", "2", "="), script[2].keys)
            assertEquals(listOf("−") + number.toString().map(Char::toString) + "=", script[3].keys)
        }
    }

    @Test fun `invalid numbers cannot start prediction`() {
        for (number in listOf(Int.MIN_VALUE, -1, 0, 100, Int.MAX_VALUE)) {
            assertTrue(runCatching { FirstExperienceMath.prediction(number) }.exceptionOrNull() is IllegalArgumentException)
        }
    }

    @Test fun `a failed real calculation stops the script before revealing any prediction`() = runBlocking {
        val calls = mutableListOf<Int>()
        val confirmed = FirstExperienceMath.performPrediction(17) { index, _ -> calls += index; index != 1 }
        assertFalse(confirmed)
        assertEquals(listOf(0, 1), calls)
    }

    @Test fun `cancellation performs no subsequent calculator steps`() = runBlocking {
        val calls = mutableListOf<Int>()
        val error = runCatching {
            FirstExperienceMath.performPrediction(99) { index, _ ->
                calls += index
                if (index == 1) throw CancellationException("Stop")
                true
            }
        }.exceptionOrNull()
        assertTrue(error is CancellationException)
        assertEquals(listOf(0, 1), calls)
    }

    @Test fun `prediction requires all four real confirmations`() = runBlocking {
        val results = mutableListOf<Int>()
        assertTrue(FirstExperienceMath.performPrediction(1) { _, calculation -> results += calculation.result; true })
        assertEquals(listOf(2, 12, 6, 5), results)
    }

    @Test fun `controls require exact recognized labels or resource IDs`() {
        assertEquals("8", FirstExperienceMath.key("8", "", ""))
        assertEquals("8", FirstExperienceMath.key("", "", "com.sec.android.app.popupcalculator:id/bt_08"))
        assertEquals("×", FirstExperienceMath.key("", "Умножить", "com.google.android.calculator:id/op_mul"))
        assertEquals("clear", FirstExperienceMath.key("AC", "", ""))
        assertNull(FirstExperienceMath.key("7", "", "calculator:id/digit_8"))
        assertNull(FirstExperienceMath.key("Открыть 8 файлов", "", ""))
        assertNull(FirstExperienceMath.key("Купить", "", ""))
        assertNull(FirstExperienceMath.key("", "", "unknown:id/search"))
    }

    @Test fun `history and preview cannot pass as a recognized result display`() {
        assertTrue(FirstExperienceMath.isDisplay("calculator:id/result_final"))
        assertTrue(FirstExperienceMath.isDisplay("calculator:id/calc_edt_formula"))
        assertFalse(FirstExperienceMath.isDisplay("calculator:id/history_result"))
        assertFalse(FirstExperienceMath.isDisplay("calculator:id/result_preview"))
        assertFalse(FirstExperienceMath.isDisplay("calculator:id/advertisement"))
    }

    @Test fun `only complete displayed integers pass result verification`() {
        assertEquals(588, FirstExperienceMath.displayedInteger("= 588"))
        assertEquals(5, FirstExperienceMath.displayedInteger("\u200e5,00\u200f"))
        assertEquals(1_234, FirstExperienceMath.displayedInteger("1\u202f234"))
        for (text in listOf("17 × 2", "5.1", "5+0", "Ответ 5", "5 рекламных сообщений", "", "999999999999999999999999")) {
            assertNull(text, FirstExperienceMath.displayedInteger(text))
        }
    }

    @Test fun `OEM glyphs in nonstandard calculator display are normalized for recognition`() {
        assertEquals("84*7", FirstExperienceMath.expression("84 ⨯ 7"))
        assertEquals("44/2", FirstExperienceMath.expression("44 : 2"))
        assertEquals("588", FirstExperienceMath.expression("588"))
        assertNull(FirstExperienceMath.displayedInteger("84 ⨯ 7"))
        assertNull(FirstExperienceMath.displayedInteger("44 : 2"))
    }

    @Test fun `brightness target remains visible and changes all possible starting levels`() {
        for (level in 0..1_000) {
            val original = level / 1_000f
            val target = FirstExperienceMath.brightnessTarget(original)
            assertTrue(target >= .35f && target <= .85f)
            assertTrue(kotlin.math.abs(target - original) >= .19f)
        }
        for (invalid in listOf(Float.NaN, Float.POSITIVE_INFINITY, -.1f, 1.1f)) {
            assertTrue(runCatching { FirstExperienceMath.brightnessTarget(invalid) }.isFailure)
        }
    }

    private class Settings : FirstExperienceRecovery.SettingsAccess {
        var actualMode = 0
        var actualLevel = 170
        var actualAdjustment: String? = "0.5"
        var failLevel = false
        var lieAboutLevel = false
        val writes = mutableListOf<String>()
        override fun mode(value: Int): Boolean { writes += "mode:$value"; actualMode = value; return true }
        override fun mode() = actualMode
        override fun level(value: Int): Boolean {
            writes += "level:$value"
            if (failLevel) throw SecurityException("Permission revoked")
            if (!lieAboutLevel) actualLevel = value
            return true
        }
        override fun level() = actualLevel
        override fun adjustment(value: String): Boolean { writes += "adjustment:$value"; actualAdjustment = value; return true }
        override fun adjustment() = actualAdjustment
    }

    @Test fun `restore preserves exact brightness and auto mode in the correct order`() {
        val settings = Settings()
        assertTrue(FirstExperienceRecovery.restore(FirstExperienceRecovery.Saved(42, 1, "-0.25"), settings))
        assertEquals(42, settings.actualLevel)
        assertEquals(1, settings.actualMode)
        assertEquals("-0.25", settings.actualAdjustment)
        assertEquals(listOf("mode:0", "level:42", "adjustment:-0.25", "mode:1"), settings.writes)
    }

    @Test fun `restore still attempts original auto mode when an earlier setting throws`() {
        val settings = Settings().apply { failLevel = true }
        assertFalse(FirstExperienceRecovery.restore(FirstExperienceRecovery.Saved(42, 1, "-0.25"), settings))
        assertEquals(1, settings.actualMode)
        assertEquals("mode:1", settings.writes.last())
    }

    @Test fun `a lying settings provider does not count as successful restoration`() {
        val settings = Settings().apply { lieAboutLevel = true }
        assertFalse(FirstExperienceRecovery.restore(FirstExperienceRecovery.Saved(42, 1, null), settings))
        assertEquals("mode:1", settings.writes.last())
    }

    @Test fun `unchanged adaptive bias needs no optional OEM setting write`() {
        val settings = Settings()
        assertTrue(FirstExperienceRecovery.restore(FirstExperienceRecovery.Saved(42, 1, "0.5"), settings))
        assertEquals(listOf("mode:0", "level:42", "mode:1"), settings.writes)
    }

    @Test fun `unknown saved values trigger no system writes`() {
        val settings = Settings()
        assertFalse(FirstExperienceRecovery.restore(FirstExperienceRecovery.Saved(-1, 1, null), settings))
        assertFalse(FirstExperienceRecovery.restore(FirstExperienceRecovery.Saved(42, 7, null), settings))
        assertTrue(settings.writes.isEmpty())
    }
}
