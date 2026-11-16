package app.cortex.assistant

import android.content.Context
import android.app.KeyguardManager
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import java.util.Locale

internal class IslandAssistant(private val context: Context) : AutoCloseable {
    private val gateway = CortexServerBridge(context)
    private val engine = CortexActionEngine(context)
    private val memory = CortexPrivateMemory(context)
    private var request: String? = null
    private var generation = 0L
    data class Outcome(val text: String, val ok: Boolean, val waiting: Boolean = false, val tokens: Int? = null)

    fun send(
        text: String, beforeScreen: () -> Unit,
        toolsAllowed: () -> Boolean, progress: (String) -> Unit, delta: (String) -> Unit,
        finished: (Outcome) -> Unit
    ) {
        if (request != null) return
        val turn = ++generation
        val tools = toolsAllowed()
        val unlocked = !context.getSystemService(KeyguardManager::class.java).isDeviceLocked
        val prefs = context.getSharedPreferences("cortex-display", Context.MODE_PRIVATE)
        val language = prefs.getString("replyLanguage", "auto").orEmpty()
        val style = prefs.getString("replyStyle", "balanced").orEmpty().takeIf { it in setOf("brief", "balanced", "deep") } ?: "balanced"
        if (unlocked) memory.takeCommand(text)?.let { finished(Outcome(it, true, tokens = 0)); return }
        IslandAppearanceCommands.apply(context, text)?.let { finished(Outcome(it, true, tokens = 0)); return }
        smallTalk(text, language, prefs.getString("replyTone", "").orEmpty())?.let {
            if (unlocked) memory.remember(text, it)
            finished(Outcome(it, true, tokens = 0))
            return
        }
        val concise = CONCISE.containsMatchIn(text)
        val profile = if (!concise && (text.length > 700 || COMPLEX.containsMatchIn(text))) "deep" else "auto"
        val replyStyle = if (style != "balanced") style else if (concise) "brief" else if (profile == "deep") "deep" else style
        fun finish(answer: String, ok: Boolean, tokens: Int? = null) {
            if (turn != generation) return
            if (ok && unlocked) memory.remember(text, answer)
            finished(Outcome(answer, ok, tokens = tokens))
        }
        if (engine.start(text, profile, allowPhone = tools, beforeScreen = beforeScreen, progress = progress) { result ->
                if (turn == generation) finished(Outcome(result.text, result.ok, result.waiting, if (result.localOnly) 0 else null))
            }) return
        val parts = mutableListOf<String>()
        val facts = if (unlocked) memory.listFacts() else emptyList()
        val address = prefs.getString("addressName", "").orEmpty().trim().take(60)
        if (unlocked && address.isNotBlank()) parts += "Обращение: $address"
        when (language) { "en-US" -> parts += "Язык: английский."; "ru-RU" -> parts += "Язык: русский." }
        if (unlocked) {
            for ((key, label, limit) in listOf(Triple("replyTone", "Манера", 90), Triple("replyCharacter", "Характер", 380))) {
                prefs.getString(key, "").orEmpty().trim().take(limit).takeIf(String::isNotBlank)?.let { parts += "$label: $it" }
            }
            val words = TERMS.findAll(text.lowercase(Locale.ROOT).replace('ё', 'е')).map { it.value.take(7) }.take(14).toSet()
            val relevant = facts.filter { fact ->
                RECALL.containsMatchIn(text) || words.any { fact.lowercase(Locale.ROOT).replace('ё', 'е').contains(it) }
            }.take(4)
            if (relevant.isNotEmpty()) parts += "Память: " + JSONArray(relevant).toString()
        }
        if (DEVICE_QUESTION.containsMatchIn(text)) {
            parts += "Android: " + CortexDeviceContext.runtime(context, CortexScreenService.connected,
                tools && prefs.getBoolean("visualBeta", false))
        }
        val messages = JSONArray()
        if (parts.isNotEmpty()) messages.put(message("system", parts.joinToString("\n")))
        if (unlocked) memory.recent().takeLast(if (profile == "deep") 5 else 3).forEach { (input, output) ->
            messages.put(message("user", input)).put(message("assistant", output))
        }
        messages.put(message("user", text))
        val payload = JSONObject().put("messages", messages).put("style", replyStyle).put("profile", profile)
        request = gateway.chat(payload, { event ->
            if (turn == generation && event.optString("status") == "fallback") progress("Пробую резервную модель…")
            if (turn == generation && event.has("delta")) delta(event.optString("delta"))
        }) { outcome ->
            if (turn != generation) return@chat
            request = null
            val error = outcome.optString("error")
            val result = outcome.optJSONObject("result")
            when {
                error.isNotEmpty() -> finish(errorMessage(error, outcome.optInt("retry_after")), false)
                result == null -> finish("Кортекс не получил ответ. Попробуйте ещё раз.", false)
                else -> {
                    val plain = result.optString("text").trim()
                    when {
                        tools && ACTION_CLAIM.containsMatchIn(plain) -> finish("Android пока не подтвердил действие.", false)
                        plain.isBlank() -> finish("Модель вернула пустой ответ.", false)
                        else -> finish(plain, true, result.optJSONObject("usage")?.optInt("total", -1)?.takeIf { it >= 0 })
                    }
                }
            }
        }
    }

