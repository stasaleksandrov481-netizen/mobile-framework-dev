package app.cortex.assistant

import org.json.JSONObject
import java.util.Locale

internal object CortexLocalCommands {
    private val verbs = "включи(?:ть)?|выключи(?:ть)?|отключи(?:ть)?|погаси(?:ть)?|открой|открыть|закрой|закрыть|" +
        "запусти(?:ть)?|сверни|свернуть|заблокируй|заблокировать|сфоткай|сфоткайся|сфотографируй|сфотографировать|" +
        "сделай|установи|поставь|убери|прибавь|убавь|уменьши|увеличь|переключи|проверь|покажи"
    private val separator = Regex("""\s*(?:[,;\n]+\s*(?:и\s+)?(?:потом\s+|затем\s+|после этого\s+)?|\s+(?:и\s+)?(?:потом|затем|после этого)\s+|\s+и\s+(?=(?:$verbs)\b))\s*""", RegexOption.IGNORE_CASE)
    private val unpunctuated = Regex("""\s+(?=(?:$verbs)\b)""", RegexOption.IGNORE_CASE)
    private val prefix = Regex("""^(?:(?:можешь(?:\s+мне)?|не мог бы ты|давай|нужно|надо|пожалуйста)[,\s]+)+""", RegexOption.IGNORE_CASE)
    private val infinitives = mapOf("включить" to "включи", "выключить" to "выключи", "отключить" to "отключи",
        "погасить" to "погаси", "открыть" to "открой", "закрыть" to "закрой", "запустить" to "запусти",
        "свернуть" to "сверни", "заблокировать" to "заблокируй", "сфотографировать" to "сфотографируй")
    private val volume = Regex("""(?:установи|поставь|сделай|измени) громкость (?:на )?(\d{1,3})(?:\s*(?:%|процент(?:а|ов)?))?""")
    private val store = Regex("""(?:найди|поищи|покажи|установи|скачай|открой)\s+(.+?)\s+в\s+(?:google play|play market|play маркет(?:е)?|плей маркет(?:е)?|гугл плее)""", RegexOption.IGNORE_CASE)
    private val launch = Regex("""(?:открой|запусти|включи приложение|перейди в|зайди в|open|launch) (?:мне )?(?:приложение )?(.{2,65})""")
    private val launchReversed = Regex("""(.{2,65}) (?:открой|открыть|запусти|запустить)""")
    private val dim = Regex("""(?:прибавь|увеличь|подними|повысь|убавь|уменьши|снизь|понизь) яркость(?: экрана)?(?: на (\d{1,3}) ?(?:%|процент(?:а|ов)?))?""")
    private val brightnessLevel = Regex("""(?:установи|поставь|сделай|измени) яркость(?: экрана)? (?:на )?(\d{1,3}) ?(?:%|процент(?:а|ов)?)?""")
    private val close = Regex("""(?:закрой|сверни|выйди из) (?:приложение |приложения )?(.{2,65})""")
    private val instruction = Regex("""^(?:как|почему|можно ли|что такое|зачем|объясни|подскажи как)\s""")
    private val cameraNames = setOf("камера", "камеру", "фотокамеру", "camera")
    private val spaces = Regex("""\s+""")

    fun parse(raw: String, resolveApp: (String) -> String?): List<JSONObject>? {
        val original = (CortexHotword.command(raw) ?: raw).trim().trimEnd('.', '!', '?').replaceFirst(prefix, "").trim()
            .replace(Regex("""^пожалуйста,?\s+|,?\s+пожалуйста$""", RegexOption.IGNORE_CASE), "")
        val request = normalized(original)
        if (request.isBlank() || instruction.containsMatchIn(request)) return null
        val parts = request.split(separator)
        if (parts.size == 1) {
            store.matchEntire(original)?.groupValues?.get(1)?.trim()?.takeIf { it.length in 1..100 }?.let {
                return listOf(command("play_store", "query" to it))
            }
        }
        val commands = parseParts(parts, resolveApp) ?: parts.flatMap { it.split(unpunctuated) }
            .takeIf { it != parts }?.let { parseParts(it, resolveApp) }
        return commands?.filterIndexed { index, step ->
            step.optString("kind") != "app" || step.optString("target") != "camera" ||
                commands.getOrNull(index + 1)?.optString("kind") != "capture_photo"
        }
    }

    private fun parseParts(parts: List<String>, resolveApp: (String) -> String?): List<JSONObject>? {
        if (parts.size !in 1..CortexActionSequence.MAX_STEPS) return null
        return parts.map { parseOne(it, resolveApp) ?: return null }
    }

