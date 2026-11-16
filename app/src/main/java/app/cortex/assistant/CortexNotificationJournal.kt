package app.cortex.assistant

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Private, encrypted event counts. Notification titles and bodies are never persisted or sent to an AI. */
internal class CortexNotificationJournal(private val context: Context) {
    private val prefs = context.getSharedPreferences("cortex-notification-events", Context.MODE_PRIVATE)
    private val time = SimpleDateFormat("HH:mm", Locale("ru"))
    private fun storageKey() = "events-" + CortexScenarios.currentOwner(context).ifBlank { "guest" }

    private fun key(): SecretKey = synchronized(lock) {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return@synchronized it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        generator.generateKey()
    }

    private fun read(): JSONObject = runCatching {
        val encoded = prefs.getString(storageKey(), null) ?: return@runCatching JSONObject()
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        require(bytes.size >= 29)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
    }.getOrDefault(JSONObject())

    private fun write(value: JSONObject) {
        runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            prefs.edit().putString(storageKey(), Base64.encodeToString(
                cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)).apply()
        }
    }

    fun record(notification: StatusBarNotification) = synchronized(lock) {
        if (notification.packageName == context.packageName ||
            notification.notification.flags and Notification.FLAG_ONGOING_EVENT != 0 ||
            notification.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return@synchronized

        val now = System.currentTimeMillis()
        val state = read()
        val array = state.optJSONArray("items") ?: JSONArray()
        val entries = (0 until array.length()).mapNotNull { array.optJSONObject(it) }
            .filter { now - it.optLong("at") in 0..DAY_MS }.toMutableList()
        val identity = notification.key.hashCode()
        if (entries.any { it.optInt("key") == identity && now - it.optLong("at") in 0..15_000L }) return@synchronized
        entries.add(JSONObject().put("app", notification.packageName.take(160))
            .put("key", identity).put("at", now))
        state.put("items", JSONArray(entries.takeLast(MAX_EVENTS)))
        write(state)
    }

    fun clear() = synchronized(lock) { prefs.edit().clear().apply() }

    fun answer(raw: String): String? {
        val clean = (CortexHotword.command(raw) ?: raw).lowercase(Locale.ROOT)
            .replace('ё', 'е').trim().trimEnd('?', '.', '!', ' ')
        val details = listOf("что написали", "что пишут", "текст уведомлен", "прочитай уведомлен", "прочти уведомлен",
            "кто написал", "кто мне писал", "кто мне пишет", "прочитай сообщения", "содержание уведомлен")
            .any { clean.contains(it) }
        val summary = clean in setOf("что нового", "что произошло", "какие уведомления", "новые уведомления",
            "есть уведомления", "есть ли уведомления", "покажи уведомления", "проверь уведомления",
            "что я пропустил", "что пропустил", "что было пока меня не было", "сводка уведомлений") ||
            clean.contains("уведомления за сегодня") || clean.contains("что нового на телефоне")
        if (!summary && !details) return null
        if (!accessGranted(context)) return "Для сводки уведомлений разрешите CORTEX доступ к уведомлениям в разделе «Профиль → Доступы Android». Android попросит отдельное подтверждение."
        return if (details) activeDetails() else summary(clean.contains("за сегодня"))
    }

    private fun summary(today: Boolean): String = synchronized(lock) {
        val now = System.currentTimeMillis()
        val state = read()
        val sinceLast = state.optLong("seen", 0L)
        val todayStart = if (today) java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
        }.timeInMillis else 0L
        val threshold = maxOf(now - DAY_MS, if (today) todayStart else sinceLast)
        val values = state.optJSONArray("items") ?: JSONArray()
        val all = (0 until values.length()).mapNotNull { values.optJSONObject(it) }
            .filter { now - it.optLong("at") in 0..DAY_MS }
        val entries = all.filter { it.optLong("at") > threshold }
        state.put("items", JSONArray(all))
        state.put("seen", now)
        write(state)
        if (entries.isEmpty()) return@synchronized if (sinceLast == 0L) "Пока нет записанных новых уведомлений. CORTEX начнёт их считать после выдачи доступа."
            else "С последней проверки новых уведомлений не было."
        val grouped = entries.groupBy { it.optString("app") }.entries.sortedByDescending { it.value.size }
        val lines = grouped.take(6).map { (pkg, posts) ->
            "• ${appName(pkg)}: ${posts.size} · последнее в ${time.format(Date(posts.maxOf { it.optLong("at") }))}"
        }
        "Новых уведомлений: ${entries.size}.\n" + lines.joinToString("\n") +
            (if (grouped.size > 6) "\nИ ещё ${grouped.size - 6} приложений." else "") +
            "\nТексты уведомлений не сохраняются. Чтобы посмотреть текущие сообщения, спросите «Что пишут в уведомлениях?»"
    }

    private fun activeDetails(): String {
        if (context.getSystemService(KeyguardManager::class.java).isDeviceLocked) {
            return "Телефон заблокирован. Могу назвать количество уведомлений, а содержимое прочитаю после разблокировки."
        }
        val current = runCatching { CortexNotificationListener.connected?.activeNotifications?.toList() }.getOrNull()
            ?: return "Android пока не предоставил активные уведомления. Попробуйте открыть CORTEX снова."
        val lines = current.asSequence().filter { it.packageName != context.packageName &&
            it.notification.flags and Notification.FLAG_GROUP_SUMMARY == 0 &&
            it.notification.visibility != Notification.VISIBILITY_SECRET }
            .sortedByDescending { it.postTime }.take(7).mapNotNull { post ->
                val extras = post.notification.extras
                val title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
                    .replace(Regex("[\\r\\n]+"), " ").trim().take(70)
                val body = (extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)
                    ?: extras?.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
                    .replace(Regex("[\\r\\n]+"), " ").trim().take(130)
                val part = listOf(title, body).filter(String::isNotBlank).joinToString(": ")
                if (part.isBlank()) null else "• ${appName(post.packageName)}: $part"
            }.toList()
        return if (lines.isEmpty()) "Сейчас нет доступных уведомлений с текстом. Удалённые уведомления CORTEX не сохраняет."
            else "Текущие уведомления:\n${lines.joinToString("\n")}"
    }

    private fun appName(pkg: String): String = runCatching {
        @Suppress("DEPRECATION")
        context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(pkg, 0)).toString()
    }.getOrElse { pkg.substringAfterLast('.').ifBlank { "Приложение" } }
        .replace(Regex("[\\r\\n]+"), " ").take(45)

    companion object {
        private val lock = Any()
        private const val ALIAS = "cortex-notifications-v1"
        private const val MAX_EVENTS = 120
        private const val DAY_MS = 24 * 60 * 60 * 1000L

        fun accessGranted(context: Context): Boolean = runCatching {
            val component = ComponentName(context, CortexNotificationListener::class.java)
            if (Build.VERSION.SDK_INT >= 27) {
                context.getSystemService(NotificationManager::class.java).isNotificationListenerAccessGranted(component)
            } else {
                Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
                    .orEmpty().split(':').any { ComponentName.unflattenFromString(it) == component }
            }
        }.getOrDefault(false)
    }
}

/** Runs only when the user enables Android's separate notification-listener permission. */
internal class CortexNotificationListener : NotificationListenerService() {
    override fun onListenerConnected() { super.onListenerConnected(); connected = this }
    override fun onListenerDisconnected() { if (connected === this) connected = null; super.onListenerDisconnected() }
    override fun onDestroy() { if (connected === this) connected = null; super.onDestroy() }
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn != null) CortexNotificationJournal(applicationContext).record(sbn)
    }

    companion object { @Volatile var connected: CortexNotificationListener? = null; private set }
}
