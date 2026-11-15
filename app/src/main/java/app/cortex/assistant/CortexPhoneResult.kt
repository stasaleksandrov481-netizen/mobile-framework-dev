package app.cortex.assistant

import org.json.JSONObject
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

internal object CortexPhoneResult {
    fun describe(command: JSONObject, result: JSONObject): String {
        val kind = command.optString("kind")
        result.optString("message").takeIf { it.isNotBlank() }?.let { return it }
        return when (result.optString("status")) {
            "done" -> when (kind) {
                "volume" -> "Громкость мультимедиа — " + result.optInt("level") + "%."
                "torch" -> if (result.optBoolean("enabled")) "Фонарик включён." else "Фонарик выключен."
                "lock_screen" -> "Android подтвердил блокировку экрана."
                "read_device" -> when (command.optString("target")) {
                    "time" -> "Сейчас " + ZonedDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm")) + "."
                    "battery" -> result.optInt("level", -1).takeIf { it in 0..100 }?.let {
                        "Заряд — $it%." + if (result.optBoolean("charging")) " Телефон заряжается." else ""
                    } ?: "Android не сообщил уровень заряда."
                    "storage" -> {
                        val free = result.optLong("free", -1L)
                        val total = result.optLong("total", -1L)
                        if (free < 0 || total <= 0) "Android не сообщил объём памяти."
                        else String.format(java.util.Locale.forLanguageTag("ru"), "Свободно %.1f из %.1f ГБ.", free / 1e9, total / 1e9)
                    }
                    "wifi" -> if (result.optBoolean("enabled")) "Wi-Fi включён." else "Wi-Fi выключен."
                    "rotate" -> toggle("Автоповорот", result)
                    "airplane" -> toggle("Авиарежим", result)
                    "location" -> if (result.optBoolean("enabled")) "Геолокация включена." else "Геолокация выключена."
                    "battery_saver" -> toggle("Режим энергосбережения", result)
                    "ringer" -> when (result.optString("value")) {
                        "silent" -> "Телефон в беззвучном режиме."
                        "vibrate" -> "Телефон в режиме вибрации."
                        else -> "Звук звонка включён."
                    }
                    "network" -> when (result.optString("value")) {
                        "offline" -> "Активного подключения к сети нет."
                        "vpn" -> "Подключение идёт через VPN."
                        else -> {
                            val connection = when (result.optString("value")) {
                                "wifi" -> "Wi-Fi"
                                "mobile" -> "мобильная сеть"
                                else -> "сеть"
                            }
                            "Подключение: $connection." + if (result.optBoolean("validated")) "" else " Android не подтвердил доступ в интернет."
                        }
                    }
                    "refresh" -> {
                        val rate = result.optInt("current_hz", 0)
                        val rates = result.optJSONArray("supported_hz")
                        val list = rates?.let { array -> (0 until array.length()).joinToString(", ") { array.optInt(it).toString() } }.orEmpty()
                        (if (rate > 0) "Сейчас экран работает на $rate Гц." else "Android не сообщил текущую частоту.") +
                            if (list.isEmpty()) "" else " Доступные режимы: $list Гц."
                    }
                    else -> result.optString("value", "Состояние получено от Android.")
                }
                "brightness" -> when (command.optString("mode")) {
                    "auto" -> "Адаптивная яркость включена."
                    "manual" -> "Адаптивная яркость выключена."
                    else -> "Яркость экрана — " + result.optInt("level") + "%."
                }
                "rotate" -> toggle("Автоповорот", result)
                "battery" -> "Заряд — " + result.optInt("level") + "%."
                "app_list" -> result.optJSONArray("names")?.let { names ->
                    (0 until minOf(names.length(), 18)).joinToString(", ") { names.optString(it) }
                }.orEmpty().ifBlank { "Приложения не найдены." }
                "copy_text" -> "Текст скопирован."
                else -> "Android подтвердил действие."
            }
            "opened" -> when (kind) {
                "open_web" -> "Android получил запрос открыть " + result.optString("host") + " в браузере."
                "app_info" -> "Открываю сведения о приложении в настройках Android."
                "app" -> if (result.optBoolean("verified")) "Открыто «" + result.optString("name") + "»."
                    else "Android получил запрос открыть «" + result.optString("name") + "»."
                "close_app" -> if (result.optBoolean("verified")) "Вышел из «" + result.optString("name") + "» на рабочий стол."
                    else "Android получил команду выйти из «" + result.optString("name") + "»."
                "home" -> "Android получил команду перейти на рабочий стол."
                "recents" -> "Android получил команду показать список окон."
                "settings" -> if (command.optString("target") == "vpn") "Переключатель VPN находится в открываемых настройках Android."
                    else if (command.optBoolean("switch")) "Открываю нужный раздел Android. Переключатель доступен на его экране."
                    else "Android получил команду открыть настройки."
                else -> "Android получил команду открытия."
            }
            "panel" -> if (kind == "play_store") "Поиск передан Google Play. Выберите приложение и подтвердите установку на его странице."
                else "Открываю системную панель Wi-Fi. Переключатель находится на её экране."
            "requested" -> "Android получил команду. Подтверждения результата пока нет."
            "cancelled" -> "Задача остановлена."
            "already_background" -> "«" + result.optString("name") + "» уже не на переднем плане."
            "needs_brightness" -> "Разрешите CORTEX изменять системные настройки в разделе «Вызов»."
            "needs_screen" -> "Включите службу управления экраном CORTEX в настройках Android."
            "needs_lock" -> "Разрешите блокировку экрана или включите управление экраном в настройках CORTEX."
            "not_installed" -> "Приложение не найдено на телефоне."
            "unsupported" -> "Действие недоступно с текущими возможностями Android."
            else -> "Android не подтвердил выполнение команды."
        }
    }

    private fun toggle(name: String, result: JSONObject) = "$name " + if (result.optBoolean("enabled")) "включён." else "выключен."
}
