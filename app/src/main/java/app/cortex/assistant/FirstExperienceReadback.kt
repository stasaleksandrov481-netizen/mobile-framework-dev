package app.cortex.assistant

/** Values are local and must come from recognized display fields, never keypad/history/preview text. */
internal object FirstExperienceReadback {
    enum class Role { PRIMARY, FINAL, PREVIEW }
    data class Value(val role: Role, val text: String)
    private val labelled = Regex("(?iu)^(?:результат|ответ|равно|result|answer|equals)\\s*[:=]?\\s*([+−-]?[0-9][0-9\\s.,\\u00a0\\u202f]*)$")

    fun integer(text: String): Int? = FirstExperienceMath.displayedInteger(text)
        ?: labelled.matchEntire(FirstExperienceMath.expression(text))?.groupValues?.get(1)?.let(FirstExperienceMath::displayedInteger)

    fun confirmed(values: List<Value>, expected: Int): Boolean {
        val final = values.filter { it.role == Role.FINAL }.mapNotNull { integer(it.text) }
        val actual = final.ifEmpty { values.filter { it.role == Role.PRIMARY }.mapNotNull { integer(it.text) } }
        return actual.isNotEmpty() && actual.all { it == expected }
    }

    fun <T> resultFields(fields: List<Pair<T, Role>>): List<Pair<T, Role>> =
        fields.filter { it.second == Role.FINAL }.ifEmpty { fields.filter { it.second == Role.PRIMARY } }
}
