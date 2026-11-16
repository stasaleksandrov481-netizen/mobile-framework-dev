package app.cortex.assistant

import android.content.Context
import android.app.KeyguardManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypted, per-account memory for island conversations. Never stores screen captures or credentials. */
internal class CortexPrivateMemory(private val context: Context) {
    private val prefs = context.getSharedPreferences("cortex-private-memory", Context.MODE_PRIVATE)
    private val secretPattern = Regex("(?iu)(?:парол[ьи]|password|api[ _-]?key|токен|секрет|пин[ -]?код|cvv|cvc|otp|код из смс|номер карт[ыи]|bearer|sk-or-v1-|-----begin)")
    private val credentials = Regex("""(?i)(?:\b\d{6}\b|\b\d{12,19}\b|[A-Za-z0-9_-]{35,})""")
    private val explicit = Regex("""(?iu)^\s*(?:кортекс[, ]*)?(?:запомни(?:\s+пожалуйста)?(?:,)?\s+(?:что\s+)?)(.+)$""")
    private val forget = Regex("""(?iu)^\s*(?:кортекс[, ]*)?(?:забудь(?:\s+всё|\s+все)?|очисти\s+память|удали\s+память)(?:[.!?]*)\s*$""")
    private val recall = Regex("""(?iu)(?:что\s+ты\s+(?:обо\s+мне\s+)?помнишь|покажи\s+(?:мою\s+)?память)""")
    private val personal = Regex("""(?iu)^\s*(?:меня\s+зовут|я\s+(?:люблю|предпочитаю|работаю|живу|учусь)|мой\s+(?:проект|город|любимый|язык)|мне\s+нравится)\b.{3,180}$""")

    private fun key(): SecretKey = synchronized(lock) {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return@synchronized it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        generator.generateKey()
    }

    private fun owner() = CortexScenarios.currentOwner(context).ifBlank { "guest" }

    @Synchronized private fun read(): JSONObject = runCatching {
        val encoded = prefs.getString(owner(), null) ?: return@runCatching JSONObject()
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        if (bytes.size < 29) return@runCatching JSONObject()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
    }.getOrDefault(JSONObject())

    @Synchronized private fun write(data: JSONObject) {
        runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val combined = cipher.iv + cipher.doFinal(data.toString().toByteArray(Charsets.UTF_8))
            prefs.edit().putString(owner(), Base64.encodeToString(combined, Base64.NO_WRAP)).apply()
        }
    }

    private fun safe(value: String): Boolean = value.length in 5..240 && !secretPattern.containsMatchIn(value) &&
        !credentials.containsMatchIn(value) && !value.contains('@') && !value.contains("http", ignoreCase = true)

    @Synchronized fun takeCommand(command: String): String? {
        val memoryRequest = forget.matches(command) || recall.containsMatchIn(command) || explicit.matches(command.trim())
        if (memoryRequest && context.getSystemService(KeyguardManager::class.java).isDeviceLocked) {
            return "Разблокируйте телефон, чтобы работать с личной памятью CORTEX."
        }
        if (forget.matches(command)) {
            prefs.edit().remove(owner()).apply()
            return "Память CORTEX на этом устройстве очищена."
        }
        if (recall.containsMatchIn(command)) {
            val facts = listFacts()
            return if (facts.isEmpty()) "Пока ничего о вас не запомнил." else
                "Я помню:\n" + facts.joinToString("\n") { "• $it" }
        }
        val fact = explicit.matchEntire(command.trim())?.groupValues?.get(1)?.trim(' ', '.', '!') ?: return null
        return if (addFact(fact)) "Запомнил. Это можно удалить командой «очисти память»." else
            "Не сохранил: память не принимает пароли, коды, ключи и слишком длинные записи."
    }

    @Synchronized fun addFact(value: String): Boolean {
        val fact = value.trim().take(241)
        if (!safe(fact)) return false
        val data = read()
        val facts = (data.optJSONArray("facts") ?: JSONArray()).let { current ->
            (0 until current.length()).mapNotNull { current.optString(it).takeIf(String::isNotBlank) }.toMutableList()
        }
        facts.removeAll { it.equals(fact, ignoreCase = true) }
        facts.add(0, fact)
        data.put("facts", JSONArray(facts.take(12)))
        write(data)
        return true
    }

    @Synchronized fun observe(text: String) {
        val normalized = text.trim().take(241)
        if (personal.matches(normalized)) addFact(normalized)
    }

    @Synchronized fun wipeDevice() { prefs.edit().clear().apply() }

    @Synchronized fun listFacts(): List<String> {
        val array = read().optJSONArray("facts") ?: return emptyList()
        return (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) }.take(12)
    }

    @Synchronized fun recent(): List<Pair<String, String>> {
        val array = read().optJSONArray("turns") ?: return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            array.optJSONObject(index)?.let { turn ->
                val input = turn.optString("q")
                val output = turn.optString("a")
                if (input.isBlank() || output.isBlank()) null else input to output
            }
        }.takeLast(5)
    }

    @Synchronized fun remember(question: String, answer: String) {
        // Never persist sensitive data, even if it is useful for a single request.
        if (!safe(question) || !safe(answer.take(240)) || secretPattern.containsMatchIn(answer) ||
            credentials.containsMatchIn(answer) || answer.contains('@')) return
        val data = read()
        val turns = recent().toMutableList()
        turns.add(question.take(700) to answer.take(700))
        data.put("turns", JSONArray(turns.takeLast(5).map { (q, a) -> JSONObject().put("q", q).put("a", a) }))
        write(data)
        observe(question)
    }

    private companion object { const val ALIAS = "cortex-memory-v1"; val lock = Any() }
}
