package app.cortex.assistant

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

internal object CortexSchedulePolicy {
    enum class Alarm { EXACT, INEXACT, UNAVAILABLE }
    sealed interface Installation {
        data class Saved(val alarm: Alarm) : Installation
        data object AlarmFailed : Installation
        data object StorageFailed : Installation
    }

    /** A replacement alarm has its own identity. Keep the old one until storage commits. */
    fun install(arm: () -> Alarm, save: () -> Boolean, cancelReplacement: () -> Unit,
                cancelPrevious: () -> Unit): Installation {
        val alarm = arm()
        if (alarm == Alarm.UNAVAILABLE) {
            cancelReplacement()
            return Installation.AlarmFailed
        }
        if (!save()) {
            cancelReplacement()
            return Installation.StorageFailed
        }
        cancelPrevious()
        return Installation.Saved(alarm)
    }

    fun nextLocal(previous: LocalDateTime, repeat: String, now: Instant, zone: ZoneId): LocalDateTime? {
        val interval = when (repeat) { "daily" -> 1L; "weekly" -> 7L; else -> return null }
        val days = ChronoUnit.DAYS.between(previous.toLocalDate(), now.atZone(zone).toLocalDate())
        val periods = (days / interval).coerceAtLeast(1)
        val candidate = previous.plusDays(periods * interval)
        return if (candidate.atZone(zone).toInstant().isAfter(now)) candidate else candidate.plusDays(interval)
    }
}
