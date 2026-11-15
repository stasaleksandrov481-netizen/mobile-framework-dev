package app.cortex.assistant

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.UUID

internal object CortexScenarios {
    data class Scenario(val id: String, val name: String, val triggers: List<String>, val steps: JSONArray) {
        fun json(): JSONObject = JSONObject().put("id", id).put("name", name)
            .put("triggers", JSONArray(triggers)).put("steps", steps)
    }

    private val kinds = setOf("open", "tap", "point", "type", "swipe", "wait", "pause", "if", "repeat", "run", "variable")
    private val variable = Regex("[a-zA-Z_][a-zA-Z0-9_]{0,31}")
    private val packageName = Regex("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+")
    private val id = Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    private var cached: List<Scenario>? = null

    private fun store(context: Context) = context.getSharedPreferences("cortex-scenarios", Context.MODE_PRIVATE)
    private fun all(context: Context): List<Scenario> {
        cached?.let { return it }
        val list = runCatching { JSONArray(store(context).getString("items", "[]")) }.getOrDefault(JSONArray())
        return (0 until list.length()).mapNotNull { i -> runCatching { decode(list.getJSONObject(i)) }.getOrNull() }
            .also { cached = it }
    }

    fun list(context: Context) = JSONArray(all(context).map(Scenario::json))
    fun get(context: Context, id: String) = all(context).firstOrNull { it.id == id }
    fun find(context: Context, raw: String): Scenario? {
        val normalized = normalize(CortexHotword.command(raw) ?: raw)
        val name = normalized.removePrefix("запусти сценарий ").removePrefix("выполни сценарий ")
            .removePrefix("сценарий ").trim('«', '»', '"')
        return all(context).firstOrNull { item ->
            item.triggers.any { normalize(it) == normalized } || (name != normalized && normalize(item.name) == name)
        }
    }

    fun save(context: Context, input: JSONObject): String? {
        val inputId = input.optString("id")
        val scenarios = all(context)
        val item = runCatching { decode(JSONObject(input.toString()).put("id", inputId.ifBlank { UUID.randomUUID().toString() })) }
            .getOrElse { return it.message ?: "Проверьте настройки сценария." }
        if (inputId.isNotBlank() && scenarios.none { it.id == inputId }) return "Сценарий больше недоступен."
        if (inputId.isBlank() && scenarios.size >= 40) return "Доступно до 40 сценариев."
        if (scenarios.any { other -> other.id != item.id &&
                item.triggers.any { trigger -> other.triggers.any { normalize(it) == normalize(trigger) } }
            }) return "Эту фразу уже использует другой сценарий."
        return if (persist(context, scenarios.filterNot { it.id == item.id } + item)) null else "Android не сохранил сценарий."
    }

    fun delete(context: Context, id: String): Boolean = persist(context, all(context).filterNot { it.id == id })

    private fun persist(context: Context, items: List<Scenario>): Boolean {
        val ok = store(context).edit().putString("items", JSONArray(items.map(Scenario::json)).toString()).commit()
        if (ok) cached = items
        return ok
    }

    private fun decode(input: JSONObject): Scenario {
        require(input.toString().length <= 38_000) { "Сценарий слишком длинный." }
        val key = input.optString("id")
        require(id.matches(key)) { "Неверный ID сценария." }
        val name = input.optString("name").trim()
        require(name.length in 1..90) { "Введите название сценария до 90 символов." }
        val phrases = input.optJSONArray("triggers") ?: JSONArray()
        require(phrases.length() <= 12) { "Укажите до 12 голосовых фраз." }
        val triggers = (0 until phrases.length()).map { phrases.getString(it).trim() }.filter(String::isNotBlank)
        require(triggers.all { it.length <= 100 }) { "Голосовая фраза длиннее 100 символов." }
        val steps = input.optJSONArray("steps") ?: throw IllegalArgumentException("Добавьте шаги в сценарий.")
        require(steps.length() > 0) { "Добавьте хотя бы один шаг." }
        require(validateSteps(steps, 0) <= 60) { "Допустимо до 60 шагов в сценарии." }
        return Scenario(key, name, triggers.distinctBy(::normalize), steps)
    }

    private fun validateSteps(steps: JSONArray, depth: Int): Int {
        require(depth <= 4 && steps.length() <= 40) { "Упростите вложенные шаги сценария." }
        var count = steps.length()
        for (i in 0 until steps.length()) {
            val step = steps.getJSONObject(i)
            val kind = step.optString("kind")
            val target = step.optString("target").trim()
            val value = step.optString("value")
            require(kind in kinds && target.length <= 180 && value.length <= 2000) { "Проверьте шаг «$kind»." }
            when (kind) {
                "open", "tap", "wait", "if" -> require(target.isNotBlank() && !target.startsWith('#')) { "Укажите имя приложения или подпись элемента." }
                "type" -> require(value.isNotBlank()) { "Укажите текст для ввода." }
                "swipe" -> require(value in setOf("up", "down", "left", "right")) { "Укажите направление свайпа." }
                "point" -> require(packageName.matches(step.optString("package")) &&
                    step.optDouble("x") in 0.0..1.0 && step.optDouble("y") in 0.0..1.0) { "Запишите точку касанием экрана." }
                "run" -> require(id.matches(target)) { "Выберите сценарий для запуска." }
                "pause" -> require(step.optInt("seconds") in 1..30) { "Выберите паузу от 1 до 30 секунд." }
                "repeat" -> require(step.optInt("count") in 1..10) { "Выберите от 1 до 10 повторов." }
                "variable" -> require(variable.matches(target)) { "Используйте латиницу, цифры и подчёркивания в имени переменной." }
            }
            if (kind == "repeat" || kind == "if") {
                val positive = validateSteps(step.getJSONArray("steps"), depth + 1)
                val negative = if (kind == "if") validateSteps(step.optJSONArray("else") ?: JSONArray(), depth + 1) else 0
                require(positive + negative > 0) { "Добавьте шаги внутрь условия или повторения." }
                count += positive + negative
            }
        }
        return count
    }

    private fun normalize(value: String) = value.trim().trimEnd('.', '!', '?')
        .lowercase(Locale.ROOT).replace('ё', 'е').replace(Regex("""\s+"""), " ")
}
