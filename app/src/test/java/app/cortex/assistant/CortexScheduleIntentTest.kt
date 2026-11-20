package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime

class CortexScheduleIntentTest {
    private val now = ZonedDateTime.parse("2026-11-15T01:00:00+03:00[Europe/Moscow]")

    @Test fun reminderKeepsTheTextAndUsesTheSpokenDelay() {
        val result = CortexScheduleIntent.parse("Кортекс, через десять минут напомни достать курицу", now)!!
        assertTrue(result.reminder)
        assertEquals("достать курицу", result.text)
        assertEquals(now.plusMinutes(10).toInstant().toEpochMilli(), result.time?.epoch)
    }

    @Test fun delayedMessageKeepsTheCommandForClarification() {
        val result = CortexScheduleIntent.parse("через полчаса напиши папе, что я буду дома", now)!!
        assertFalse(result.reminder)
        assertEquals("напиши папе, что я буду дома", result.text)
        assertEquals(now.plusMinutes(30).toInstant().toEpochMilli(), result.time?.epoch)
    }

    @Test fun tomorrowKeepsLocalTimeAndLetsTheUserFillInTheReminder() {
        val result = CortexScheduleIntent.parse("завтра в восемь утра напомни", now)!!
        assertEquals("", result.text)
        assertEquals(now.toLocalDate().plusDays(1).atTime(8, 0), result.time?.local)
    }

    @Test fun planningNeedsAnExplicitCommandAndFutureTime() {
        assertNull(CortexScheduleIntent.parse("Почему завтра в 8 выключится свет?", now))
        assertNull(CortexScheduleIntent.parse("Напомни через 0 минут проверить курицу", now)?.time)
        assertNull(CortexScheduleIntent.parse("Открой настройки", now))
    }

    @Test fun dottedOrDashedClockTimeKeepsMinutesOutOfTheText() {
        val dotted = CortexScheduleIntent.parse("напомни в 7.30 выпить таблетку", now)!!
        assertEquals("выпить таблетку", dotted.text)
        assertEquals(now.toLocalDate().atTime(7, 30), dotted.time?.local)
        val dashed = CortexScheduleIntent.parse("завтра в 19-05 напомни позвонить маме", now)!!
        assertEquals("позвонить маме", dashed.text)
        assertEquals(now.toLocalDate().plusDays(1).atTime(19, 5), dashed.time?.local)
    }

    @Test fun aCoupleOfMinutesIsTwoMinutes() {
        val result = CortexScheduleIntent.parse("напомни через пару минут выключить плиту", now)!!
        assertEquals("выключить плиту", result.text)
        assertEquals(now.toInstant().plusSeconds(120).toEpochMilli(), result.time?.epoch)
    }
}
