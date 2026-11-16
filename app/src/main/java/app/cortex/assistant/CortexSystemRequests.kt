package app.cortex.assistant

import org.json.JSONObject

internal object CortexSystemRequests {
    private val refreshChange = Regex(
        """(?:включи|включить|установи|поставь|сделай|переключи|подними|снизь|выставь) (?:частоту (?:обновления )?(?:экрана )?(?:на |до )?|(?:экран |дисплей )?на |мне )?(\d{2,3})\s*(?:гц|герц(?:а)?|hz)(?: (?:на )?(?:телефоне|экране|дисплее))?"""
    )
    private val settings = Regex(
        """(?:открой|покажи|найди|зайди в|перейди в) (?:(?:раздел|настройки|параметры)(?: и (?:раздел|пункт))? )?[«"]?(.+?)[»"]?(?: в настройках| на телефоне)?"""
    )
    private val toggle = Regex("""(включи|выключи|отключи|активируй|деактивируй) (.+)""")
    private val read = Regex(
        """(?:(?:проверь|покажи|скажи|узнай)(?: какая| какой| какие)?|какая|какой|какое|какие|какова|включен[ао]? ли|включен[ао]?|работает ли) (.+?)(?: сейчас| у меня| на телефоне| на моем телефоне)?"""
    )