    fun cancel() {
        ++generation
        request?.let(gateway::cancel)
        request = null
        engine.cancel()
    }

    override fun close() {
        cancel()
        engine.close()
        gateway.close()
    }

    private fun message(role: String, text: String) = JSONObject().put("role", role).put("content", text)

    private fun errorMessage(code: String, retryAfter: Int): String {
        val delay = if (retryAfter in 1..3600) " Повторите через " + ceil(retryAfter / 60.0).toInt() + " мин." else ""
        return when (code) {
            "daily_limit" -> "Токены ИИ обновятся в 03:00 по Москве. Локальные команды доступны."
            "provider_quota_daily" -> "Дневная квота бесплатных запросов OpenRouter исчерпана."
            "provider_quota", "provider_limit", "rate_limit" -> "Бесплатные модели сейчас перегружены." + delay
            "provider_key" -> "OpenRouter отклонил серверный ключ."
            "maintenance" -> "Идут технические работы. Статус доступен в приложении CORTEX."
            "update" -> "Для продолжения обновите CORTEX."
            "sign_in" -> "Для ИИ нужен вход в профиль CORTEX."
            "timeout" -> "Ответ занял слишком много времени."
            "offline" -> "Связь с сервером потеряна. Проверьте интернет."
            else -> "ИИ временно недоступен. Попробуйте ещё раз."
        }
    }

    private fun smallTalk(text: String, language: String, tone: String): String? {
        val normalized = (CortexHotword.command(text) ?: text).trim().trimEnd('.', '!', '?', '…')
            .lowercase(Locale.ROOT).replace('ё', 'е').replace(WHITESPACE, " ")
        val status = STATUS_RU.matches(normalized) || STATUS_EN.matches(normalized)
        val greeting = HELLO_RU.matches(normalized) || HELLO_EN.matches(normalized)
        if (!status && !greeting) return null
        val english = language == "en-US" || language == "auto" && (STATUS_EN.matches(normalized) || HELLO_EN.matches(normalized))
        val formal = Regex("официальн|формальн|на вы", RegexOption.IGNORE_CASE).containsMatchIn(tone)
        return when {
            english && status -> "Doing well. How about you?"
            english && formal -> "Hello! How can I help?"
            english -> "Hey! What’s up?"
            status && formal -> "Всё хорошо. А у вас как?"
            status -> "Всё хорошо. А у тебя как?"
            formal -> "Здравствуйте! Чем помочь?"
            else -> "Привет! Что нового?"
        }
    }

    private companion object {
        val WHITESPACE = Regex("""\s+""")
        val STATUS_RU = Regex("""(?:(?:привет(?:ик)?|здарова|здорова|хай|йо)[!, ]+)?(?:как (?:у тебя )?(?:дела|дила|делишки)|как ты|как жизнь|как оно|чо как|че как|что как|как сам)""")
        val HELLO_RU = Regex("""привет(?:ик)?|здарова|здорова|хай|здравствуйте|добрый день|добрый вечер|доброе утро|йо""")
        val STATUS_EN = Regex("""how are you|how are you doing|how.s it going""")
        val HELLO_EN = Regex("""hi|hello|hey""")
        val CONCISE = Regex("""коротко|кратко|в двух словах|briefly""", RegexOption.IGNORE_CASE)
        val COMPLEX = Regex("""подробно|пошагово|сравни|спроектируй|разбери|напиши код|проанализируй|step by step|in detail|analy[sz]e""", RegexOption.IGNORE_CASE)
        val DEVICE_QUESTION = Regex("""телефон|android|андроид|устройств|экран|заряд|батаре|интернет|уведомлен|wi-?fi""", RegexOption.IGNORE_CASE)
        val TERMS = Regex("""[\p{L}\p{N}]{4,}""")
        val RECALL = Regex("""вспомни|помнишь|обо мне|про меня|remember|earlier""", RegexOption.IGNORE_CASE)
        val ACTION_CLAIM = Regex("""(?iu)^(?:готово[,!.]?\s*)?(?:открыл|включил|выключил|запустил|установил|поставил|заблокировал)(?:\s|[.!]|$)""")
    }
}
