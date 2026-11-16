package app.cortex.assistant

import android.content.Context
import org.json.JSONObject
import java.util.Locale

/** Strict, offline appearance commands for voice requests made to the island. */
internal object IslandAppearanceCommands {
    private val noun = Regex("""(?:^|[^а-яё])(?:островок|островка|островке|островку|островком|капсула|капсулу|капсулы|капсуле)(?:$|[^а-яё])""")
    private val verb = Regex("""^(?:кортекс[, ]*)?(?:пожалуйста[, ]*)?(?:уменьши|увеличь|сделай|сдвинь|подвинь|перемести|верни|сбрось|восстанови|включи|выключи|покажи|скрой|убери|добавь|поставь|настрой|измени)(?![а-яё])""")

    fun apply(context: Context, text: String): String? {
        val command = text.lowercase(Locale.ROOT).trim().replace(Regex("""\s+"""), " ")
        if (command.length > 180 || '?' in command || !noun.containsMatchIn(command) || !verb.containsMatchIn(command)) return null
        val prefs = context.getSharedPreferences("cortex-display", Context.MODE_PRIVATE)
        val style = runCatching { JSONObject(prefs.getString("island-style", "{}").orEmpty()) }.getOrDefault(JSONObject())
        val percentage = Regex("""(\d{2,3})\s*%""").find(command)?.groupValues?.get(1)?.toIntOrNull()
        val feedback: String

        when {
            Regex("""^(?:кортекс[, ]*)?(?:пожалуйста[, ]*)?(?:сбрось|восстанови|верни)""").containsMatchIn(command) &&
                Regex("""стандарт|исходн|по умолчанию|как было""").containsMatchIn(command) -> {
                prefs.edit().putString("island-style", "{}").putBoolean("island-command-sync", true).apply()
                CortexIslandService.send(context, CortexIslandService.ACTION_ENSURE)
                return "Вернул стандартное оформление островка."
            }
            Regex("""прогресс|статус|результат|смайлик|символ""").containsMatchIn(command) -> {
                val key = when {
                    "прогресс" in command -> "progress"
                    "статус" in command -> "status"
                    "результат" in command -> "results"
                    else -> "face"
                }
                val enabled = when {
                    Regex("""выключи|убери|скрой""").containsMatchIn(command) -> false
                    Regex("""включи|добавь|покажи""").containsMatchIn(command) -> true
                    else -> return null
                }
                style.put(key, enabled)
                feedback = (if (enabled) "Включил " else "Выключил ") +
                    mapOf("progress" to "прогресс", "status" to "статус", "results" to "показ результатов", "face" to "символ").getValue(key) + " островка."
            }
            Regex("""рамк|границ""").containsMatchIn(command) -> {
                val show = when {
                    Regex("""убери|скрой""").containsMatchIn(command) -> false
                    Regex("""включи|добавь|покажи|верни""").containsMatchIn(command) -> true
                    else -> return null
                }
                style.put("borderWidth", if (show) .65 else 0.0)
                feedback = if (show) "Вернул рамку островка." else "Убрал рамку островка."
            }
            Regex("""сдвинь|подвинь|перемести|левее|правее|ниже|выше""").containsMatchIn(command) -> {
                val (key, change, description) = when {
                    Regex("""влево|левее""").containsMatchIn(command) -> Triple("offsetX", -12.0, "влево")
                    Regex("""вправо|правее""").containsMatchIn(command) -> Triple("offsetX", 12.0, "вправо")
                    Regex("""вниз|ниже""").containsMatchIn(command) -> Triple("offsetY", 12.0, "ниже")
                    Regex("""вверх|выше""").containsMatchIn(command) -> Triple("offsetY", -12.0, "выше")
                    else -> return null
                }
                val min = if (key == "offsetX") -75.0 else 0.0
                val max = if (key == "offsetX") 75.0 else 80.0
                val position = style.optDouble(key, 0.0).takeIf(Double::isFinite) ?: 0.0
                style.put(key, (position + change).coerceIn(min, max))
                feedback = "Сдвинул островок $description."
            }
            Regex("""прозрачн|непрозрачн""").containsMatchIn(command) -> {
                val previous = style.optDouble("opacity", 96.0).takeIf(Double::isFinite) ?: 96.0
                val next = when {
                    percentage != null && percentage in 40..100 -> percentage.toDouble()
                    Regex("""прозрачнее|уменьши|более прозрачн""").containsMatchIn(command) -> previous - 15
                    Regex("""менее прозрачн|увеличь|непрозрачн""").containsMatchIn(command) -> previous + 15
                    else -> return null
                }.coerceIn(40.0, 100.0)
                style.put("opacity", next)
                feedback = "Непрозрачность островка: ${next.toInt()}%."
            }
            Regex("""черн|чёрн|темн|тёмн|графит|бел|светл""").containsMatchIn(command) -> {
                val light = Regex("""бел|светл""").containsMatchIn(command)
                val colors = if (light) listOf("#e7e7e7", "#161616", "#555555", "#363636", "#777777")
                else listOf("#080808", "#ffffff", "#c6c6c6", "#ffffff", "#ffffff")
                listOf("background", "text", "border", "accent", "faceColor").forEachIndexed { index, key ->
                    style.put(key, colors[index])
                }
                feedback = if (light) "Выбрал светлый островок." else "Выбрал тёмный островок."
            }
            else -> {
                val smaller = Regex("""уменьши|меньше|поменьше|уже|пониже""").containsMatchIn(command)
                val larger = Regex("""увеличь|больше|побольше|шире""").containsMatchIn(command)
                if (!smaller && !larger && percentage == null) return null
                val key = when {
                    Regex("""ширин|уже|шире""").containsMatchIn(command) -> "widthScale"
                    Regex("""высот|пониже""").containsMatchIn(command) -> "heightScale"
                    else -> "size"
                }
                val min = if (key == "heightScale") 90.0 else 80.0
                if (percentage != null && percentage !in min.toInt()..125) return "Размер островка можно настроить от ${min.toInt()}% до 125%."
                val previous = style.optDouble(key, 100.0).takeIf(Double::isFinite) ?: 100.0
                val next = percentage?.toDouble() ?: (previous + (if (smaller) -10 else 10)).coerceIn(min, 125.0)
                style.put(key, next)
                val name = when (key) { "widthScale" -> "Ширина"; "heightScale" -> "Высота"; else -> "Масштаб" }
                feedback = "$name островка: ${next.toInt()}%."
            }
        }
        prefs.edit().putString("island-style", style.toString()).putBoolean("island-command-sync", true).apply()
        CortexIslandService.send(context, CortexIslandService.ACTION_ENSURE)
        return feedback
    }
}
