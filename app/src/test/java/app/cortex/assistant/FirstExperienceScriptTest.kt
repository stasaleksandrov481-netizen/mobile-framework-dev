package app.cortex.assistant

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class FirstExperienceScriptTest {
    @Test fun `a recognized empty Samsung keypad may disable equals and clear`() {
        val all = FirstExperienceMath.keys.toSet()
        val keypad = FirstExperienceCalculatorScript.Keypad(all, all - setOf("=", "clear"))
        assertTrue(keypad.known)
        assertTrue(keypad.canPress("8"))
        assertFalse(keypad.canPress("="))
        assertFalse(keypad.canPress("clear"))
        assertFalse(FirstExperienceCalculatorScript.Keypad(all - "−", all).known)
    }

    @Test fun `hidden clear key does not disqualify an otherwise valid OEM keypad`() {
        val controls = FirstExperienceMath.keys.toSet() - "clear"
        val keypad = FirstExperienceCalculatorScript.Keypad(controls, controls - "=")
        assertTrue(keypad.known)
        assertFalse(keypad.canPress("="))
        assertFalse(FirstExperienceCalculatorScript.Keypad(controls - "8", controls).known)
    }

    @Test fun `native brightness fast ramp is monotonic and restores original value`() = runBlocking {
        var actual = 128
        val values = mutableListOf<Int>()
        val waits = mutableListOf<Long>()
        val forward = FirstExperienceTempo.brightnessRampFast(128, 200, { actual = it; values += it; true },
            { waits += it })
        assertTrue(forward)
        assertEquals(200, actual)
        assertEquals(1080L, waits.sum())
        assertTrue(values.zipWithNext().all { (a, b) -> b >= a })
        assertTrue(values.size <= 24)
        assertTrue(FirstExperienceTempo.brightnessRampFast(200, 128, { actual = it; true }, { }))
        assertEquals(128, actual)
    }

    @Test fun `native brightness fast ramp stops on a rejected write`() = runBlocking {
        var attempts = 0
        assertFalse(FirstExperienceTempo.brightnessRampFast(128, 200, { ++attempts < 5 }, { }))
        assertEquals(5, attempts)
        attempts = 0
        var pauses = 0
        val cancelled = runCatching {
            FirstExperienceTempo.brightnessRampFast(128, 200, { attempts++; true }, {
                if (++pauses == 3) throw CancellationException("Stopped")
            })
        }.exceptionOrNull()
        assertTrue(cancelled is CancellationException)
        assertTrue(attempts <= 2)
    }

    @Test fun `an empty primary display wins over an old live preview after C`() {
        assertTrue(FirstExperienceCalculatorScript.Display(listOf(""), listOf("588")).cleared)
        assertTrue(FirstExperienceCalculatorScript.Display(listOf("\u200e\u200f"), emptyList()).cleared)
        assertTrue(FirstExperienceCalculatorScript.Display(listOf("0"), emptyList()).cleared)
        assertFalse(FirstExperienceCalculatorScript.Display(listOf("84"), listOf("0")).cleared)
        assertFalse(FirstExperienceCalculatorScript.Display(emptyList(), emptyList()).cleared)
        assertFalse(FirstExperienceCalculatorScript.Display(listOf("Поле ввода"), emptyList()).cleared)
    }

    @Test fun `only the actual equality value can confirm a calculation`() {
        val primary = FirstExperienceReadback.Role.PRIMARY
        assertFalse(FirstExperienceReadback.confirmed(listOf(FirstExperienceReadback.Value(primary, "84×7")), 588))
        assertFalse(FirstExperienceReadback.confirmed(listOf(FirstExperienceReadback.Value(primary, "587")), 588))
        assertTrue(FirstExperienceReadback.confirmed(listOf(FirstExperienceReadback.Value(primary, "588")), 588))
    }

    private class Calculator : FirstExperienceCalculatorScript.Driver {
        val entries = mutableListOf<FirstExperienceCalculatorScript.Entry>()
        val answers = mutableListOf<Int>()
        var display = ""
        var failAt: String? = null
        override suspend fun clear(): Boolean { display = ""; return true }
        override suspend fun press(entry: FirstExperienceCalculatorScript.Entry): Boolean {
            entries += entry
            if (entry.key == failAt) return false
            if (entry.key == "=") {
                val parts = Regex("(\\d+)([×÷+−])(\\d+)").matchEntire(display) ?: return false
                val a = parts.groupValues[1].toInt()
                val b = parts.groupValues[3].toInt()
                val answer = when (parts.groupValues[2]) { "×" -> a * b; "÷" -> a / b; "+" -> a + b; else -> a - b }
                answers += answer
                display = answer.toString()
            } else {
                if (entry.before.isEmpty()) display = ""
                display += entry.key
            }
            return entry.key != "=" || FirstExperienceReadback.confirmed(
                listOf(FirstExperienceReadback.Value(FirstExperienceReadback.Role.PRIMARY, display)), requireNotNull(entry.result))
        }
    }

    @Test fun `example remains visible with a two second preparation and held result`() = runBlocking {
        val driver = Calculator()
        val waits = mutableListOf<Long>()
        val script = FirstExperienceCalculatorScript(driver) { waits += it }
        assertTrue(script.clear())
        assertTrue(script.calculate(FirstExperienceMath.example))
        assertEquals(listOf("8", "4", "×", "7", "="), driver.entries.map { it.key })
        assertEquals(listOf(588), driver.answers)
        assertEquals(2_000L, waits.first())
        assertTrue(waits.drop(1).dropLast(1).all { it >= 600L })
        assertTrue(waits.last() >= 2_000L)
    }

    @Test fun `all number choices run four independent acknowledged and paced calculations`() = runBlocking {
        for (number in 1..99) {
            val driver = Calculator()
            val waits = mutableListOf<Long>()
            val script = FirstExperienceCalculatorScript(driver) { waits += it }
            assertTrue(script.clear())
            assertTrue(FirstExperienceMath.performPrediction(number) { _, calculation -> script.calculate(calculation) })
            assertEquals(listOf(number * 2, number * 2 + 10, number + 5, 5), driver.answers)
            assertEquals(4, waits.count { it == FirstExperienceTempo.BEFORE_ACTION })
            assertEquals(4, waits.count { it == FirstExperienceTempo.RESULT })
        }
    }

    @Test fun `a failed key does not race ahead and a fresh clear can recover prediction`() = runBlocking {
        val driver = Calculator().apply { failAt = "4" }
        val script = FirstExperienceCalculatorScript(driver) { }
        script.clear()
        assertFalse(script.calculate(FirstExperienceMath.example))
        assertEquals(listOf("8", "4"), driver.entries.map { it.key })
        assertTrue(driver.answers.isEmpty())
        assertFalse(script.calculate(FirstExperienceMath.prediction(17)[1]))
        driver.failAt = null
        assertTrue(script.clear())
        assertTrue(FirstExperienceMath.performPrediction(17) { _, calculation -> script.calculate(calculation) })
        assertEquals(listOf(34, 44, 22, 5), driver.answers)
    }

    @Test fun `Stop during a visible pause sends no later keys`() = runBlocking {
        val driver = Calculator()
        var pauses = 0
        val script = FirstExperienceCalculatorScript(driver) { if (++pauses == 2) throw CancellationException("Stop") }
        assertTrue(runCatching { script.calculate(FirstExperienceMath.example) }.exceptionOrNull() is CancellationException)
        assertEquals(listOf("8"), driver.entries.map { it.key })
    }

    @Test fun `hidden clear key does not disqualify an otherwise complete OEM keypad`() {
        val keys = FirstExperienceMath.keys.toSet() - "clear"
        assertTrue(FirstExperienceCalculatorScript.Keypad(keys, keys).known)
        assertFalse(FirstExperienceCalculatorScript.Keypad(keys - "=", keys - "=").known)
    }

    @Test fun `fast native brightness ramp is bounded monotonic and cancellable`() = runBlocking {
        for ((start, target) in listOf(120 to 185, 230 to 100)) {
            val writes = mutableListOf<Int>()
            val pauses = mutableListOf<Long>()
            assertTrue(FirstExperienceTempo.brightnessRampFast(start, target, { writes += it; true }, { pauses += it }))
            assertEquals(24, pauses.size)
            assertEquals(1_080L, pauses.sum())
            assertEquals(target, writes.last())
            assertTrue(writes.zipWithNext().all { (a, b) -> if (target > start) b >= a else b <= a })
        }
        var writes = 0
        assertFalse(FirstExperienceTempo.brightnessRampFast(120, 190, { ++writes < 4 }, { }))
        assertEquals(4, writes)
        var ticks = 0
        val error = runCatching {
            FirstExperienceTempo.brightnessRampFast(120, 190, { true }, {
                if (++ticks == 3) throw CancellationException("Stop")
            })
        }.exceptionOrNull()
        assertTrue(error is CancellationException)
    }

    @Test fun `brightness moves in sixty small monotonic steps over 2200ms each way`() = runBlocking {
        for ((start, target) in listOf(.35f to .57f, .85f to .63f)) {
            val values = mutableListOf<Float>()
            val waits = mutableListOf<Long>()
            assertTrue(FirstExperienceTempo.brightnessRamp(start, target, { values += it; true }, { waits += it }))
            assertEquals(60, values.size)
            assertEquals(2_200L, waits.sum())
            assertEquals(target, values.last(), .00001f)
            assertTrue(values.zipWithNext().all { (a, b) -> if (target > start) b >= a else b <= a })
            assertTrue(values.zipWithNext().all { (a, b) -> kotlin.math.abs(b - a) < .006f })
        }
    }

    @Test fun `brightness failure or cancellation cannot schedule later setting writes`() = runBlocking {
        var writes = 0
        assertFalse(FirstExperienceTempo.brightnessRamp(.4f, .62f, { ++writes < 4 }, { }))
        assertEquals(4, writes)
        writes = 0
        var pauses = 0
        val error = runCatching {
            FirstExperienceTempo.brightnessRamp(.4f, .62f, { writes++; true }, {
                if (++pauses == 4) throw CancellationException("Stop")
            })
        }.exceptionOrNull()
        assertTrue(error is CancellationException)
        assertEquals(3, writes)
    }

    @Test fun `small eased steps do not fail when an integer SeekBar is already at that value`() = runBlocking {
        var actual = 35f
        var actions = 0
        val completed = FirstExperienceTempo.brightnessRamp(.35f, .57f, { fraction ->
            FirstExperienceTempo.setProgress(actual, fraction * 100f, integral = true) { value ->
                actions++
                // Android may return false if an ACTION_SET_PROGRESS changes nothing.
                if (actual == value) false else { actual = value; true }
            }
        }, { })
        assertTrue(completed)
        assertEquals(57f, actual, 0f)
        assertEquals(22, actions)
        assertFalse(FirstExperienceTempo.setProgress(35f, 36f, true) { false })
    }
}
