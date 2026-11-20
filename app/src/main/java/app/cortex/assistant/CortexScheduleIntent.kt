package app.cortex.assistant

import java.time.LocalDateTime
import java.time.ZonedDateTime
import java.util.Locale

internal object CortexScheduleIntent {
    data class Time(val epoch: Long, val local: LocalDateTime? = null)
    data class Request(val reminder: Boolean, val text: String, val time: Time?)

    private val remind = Regex("""\b(?:напомни(?:ть|те)?)(?:\s+мне)?\b""", RegexOption.IGNORE_CASE)
    private val delay = Regex(
        """\b(?:через|спустя)\s+(?:(полчаса|полтора часа|четверть часа)|(\d{1,5}|[а-яё]+(?:\s+[а-яё]+)?)\s+(секунд\p{L}*|минут\p{L}*|час\p{L}*|день|дня|дней)\b|(секунду|минуту|час|день)\b)""",
        RegexOption.IGNORE_CASE
    )
    private val hourWords = "двадцать один|двадцать два|двадцать три|двадцать|девятнадцать|восемнадцать|семнадцать|" +
        "шестнадцать|пятнадцать|четырнадцать|тринадцать|двенадцать|одиннадцать|десять|девять|восемь|" +
        "семь|шесть|пять|четыре|три|два|один|ноль"
    // "7:30", "7.30" and "7-30" are all common written forms of the same time.
    private val clock = Regex(
        """\b(?:(сегодня|завтра|послезавтра)[,\s]+)?в\s+(\d{1,2}|$hourWords)(?:[:.\-](\d{2}))?\b(?:\s+(утра|дня|вечера|ночи)\b)?""",
        RegexOption.IGNORE_CASE
    )
    private val timePrefix = Regex("""^(?:через|спустя|сегодня|завтра|послезавтра)\b""", RegexOption.IGNORE_CASE)
    private val timeQuestion = Regex("""^(?:как|почему|можно ли|что будет)\s""", RegexOption.IGNORE_CASE)
    private val timedAction = Regex("""\b(?:открой|запусти|сверни|нажми|свайпни|введи|включи|выключи|заблокируй|напиши|отправь|установи|сделай|покажи|проверь|выполни|прибавь|убавь)\b""", RegexOption.IGNORE_CASE)
    private val prefix = Regex("""^(?:(?:кортекс|cortex)[,\s]+)?(?:(?:пожалуйста|можешь|не мог бы ты)[,\s]+)?""", RegexOption.IGNORE_CASE)
    private val units = mapOf(
        "ноль" to 0, "один" to 1, "одну" to 1, "одна" to 1, "два" to 2, "две" to 2, "три" to 3,
        "четыре" to 4, "пять" to 5, "шесть" to 6, "семь" to 7, "восемь" to 8, "девять" to 9,
        "десять" to 10, "одиннадцать" to 11, "двенадцать" to 12, "тринадцать" to 13,
        "четырнадцать" to 14, "пятнадцать" to 15, "шестнадцать" to 16, "семнадцать" to 17,
        "восемнадцать" to 18, "девятнадцать" to 19, "двадцать" to 20, "тридцать" to 30,
        "сорок" to 40, "пятьдесят" to 50, "шестьдесят" to 60
    )

    fun parse(raw: String, now: ZonedDateTime = ZonedDateTime.now()): Request? {
        val input = clean(raw.replace(prefix, ""))
        if (timeQuestion.containsMatchIn(input)) return null
        val reminder = remind.containsMatchIn(input)
        val timing = findTime(input, now, reminder)
        if (!reminder && (!timedAction.containsMatchIn(input) || (timing == null && !timePrefix.containsMatchIn(input)))) return null
        val content = timing?.first?.let { input.removeRange(it.range) } ?: input
        val text = clean(if (reminder) content.replaceFirst(remind, "") else content)
            .replace(Regex("""^(?:мне\s+|о том,\s*что\s+|чтобы\s+)""", RegexOption.IGNORE_CASE), "")
        return Request(reminder, clean(text), timing?.second)
    }

    fun time(raw: String, now: ZonedDateTime = ZonedDateTime.now()): Time? = findTime(raw, now, true)?.second

    private fun findTime(text: String, now: ZonedDateTime, reminder: Boolean): Pair<MatchResult, Time?>? {
        val relative = delay.find(text)
        if (relative != null) {
            val words = relative.groupValues.map { it.lowercase(Locale.ROOT) }
            val seconds = when (words[1]) {
                "полчаса" -> 1800L
                "полтора часа" -> 5400L
                "четверть часа" -> 900L
                else -> {
                    val amount = if (words[4].isEmpty()) number(words[2]) else 1
                    val unit = words[3].ifEmpty { words[4] }
                    (amount ?: 0) * when {
                        unit.startsWith("секунд") -> 1L
                        unit.startsWith("минут") -> 60L
                        unit.startsWith("час") -> 3600L
                        else -> 86_400L
                    }
                }
            }
            return relative to seconds.takeIf { it in 1..31_536_000L }?.let {
                Time(now.toInstant().plusSeconds(it).toEpochMilli())
            }
        }
        val absolute = clock.find(text) ?: return null
        val (day, hour, minute, part) = absolute.destructured
        if (day.isBlank() && !reminder && absolute.range.first != 0) return null
        val value = number(hour.lowercase(Locale.ROOT)) ?: return absolute to null
        val hours = when (part.lowercase(Locale.ROOT)) {
            "утра", "ночи" -> if (value == 12) 0 else value
            "дня", "вечера" -> if (value in 1..11) value + 12 else value
            else -> value
        }
        val minutes = minute.toIntOrNull() ?: 0
        if (hours !in 0..23 || minutes !in 0..59) return absolute to null
        val date = now.toLocalDate().plusDays(when (day.lowercase(Locale.ROOT)) {
            "завтра" -> 1
            "послезавтра" -> 2
            else -> 0
        })
        var local = date.atTime(hours, minutes)
        if (day.isBlank() && !local.isAfter(now.toLocalDateTime())) local = local.plusDays(1)
        val epoch = local.atZone(now.zone).toInstant().toEpochMilli()
        return absolute to if (epoch > now.toInstant().toEpochMilli()) Time(epoch, local) else null
    }

    private fun number(value: String): Int? {
        val parts = value.split(Regex("""\s+"""))
        return value.toIntOrNull() ?: parts.map { units[it] ?: return null }.sum()
    }

    private fun clean(value: String) = value.trim { it.isWhitespace() || it in ",.!?" }.replace(Regex("""\s{2,}"""), " ")
}