    private val sections = mapOf(
        "display" to setOf("экран", "экрана", "дисплей", "дисплея", "плавность движений", "частоту обновления"),
        "sound" to setOf("звук", "звука", "громкости", "звуки и вибрация", "звуки и вибрацию"),
        "wifi" to setOf("wi-fi", "wi fi", "wifi", "вайфай", "вай-фай", "вай фай"),
        "bluetooth" to setOf("bluetooth", "блютуз", "блютус", "блютуза"),
        "mobile" to setOf("мобильную сеть", "мобильной сети", "мобильные данные", "мобильных данных", "сотовую сеть", "сим карты", "sim-карты"),
        "airplane" to setOf("авиарежим", "режим полета", "режима полета", "режим в самолете"),
        "location" to setOf("геолокацию", "геолокация", "геолокации", "местоположение", "местоположения", "gps"),
        "nfc" to setOf("nfc", "нфс"),
        "battery_saver" to setOf("батарея", "батареи", "аккумулятора", "энергосбережение", "энергосбережения", "режим экономии заряда"),
        "storage" to setOf("память телефона", "хранилище", "хранилища", "внутреннюю память"),
        "date" to setOf("дату и время", "дата и время", "даты и времени"),
        "language" to setOf("язык системы", "языка", "язык телефона", "язык и регион"),
        "accessibility" to setOf("специальные возможности", "специальных возможностей", "спецвозможности"),
        "apps" to setOf("приложения", "приложений", "список приложений"),
        "about" to setOf("о телефоне", "сведения о телефоне", "информацию об устройстве", "об устройстве"),
        "security" to setOf("безопасность", "безопасности", "конфиденциальность", "конфиденциальности", "блокировку экрана"),
        "notifications" to setOf("уведомления", "уведомлений", "уведомлений cortex", "уведомлений кортекса"),
        "keyboard" to setOf("клавиатуру", "клавиатуры", "способ ввода"), "vpn" to setOf("vpn", "впн"),
        "ringtone" to setOf("рингтон", "настройки рингтона", "мелодию звонка", "мелодию вызова", "звук звонка"),
        "dnd" to setOf("не беспокоить", "режим не беспокоить"),
        "cast" to setOf("трансляцию экрана", "беспроводной дисплей", "smart view"),
        "night_light" to setOf("ночной свет", "ночной режим экрана", "защиту зрения", "фильтр синего света")
    )
    private val streamLabel = """(?: (музыки|медиа|мультимедиа|звонка|рингтона|будильника|уведомлений|разговора))?"""
    private val volumeStatus = Regex("""(?:какая|проверь|покажи|скажи) громкость$streamLabel""")
    private val volumeSet = Regex("""(?:сделай|выставь|установи|поставь|измени) громкость$streamLabel (?:на |до )?(\d{1,3}|половину|максимум|минимум)\s*(?:%|процент\p{L}*)?""")
    private val volumeStep = Regex("""(прибавь|увеличь|подними|уменьши|убавь|снизь) громкость$streamLabel(?: на (\d{1,3})\s*(?:%|процент\p{L}*)?)?""")
    private val volumeMute = Regex("""(включи|выключи|отключи|верни|убери) (?:звук|громкость)$streamLabel""")
    private val timeout = Regex("""(?:измени|выставь|поставь|сделай|установи) (?:тайм-аут экрана|таймаут экрана|время до выключения экрана|автоблокировку экрана)(?: на| через)? (\d{1,4})\s*(сек\p{L}*|мин\p{L}*)""")
    private val quotedName = """(?:«([^»]+)»|"([^"]+)")"""
    private val fileName = Regex("""(?:создай|добавь) (?:пустой |текстовый )?(?:файл|документ) $quotedName""", RegexOption.IGNORE_CASE)
    private val contact = Regex("""(?:создай|добавь) контакт $quotedName(?: (?:с номером|номер) (\+?[0-9 ()-]{5,22}))?""", RegexOption.IGNORE_CASE)
    private val appAlert = Regex("""(?:открой|покажи) (?:настройки )?уведомления (?:приложения )?(.{2,65})""", RegexOption.IGNORE_CASE)
    private val rotation = setOf("автоповорот", "автоповорот экрана", "автоматический поворот")
    private val brightness = setOf("автояркость", "автоматическую яркость", "адаптивную яркость")
    private val diagnostics = mapOf(
        "phone" to setOf("версия android", "версию android", "версия андроид", "версию андроид", "версия андроида",
            "версию андроида", "андроид", "модель", "модель телефона", "у меня телефон", "у меня андроид", "марка телефона", "система", "прошивка"),
        "refresh" to setOf("герцовка", "герцовку", "частота обновления", "частоту обновления", "частота обновления экрана",
            "частоту обновления экрана", "частота экрана", "частоту экрана", "частота дисплея", "герц", "гц"),
        "network" to setOf("сеть", "интернет", "подключение", "тип подключения", "соединение", "впн", "vpn"),
        "wifi" to sections.getValue("wifi"),
        "airplane" to sections.getValue("airplane"), "location" to sections.getValue("location"),
        "battery_saver" to (sections.getValue("battery_saver") - setOf("батарея", "батареи", "аккумулятора")),
        "storage" to sections.getValue("storage"), "battery" to setOf("батарею", "батарея", "батареи", "заряд", "заряд батареи"),
        "rotate" to rotation, "ringer" to setOf("звуковой режим", "режим звука", "режим звонка"),
        "locale" to setOf("язык системы", "язык телефона"),
        "screen_timeout" to setOf("тайм-аут экрана", "таймаут экрана", "время до выключения экрана"),
        "ringtone" to setOf("рингтон", "мелодия звонка", "мелодия вызова"),
        "dnd" to sections.getValue("dnd")
    )
    private val switchPages = setOf("bluetooth", "mobile", "airplane", "location", "nfc", "battery_saver", "night_light", "dnd", "vpn")
    private val nestedSettings = Regex("""(?:открой|зайди в) настройки (?:и |→ |/ )?(?:открой |зайди в )?(?:раздел )?[«"]?(.+?)[»"]?""")
    private val diagnoseRefresh = Regex("""сколько (?:сейчас )?(?:герц|гц)(?: (?:на (?:экране|дисплее)|выдает (?:экран|дисплей)))?""")

