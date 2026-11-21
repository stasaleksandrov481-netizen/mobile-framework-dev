package app.cortex.assistant

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CortexSchedulePolicyTest {
    @Test fun rejectedAlarmLeavesThePreviousRecordAndAlarmAlone() {
        val calls = mutableListOf<String>()
        val result = CortexSchedulePolicy.install(
            arm = { calls.add("arm"); CortexSchedulePolicy.Alarm.UNAVAILABLE },
            save = { error("Must not persist an unusable edit") },
            cancelReplacement = { calls.add("cancel replacement") },
            cancelPrevious = { error("Must keep the previous alarm") }
        )
        assertEquals(CortexSchedulePolicy.Installation.AlarmFailed, result)
        assertEquals(listOf("arm", "cancel replacement"), calls)
    }

    @Test fun failedCommitCancelsOnlyTheCandidate() {
        val calls = mutableListOf<String>()
        val result = CortexSchedulePolicy.install(
            arm = { calls.add("arm"); CortexSchedulePolicy.Alarm.EXACT },
            save = { calls.add("save"); false },
            cancelReplacement = { calls.add("cancel replacement") },
            cancelPrevious = { error("Must keep the previous alarm") }
        )
        assertEquals(CortexSchedulePolicy.Installation.StorageFailed, result)
        assertEquals(listOf("arm", "save", "cancel replacement"), calls)
    }

    @Test fun committedReplacementCancelsTheOldAlarmAndReportsFallback() {
        val calls = mutableListOf<String>()
        val result = CortexSchedulePolicy.install(
            arm = { calls.add("arm"); CortexSchedulePolicy.Alarm.INEXACT },
            save = { calls.add("save"); true },
            cancelReplacement = { error("The committed alarm must remain active") },
            cancelPrevious = { calls.add("cancel previous") }
        )
        assertEquals(CortexSchedulePolicy.Installation.Saved(CortexSchedulePolicy.Alarm.INEXACT), result)
        assertEquals(listOf("arm", "save", "cancel previous"), calls)
    }

    @Test fun dailyRecurrenceKeepsTheLocalHourAcrossDaylightSavingTime() {
        val zone = ZoneId.of("Europe/Berlin")
        val previous = LocalDateTime.parse("2026-03-28T08:00")
        val now = Instant.parse("2026-03-28T07:00:00Z")
        val next = CortexSchedulePolicy.nextLocal(previous, "daily", now, zone)!!
        assertEquals(LocalDateTime.parse("2026-03-29T08:00"), next)
        assertEquals(Instant.parse("2026-03-29T06:00:00Z"), next.atZone(zone).toInstant())
    }

    @Test fun weeklyRecoverySkipsMissedOccurrencesButKeepsTheWeekday() {
        val zone = ZoneId.of("Europe/Moscow")
        val previous = LocalDateTime.parse("2026-05-04T08:00")
        val now = Instant.parse("2026-05-26T05:00:00Z")
        assertEquals(LocalDateTime.parse("2026-06-01T08:00"), CortexSchedulePolicy.nextLocal(previous, "weekly", now, zone))
        assertNull(CortexSchedulePolicy.nextLocal(previous, "none", now, zone))
    }
}
