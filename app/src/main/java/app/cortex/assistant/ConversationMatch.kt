package app.cortex.assistant

internal object ConversationMatch {
    private val sections = setOf("сообщения", "messages", "результаты сообщений", "message results")
    private val global = setOf("глобальный поиск", "глобальные результаты", "global search", "global results")
    private val handle = Regex("""^@[a-zA-Z0-9_.]{3,64}(?=$|[, \t])""")

    fun boundary(label: String, byUsername: Boolean): Boolean =
        VisualLabels.normalize(label) in sections || !byUsername && VisualLabels.normalize(label) in global

    fun title(label: String, description: String, lines: List<String>): String {
        val value = when {
            label.isNotBlank() && label != description -> label
            lines.isNotEmpty() -> lines.first()
            else -> description
        }
        return value.substringBefore(',').trim().take(130)
    }

    // A Telegram search is a substring search. For inflected Russian names, use a
    // short stem to find rows, but only accept a verified full contact title below.
    fun searchQuery(name: String): String {
        val target = VisualLabels.normalize(name)
        if (!singleRussianWord.matches(target)) return name
        return when {
            target.endsWith('е') || target.endsWith('у') -> target.dropLast(1)
            target.endsWith("ой") || target.endsWith("ей") -> target.dropLast(2)
            else -> name
        }
    }

    private val singleRussianWord = Regex("""[а-я]{4,}""")

    private fun nameForms(name: String): Set<String> {
        val target = VisualLabels.normalize(name)
        if (!singleRussianWord.matches(target)) return setOf(target)
        val stem = when {
            target.endsWith('е') || target.endsWith('у') -> target.dropLast(1)
            target.endsWith("ой") || target.endsWith("ей") -> target.dropLast(2)
            else -> return setOf(target)
        }
        return buildSet {
            add(target)
            if (target.endsWith("ей")) {
                add(stem + "я")
            } else if (target.endsWith("ой")) {
                add(stem + "а")
                add(stem + "я")
            } else {
                add(stem + "а")
                add(stem + "я")
            }
        }
    }

    fun score(title: String, lines: List<String>, name: String): Int {
        if (name.startsWith('@')) return if ((listOf(title) + lines.take(2)).any {
                handle.find(it.trim())?.value.equals(name, ignoreCase = true)
            }) 100 else 0
        val label = VisualLabels.normalize(title)
        val target = VisualLabels.normalize(name)
        if (target.length < 2) return 0
        return when {
            label in nameForms(name) -> 100
            target.length >= 3 && label.startsWith("$target ") -> 88
            else -> 0
        }
    }
}
