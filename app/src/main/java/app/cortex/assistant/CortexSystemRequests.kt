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
        "keyboard" to setOf("клавиатуру", "клавиатуры", "способ ввода"), "vpn" to setOf("vpn", "впн")
    )
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
        "locale" to setOf("язык системы", "язык телефона")
    )
    private val switchPages = setOf("bluetooth", "mobile", "airplane", "location", "nfc", "battery_saver")
    private val nestedSettings = Regex("""(?:открой|зайди в) настройки (?:и |→ |/ )?(?:открой |зайди в )?(?:раздел )?[«"]?(.+?)[»"]?""")
    private val diagnoseRefresh = Regex("""сколько (?:сейчас )?(?:герц|гц)(?: (?:на (?:экране|дисплее)|выдает (?:экран|дисплей)))?""")

    fun parse(text: String): JSONObject? {
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