    private fun parseOne(text: String, resolveApp: (String) -> String?): JSONObject? {
        val words = text.trim().trimEnd('.', '!', '?').replace(spaces, " ")
            .removePrefix("пожалуйста, ").removePrefix("пожалуйста ").removeSuffix(", пожалуйста")
            .removeSuffix(" пожалуйста").replace(Regex("""^яркость(?: экрана)? (прибавь|увеличь|убавь|уменьши)(?= |$)"""),
                "$1 яркость")
        val first = words.substringBefore(' ')
        val plain = (infinitives[first] ?: first) + words.substring(first.length)
        return when (plain) {
            "включи фонарик", "зажги фонарик" -> command("torch", "mode" to "on")
            "выключи фонарик", "погаси фонарик", "отключи фонарик" -> command("torch", "mode" to "off")
            "переключи фонарик" -> command("torch", "mode" to "toggle")
            "убери громкость", "выключи звук", "отключи звук", "убери звук", "поставь без звука" ->
                command("volume", "mode" to "mute", "stream" to "media")
            "прибавь громкость", "увеличь громкость", "прибавь звук", "сделай погромче" -> command("volume", "mode" to "up")
            "убавь громкость", "уменьши громкость", "убавь звук", "сделай потише" -> command("volume", "mode" to "down")
            "который час", "который сейчас час", "сколько сейчас времени", "сколько времени", "скажи время" ->
                command("read_device", "target" to "time")
            "сколько заряда", "сколько процентов заряда", "проверь заряд", "сколько заряда осталось", "покажи заряд" ->
                command("read_device", "target" to "battery")
            "проверь память телефона", "сколько свободного места", "сколько памяти на телефоне", "проверь хранилище" ->
                command("read_device", "target" to "storage")
            "проверь батарею", "проверь аккумулятор", "состояние батареи", "сколько процентов батареи" ->
                command("read_device", "target" to "battery")
            "какая версия android", "проверь версию android", "какой у меня телефон" ->
                command("read_device", "target" to "phone")
            "сверни приложения", "сверни приложение", "на главный экран", "открой рабочий стол", "сверни все приложения" ->
                command("home")
            "открой недавние", "покажи недавние приложения", "открой список окон" -> command("recents")
            "заблокируй экран", "заблокируй телефон", "погаси экран", "выключи экран", "отключи экран",
            "потуши экран" -> command("lock_screen")
            "сфоткай", "сфотографируй", "сделай фото", "сделай фотографию", "сделай снимок",
            "сфоткай на камеру", "сфотографируй на камеру" -> command("capture_photo")
            "сфоткайся", "сделай селфи" -> command("capture_photo", "lens" to "front")
            "открой настройки vpn", "включи vpn", "выключи vpn" -> command("settings", "target" to "vpn")
            "открой настройки wi-fi", "включи wi-fi", "выключи wi-fi", "включи вай фай", "выключи вай-фай" ->
                command("panel", "target" to "wifi")
            "открой настройки", "открой настройки телефона", "открой системные настройки", "зайди в настройки",
            "зайди в настройки телефона", "перейди в настройки", "настройки телефона открой" ->
                command("settings", "target" to "system")
            "сделай экран ярче", "сделай поярче", "прибавь яркости" -> command("brightness", "mode" to "up")
            "сделай экран темнее", "сделай потемнее", "убавь яркости" -> command("brightness", "mode" to "down")
            "какая яркость", "проверь яркость" -> command("brightness", "mode" to "status")
            "тг", "телега", "телеграм", "telegram" -> command("app", "target" to "telegram")
            "тт", "тикток", "tiktok" -> command("app", "target" to "tiktok")
            else -> {
                val level = volume.matchEntire(plain)?.groupValues?.get(1)?.toIntOrNull()
                if (level != null && level in 0..100) return command("volume", "mode" to "set", "level" to level)
                brightnessLevel.matchEntire(plain)?.groupValues?.get(1)?.toIntOrNull()?.let {
                    if (it in 1..100) return command("brightness", "mode" to "set", "level" to it)
                }
                dim.matchEntire(plain)?.let { match ->
                    val change = match.groupValues[1].toIntOrNull() ?: 10
                    val mode = if (first in setOf("убавь", "уменьши", "снизь", "понизь")) "down" else "up"
                    if (change in 1..100) return command("brightness", "mode" to mode, "level" to change)
                }
                close.matchEntire(plain)?.groupValues?.get(1)?.let { target ->
                    val app = resolveApp(target) ?: return null
                    return command("close_app", "target" to app)
                }
                val target = (launch.matchEntire(plain) ?: launchReversed.matchEntire(plain))
                    ?.groupValues?.get(1)?.trim('«', '»', '"') ?: return null
                if (target in cameraNames) return command("app", "target" to "camera")
                val app = resolveApp(target) ?: return null
                command("app", "target" to app)
            }
        }
    }

    private fun normalized(value: String) = value.lowercase(Locale.ROOT).replace('ё', 'е')

    private fun command(kind: String, vararg pairs: Pair<String, Any>) = JSONObject().put("kind", kind).apply {
        pairs.forEach { (name, value) -> put(name, value) }
    }
}
