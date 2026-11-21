package app.cortex.assistant

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import android.accessibilityservice.AccessibilityServiceInfo
import org.json.JSONObject
import java.util.Locale

internal object CortexDeviceContext {
    enum class ScreenAccess(val code: String) {
        OFF("off"), CONNECTING("connecting"), LOCKED("locked"), READY("ready");

        val granted get() = this != OFF

        fun describe(): String = when (this) {
            OFF -> "Включите «CORTEX — управление экраном» в специальных возможностях Android."
            CONNECTING -> "Доступ к экрану выдан. Android пока подключает службу CORTEX."
            LOCKED -> "Доступ к экрану выдан. Разблокируйте телефон для управления."
            READY -> "Android разрешает CORTEX управлять экраном."
        }
    }

    fun screenAccess(context: Context, screen: CortexScreenService? = CortexScreenService.connected): ScreenAccess {
        if (screen != null) return if (screen.locked()) ScreenAccess.LOCKED else ScreenAccess.READY
        val service = ComponentName(context, CortexScreenService::class.java)
        val enabled = runCatching {
            context.getSystemService(AccessibilityManager::class.java)
                ?.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
                .orEmpty().any { ComponentName.unflattenFromString(it.id.orEmpty()) == service }
        }.getOrDefault(false)
        // Some Android builds list only bound services. Secure settings can
        // confirm the grant during the gap before onServiceConnected.
        val configured = enabled || runCatching {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
                .orEmpty().split(':').any { ComponentName.unflattenFromString(it) == service }
        }.getOrDefault(false)
        return if (configured) ScreenAccess.CONNECTING else ScreenAccess.OFF
    }

    fun permissions(context: Context): JSONObject {
        val screen = screenAccess(context)
        fun granted(permission: String) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        return JSONObject()
            .put("assistantSupported", CortexAssistActivity.available(context))
            .put("assistant", CortexAssistActivity.selected(context))
            .put("microphone", granted(Manifest.permission.RECORD_AUDIO))
            .put("camera", granted(Manifest.permission.CAMERA))
            .put("notifications", Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS))
            .put("notificationAccess", CortexNotificationJournal.accessGranted(context))
            .put("screenAccess", screen.code)
            .put("screenLock", Build.VERSION.SDK_INT >= 28 && screen == ScreenAccess.READY)
            .put("screenLockSupported", Build.VERSION.SDK_INT >= 28)
            .put("screenAutomation", screen.granted)
            .put("verifyApps", screen == ScreenAccess.READY)
            .put("overlay", Settings.canDrawOverlays(context))
            .put("brightness", Settings.System.canWrite(context))
    }

    const val IDENTITY = "Ты CORTEX внутри Android-приложения. Локальный движок запускает приложения и сценарии, " +
        "ставит напоминания, проверяет заряд, меняет яркость и громкость. При выданном доступе он выполняет шаги на экране. " +
        "Чат, островок и голос передают запросы одному помощнику. Опирайся на реальные разрешения и проверенные результаты. " +
        "Если цель неясна или для действия нужен доступ, назови конкретный следующий шаг."

    private val about = Regex(
        """^(?:кто ты|ты кто|как тебя зовут|что (?:ты )?(?:умеешь|можешь делать)|какие у тебя (?:функции|возможности)|ты (?:же )?(?:просто |обычный )?текстовый (?:ассистент|помощник)|ты можешь управлять (?:телефоном|андроидом))$"""
    )
    private val englishAbout = Regex("""^(?:who are you|what can you do|can you control (?:my|the) phone)$""")
    private val accessQuestion = Regex("""^(?:какие (?:у тебя |у кортекса )?(?:разрешения|доступы)(?: у тебя)?(?: (?:есть|выданы|включены|нужны))?|(?:покажи|проверь|перечисли) (?:мои |свои |системные |выданные )?(?:разрешения|доступы)(?: (?:android|кортекса))?)$""")
    private val screenQuestion = Regex("""^(?:(?:у тебя )?есть (?:ли )?(?:у тебя )?доступ к (?:экрану|специальным возможностям)|доступ к экрану (?:выдан|есть|включен)|ты можешь управлять экраном)$""")

    private fun question(text: String) = (CortexHotword.command(text) ?: text).trim().trimEnd('.', '!', '?')
        .lowercase(Locale.ROOT).replace('ё', 'е')

    fun capabilities(text: String, controls: Boolean, screen: ScreenAccess, visualEnabled: Boolean): String? {
        val question = question(text)
        if (englishAbout.matches(question)) {
            return "I’m CORTEX, the assistant in this Android app. I can answer questions and set reminders." +
                if (controls) " I can open apps, change volume or brightness, and read the battery level. " +
                    when (screen) {
                        ScreenAccess.READY -> if (visualEnabled) "Screen controls are available."
                            else "Android granted access. Enable Visual control in the Call tab to use it."
                        ScreenAccess.CONNECTING -> "Accessibility is enabled and Android is connecting the service."
                        ScreenAccess.LOCKED -> "Accessibility is enabled. Unlock the phone to use screen controls."
                        ScreenAccess.OFF -> "Screen controls need Android accessibility access."
                    }
                else " Phone controls can be enabled in the Call tab."
        }
        if (!about.matches(question)) return null
        return if (controls) {
            "Я CORTEX, помощник внутри этого приложения. Открываю приложения, меняю громкость и яркость, " +
                "проверяю заряд и ставлю напоминания. " +
                if (screen == ScreenAccess.READY && visualEnabled) "Могу выполнять шаги на экране и запускать сценарии."
                else screen.describe() + if (screen.granted && !visualEnabled) " Включите «Визуальное управление» в разделе «Вызов», чтобы выполнять шаги на экране." else ""
        } else {
            "Я CORTEX, помощник внутри этого приложения. Отвечаю на вопросы и ставлю напоминания. " +
                "Управление телефоном можно включить в разделе «Вызов»."
        }
    }

    fun permissionAnswer(context: Context, text: String, visualEnabled: Boolean): String? {
        val question = question(text)
        val screenOnly = screenQuestion.matches(question)
        if (!screenOnly && !accessQuestion.matches(question)) return null
        val screen = screenAccess(context)
        val screenStatus = screen.describe() + if (!visualEnabled)
            " Визуальное управление БЕТА отдельно выключено в разделе «Вызов»." else ""
        if (screenOnly) return screenStatus
        val snapshot = permissions(context)
        return listOf("Микрофон" to "microphone", "Поверх приложений" to "overlay", "Уведомления" to "notifications",
            "Чтение уведомлений" to "notificationAccess", "Изменение яркости" to "brightness")
            .joinToString("\n", postfix = "\n$screenStatus") { (label, key) ->
                "$label — ${if (snapshot.optBoolean(key)) "разрешено" else "доступ не выдан"}."
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
            .put("screen_access", screenAccess(context, screen).code)
            .put("visual_mode_enabled", context.getSharedPreferences("cortex-display", Context.MODE_PRIVATE).getBoolean("visualAutomation", false))
            .put("offline_ocr", actionsEnabled && screen != null && Build.VERSION.SDK_INT >= 30)
            .put("surface", if (CortexRuntime.appVisible) "chat" else "island")
            .put("task_in_progress", CortexActionState.status?.phase == "executing")
            .apply {
                val foreground = screen?.takeIf { actionsEnabled }?.activePackage()
                if (foreground == context.packageName) put("foreground", "CORTEX")
            }
}