    fun parsePayload(text: String, resolveApp: (String) -> String?): JSONObject? {
        fileName.matchEntire(text)?.let { match ->
            val name = name(match).takeIf { it.length in 1..100 && it.none { c -> c in "/\\:" || c.isISOControl() } }
                ?: return command("file_create", "title" to "")
            return command("file_create", "title" to name)
        }
        contact.matchEntire(text)?.let { match ->
            val name = name(match).take(100)
            val raw = match.groupValues[3]
            val number = raw.filter { it.isDigit() || it == '+' }
            if (name.isBlank() || raw.isNotEmpty() && number.count(Char::isDigit) !in 5..15) {
                return command("contact_insert", "invalid" to true)
            }
            return command("contact_insert", "name" to name, "number" to number)
        }
        appAlert.matchEntire(text)?.let { match ->
            val pkg = resolveApp(match.groupValues[1].trim('«', '»', '"'))
                ?: return command("app_notifications", "target" to "")
            return command("app_notifications", "target" to pkg)
        }
        return null
    }

    private fun name(match: MatchResult) = match.groupValues[1].ifEmpty { match.groupValues[2] }.trim()

    private fun stream(label: String) = when (label) {
        "звонка", "рингтона" -> "ring"
        "будильника" -> "alarm"
        "уведомлений" -> "notification"
        "разговора" -> "call"
        else -> "media"
    }

    fun parse(text: String): JSONObject? {
        volumeStatus.matchEntire(text)?.let { return command("volume", "mode" to "status", "stream" to stream(it.groupValues[1])) }
        volumeSet.matchEntire(text)?.let {
            val raw = it.groupValues[2]
            val level = when (raw) { "половину" -> 50; "максимум" -> 100; "минимум" -> 0; else -> raw.toInt() }
            return command("volume", "mode" to "set", "stream" to stream(it.groupValues[1]), "level" to level)
        }
        volumeStep.matchEntire(text)?.let {
            val mode = if (it.groupValues[1] in setOf("прибавь", "увеличь", "подними")) "up" else "down"
            return command("volume", "mode" to mode, "stream" to stream(it.groupValues[2]), "level" to (it.groupValues[3].toIntOrNull() ?: 10))
        }
        volumeMute.matchEntire(text)?.let {
            val mode = if (it.groupValues[1] in setOf("включи", "верни")) "unmute" else "mute"
            return command("volume", "mode" to mode, "stream" to stream(it.groupValues[2]))
        }
        timeout.matchEntire(text)?.let {
            val amount = it.groupValues[1].toInt()
            val seconds = if (it.groupValues[2].startsWith("мин")) amount * 60 else amount
            return command("screen_timeout", "seconds" to seconds)
        }
        if (text in setOf("смени рингтон", "поменяй мелодию звонка", "выбери рингтон", "сменить рингтон")) {
            return command("settings", "target" to "ringtone", "switch" to true)
        }
        refreshChange.matchEntire(text)?.let {
            return command("display_refresh", "level" to it.groupValues[1].toInt())
        }
        if (diagnoseRefresh.matches(text)) return command("read_device", "target" to "refresh")
        read.matchEntire(text)?.groupValues?.get(1)?.let { label ->
            if (label in setOf("громкость", "громкость мультимедиа")) return command("volume", "mode" to "status")
            if (label in setOf("яркость", "яркость экрана")) return command("brightness", "mode" to "status")
            diagnostics.entries.firstOrNull { label in it.value }?.let {
                return command("read_device", "target" to it.key)
            }
        }
        toggle.matchEntire(text)?.destructured?.let { (verb, label) ->
            val enabled = verb == "включи" || verb == "активируй"
            when (label) {
                in brightness -> return command("brightness", "mode" to if (enabled) "auto" else "manual")
                in rotation -> return command("rotate", "mode" to if (enabled) "on" else "off")
                in sections.getValue("wifi") -> return command("panel", "target" to "wifi")
            }
            sections.entries.firstOrNull { it.key in switchPages && label in it.value }?.let {
                return command("settings", "target" to it.key, "switch" to true)
            }
        }
        (nestedSettings.matchEntire(text) ?: settings.matchEntire(text))?.groupValues?.get(1)?.let { label ->
            sections.entries.firstOrNull { label in it.value }?.let {
                return command("settings", "target" to it.key)
            }
        }
        return null
    }

    private fun command(kind: String, vararg fields: Pair<String, Any>) = JSONObject().put("kind", kind).apply {
        fields.forEach { (name, value) -> put(name, value) }
    }
}
