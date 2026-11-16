package app.cortex.assistant

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.util.Locale

internal object CortexDeviceContext {
    const val IDENTITY = "Ты CORTEX внутри Android-приложения. Локальный движок запускает приложения и сценарии, " +
        "ставит напоминания, проверяет заряд, меняет яркость и громкость. При выданном доступе он выполняет шаги на экране. " +
        "Чат, островок и голос передают запросы одному помощнику. Опирайся на реальные разрешения и проверенные результаты. " +
        "Если цель неясна или для действия нужен доступ, назови конкретный следующий шаг."

    private val about = Regex(
        """^(?:кто ты|ты кто|как тебя зовут|что (?:ты )?(?:умеешь|можешь делать)|какие у тебя (?:функции|возможности)|ты (?:же )?(?:просто |обычный )?текстовый (?:ассистент|помощник)|ты можешь управлять (?:телефоном|андроидом))$"""
    )
    private val englishAbout = Regex("""^(?:who are you|what can you do|can you control (?:my|the) phone)$""")

    fun capabilities(text: String, controls: Boolean, screen: Boolean): String? {
        val question = (CortexHotword.command(text) ?: text).trim().trimEnd('.', '!', '?')
            .lowercase(Locale.ROOT).replace('ё', 'е')
        if (englishAbout.matches(question)) {
            return "I’m CORTEX, the assistant in this Android app. I can answer questions and set reminders." +
                if (controls) " I can open apps, change volume or brightness, and read the battery level. " +
                    if (screen) "Screen controls are available." else "Screen controls need Android accessibility access."
                else " Phone controls can be enabled in the Call tab."
        }
        if (!about.matches(question)) return null
        return if (controls) {
            "Я CORTEX, помощник внутри этого приложения. Открываю приложения, меняю громкость и яркость, " +
                "проверяю заряд и ставлю напоминания. " +
                if (screen) "Могу выполнять шаги на экране и запускать сценарии."
                else "Для сценариев и нажатий на экране выдайте доступ в разделе «Вызов»."
        } else {
            "Я CORTEX, помощник внутри этого приложения. Отвечаю на вопросы и ставлю напоминания. " +
                "Управление телефоном можно включить в разделе «Вызов»."
        }
    }

    fun runtime(context: Context, screen: CortexScreenService?, actionsEnabled: Boolean): JSONObject =
        JSONObject().put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL)
            .put("android_version", Build.VERSION.RELEASE).put("android_api", Build.VERSION.SDK_INT)
            .put("display", CortexDisplaySettings.info(context))
            .put("power_saving", context.getSystemService(android.os.PowerManager::class.java).isPowerSaveMode)
            .put("device_state", runCatching { CortexDeviceSnapshot.info(context) }.getOrNull())
            .put("cortex_version", BuildConfig.VERSION_NAME)
            .put("version_code", BuildConfig.VERSION_CODE)
            .put("screen_unlocked", CortexSchedule.screenReady(context))
            .put("notification_access", CortexSchedule.notificationsAllowed(context))
            .put("exact_alarm_access", CortexSchedule.exactAllowed(context))
            .put("screen_control", actionsEnabled && screen != null && !screen.locked())
            .put("offline_ocr", actionsEnabled && screen != null && Build.VERSION.SDK_INT >= 30)
            .put("surface", if (CortexRuntime.appVisible) "chat" else "island")
            .put("task_in_progress", CortexActionState.status?.phase == "executing")
            .apply {
                val foreground = screen?.takeIf { actionsEnabled }?.activePackage()
                if (foreground == context.packageName) put("foreground", "CORTEX")
            }
}
