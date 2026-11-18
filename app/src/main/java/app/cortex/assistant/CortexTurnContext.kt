package app.cortex.assistant

/**
 * Short-lived, per-owner references for safe follow-up commands.
 *
 * This is not a chat memory and deliberately never resolves pronouns for
 * sending messages, deleting data, buying things or changing permissions.
 */
internal class CortexTurnContext {
    private var owner = ""
    private var app = ""
    private var observedAt = 0L
    private var awaitingOpen = false

    fun resolve(raw: String, currentOwner: String, now: Long): String {
        if (owner != currentOwner || now - observedAt !in 0..180_000L) {
            clear(currentOwner)
            return raw
        }
        val input = (CortexHotword.command(raw) ?: raw).trim()
            .replace(Regex("""\s+"""), " ")
        if (CANCEL.matches(input)) {
            awaitingOpen = false
            return raw
        }
        val explicit = OPEN_IT.matches(input)
        val yes = awaitingOpen && YES.matches(input)
        if (app.isBlank() || !(explicit || yes)) return raw
        awaitingOpen = false
        return "открой $app"
    }

    fun observeUser(raw: String, currentOwner: String, now: Long) {
        if (owner != currentOwner) clear(currentOwner)
        val named = VisualRequest.singleApp(raw)?.trim()
        if (named != null && named.length in 2..65) {
            app = named
            observedAt = now
            awaitingOpen = false
        }
    }

    fun observeAnswer(answer: String, currentOwner: String, now: Long) {
        if (owner != currentOwner || now - observedAt !in 0..180_000L || app.isBlank()) return
        awaitingOpen = '?' in answer && CONFIRM_OPEN.containsMatchIn(answer)
    }

    private fun clear(currentOwner: String) {
        owner = currentOwner
        app = ""
        observedAt = 0L
        awaitingOpen = false
    }

    private companion object {
        val OPEN_IT = Regex(
            """^(?:(?:да|ага|угу|окей|ок|конечно|ну|давай)[,\s]+)*(?:открой|открывай|открыть|запусти|запускай|запустить)\s+(?:мне\s+)?(?:его|ее|её|это|то|это приложение|то приложение)[.!?]*$""",
            RegexOption.IGNORE_CASE)
        val YES = Regex("""^(?:да|ага|угу|ок|окей|конечно|подтверждаю|давай)[.!?]*$""", RegexOption.IGNORE_CASE)
        val CANCEL = Regex("""^(?:нет|не надо|отмена|не открывай|отменить)[.!?]*$""", RegexOption.IGNORE_CASE)
        val CONFIRM_OPEN = Regex("""(?:точно|подтверд|открыть|открою|запустить)""", RegexOption.IGNORE_CASE)
    }
}
