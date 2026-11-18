package app.cortex.assistant

internal data class ConversationRequest(
    val app: String,
    val recipient: String,
    val message: String,
    val send: Boolean
) {
    val question: String get() = when {
        app.isBlank() -> "В каком мессенджере написать? Например, в Telegram или WhatsApp."
        recipient.isBlank() -> "Как точно называется переписка или контакт?"
        message.isBlank() -> "Какой текст написать?"
        else -> ""
    }

    fun withAnswer(text: String): ConversationRequest = if (app.isBlank()) {
        copy(app = messengerName(text).orEmpty())
    } else if (recipient.isBlank()) {
        copy(recipient = recipientName(text))
    } else {
        val mode = draft.find(text.replace(quoted, { " ".repeat(it.value.length) }))
        copy(message = if (mode == null) unquote(text.trim()).take(2_000) else
            unquote(text.removeRange(mode.range).trim().trimEnd(',')).take(2_000),
            send = send && mode == null)
    }

    companion object {
        private val appName = Regex("""(?:^|[\s,])(?:открой|запусти|open)\s+(?:приложение\s+)?(.+?)(?=\s*(?:[,;]|\s+(?:и\s+)?(?:зайди|перейди|найди|открой\s+(?:чат|переписку)|напиши|отправь)\b)|$)""", RegexOption.IGNORE_CASE)
        private val quoted = Regex("""«([^»]+)»|„([^“]+)“|"([^"]+)"""")
        private val appIn = Regex("""\b(?:в|in)\s+([\p{L}\p{N}._ -]+?)(?=\s*[,;:]|\s+(?:и\s+)?(?:найди|зайди|напиши|отправь|контакту|пользователю)\b|$)""", RegexOption.IGNORE_CASE)
        private val chatName = Regex("""(?:чат|переписк\p{L}*|диалог|личку|chat)\s+(?:с\s+|with\s+)?(.+?)(?=\s*(?:[,;:]|\s+(?:и\s+)?(?:напиши|отправь|введи|набери|подготовь)\b)|$)""", RegexOption.IGNORE_CASE)
        private val explanatory = Regex("""^(?:как|почему|объясни|подскажи как|how|why|explain)\b""")
        private val to = Regex("""\b(?:напиши|отправь)\s+(?:(?:сообщение|текст)\s+)?(?:контакту\s+|пользователю\s+)?(.+?)(?=\s*(?:\b(?:в|in)\s+|[:«"]))""", RegexOption.IGNORE_CASE)
        private val composing = Regex("""(?<![\p{L}\p{N}_])(?:напиши|отправь|скинь|набери|подготовь|введи|send|write)(?![\p{L}\p{N}_])""", RegexOption.IGNORE_CASE)
        private val messageMarker = Regex("""\b(?:напиши|отправь|набери|подготовь|введи|send|write)\s*(?:сообщение|текст)?\s*[:—]?\s*(.*)""", RegexOption.IGNORE_CASE)
        private val draft = Regex("""(?<![\p{L}\p{N}_])(?:черновик|не\s+отправляй|без\s+отправки|draft)(?![\p{L}\p{N}_])""", RegexOption.IGNORE_CASE)
        private val genericRecipient = Regex("""^(?:друг\p{L}*|подруг\p{L}*|контакт\p{L}*|человек\p{L}*|собеседник\p{L}*|кому нибудь|с кем нибудь|friend|contact)$""")

        private val knownApp = Regex("""(?<![\p{L}\p{N}_])(?:в|через)\s+(телеграмме?|телеграме?|телеге|телегу|тг|telegram|whatsapp|ватсапе?|вотсапе?|вк|вконтакте|максе?|discord|signal|viber)(?=$|[\s,;:.!?])""", RegexOption.IGNORE_CASE)
        private val shortWrite = Regex("""^(?:пожалуйста,?\s+)?(?:напиши|отправь|скинь)\s+(?:сообщение\s+)?(?:контакту\s+)?(.+)$""", RegexOption.IGNORE_CASE)
        private val immediateMessage = Regex("""^(@[\w.]{3,64}|[\p{L}\p{N}._-]{1,60})[\s,]+((?:как\s+(?:дела|ты|сам(?:а)?)|привет|здравствуй|доброе\s+утро|спасибо|я\s+|мы\s+|ты\s+|вы\s+|давай\s+|буду\s+|до\s+встречи|что\s+|когда\s+|где\s+|жду)[\s\S]*)$""", RegexOption.IGNORE_CASE)

        private fun messengerName(value: String): String? {
            val words = VisualLabels.normalize(value)
                .replace(Regex("""^(?:(?:ну|давай|да|можно|лучше|напиши|отправь|в|через)\s+)+"""), "")
                .replace(Regex("""\s+пожалуйста$"""), "")
            return when (words) {
                "тг", "телега", "телегу", "телеге", "телеграм", "телеграмм", "телеграмме", "телеграме", "telegram", "tg", "первом" -> "Telegram"
                "ватсап", "ватсапе", "вотсап", "вотсапе", "вацап", "вацапе", "whatsapp", "whats app", "втором" -> "WhatsApp"
                "вк", "вконтакте", "vk" -> "ВКонтакте"
                "макс", "максе", "max" -> "MAX"
                "discord", "дискорд", "дискорде" -> "Discord"
                "signal", "сигнал", "сигнале" -> "Signal"
                "viber", "вайбер", "вайбере" -> "Viber"
                else -> null
            }
        }

        private fun simpleRequest(command: String, app: String, send: Boolean): ConversationRequest? {
            val tail = shortWrite.matchEntire(command)?.groupValues?.get(1)?.trim().orEmpty()
            val straight = immediateMessage.matchEntire(tail)
            if (straight != null) {
                val recipient = recipientName(straight.groupValues[1])
                if (recipient.isNotBlank()) return ConversationRequest(app, recipient, straight.groupValues[2].take(2_000), send)
            }
            val quote = quoted.find(tail)?.takeIf { it.range.first > 0 } ?: return null
            val recipient = recipientName(tail.take(quote.range.first).trimEnd(' ', ':', ','))
            val message = quote.groupValues.drop(1).firstOrNull(String::isNotBlank).orEmpty()
            return if (recipient.isNotBlank() && message.isNotBlank()) ConversationRequest(app, recipient, message.take(2_000), send) else null
        }

        fun parse(text: String, resolve: (String) -> Boolean): ConversationRequest? {
            val goal = VisualRequest.goal(text)
            val command = CortexHotword.command(goal) ?: goal
            val unquoted = command.replace(quoted) { " ".repeat(it.value.length) }
            if (explanatory.containsMatchIn(VisualLabels.normalize(unquoted)) || !composing.containsMatchIn(unquoted)) return null
            val chat = chatName.find(command)
            val hasMessage = Regex("""(?<![\p{L}\p{N}_])(?:сообщение|черновик|напиши|отправь|скинь|message)(?![\p{L}\p{N}_])""", RegexOption.IGNORE_CASE)
                .containsMatchIn(command)
            if (chat == null && !hasMessage) return null
            val draftOnly = draft.containsMatchIn(unquoted)
            val appMatch = sequenceOf(appName.findAll(command), knownApp.findAll(command), appIn.findAll(command)).flatten()
                .filter { match -> unquoted.substring(match.range.first).take(4).any { !it.isWhitespace() } }
                .map { it to unquote(it.groupValues[1].trim().trimEnd('.', '!', '?')) }
                .map { (match, name) -> match to (messengerName(name) ?: name.takeIf { it.length in 2..70 && resolve(it) }) }
                .firstOrNull { (_, name) -> name != null }
            val app = appMatch?.second.orEmpty()
            if (chat == null) {
                val simple = if (appMatch == null) command else command.removeRange(appMatch.first.range).trim(' ', ',', ';', ':')
                simpleRequest(simple, app, !draftOnly)?.let { return it }
            }
            if (app.isBlank()) return null
            val recipient = recipientName(chat?.groupValues?.get(1) ?: to.find(command)?.groupValues?.get(1).orEmpty())
            val tail = messageMarker.findAll(command).lastOrNull()?.groupValues?.get(1).orEmpty()
            val quote = quoted.find(tail)?.groupValues?.drop(1)?.firstOrNull(String::isNotBlank)
            val tailWithoutMode = tail.replace(draft, "").trim().trimEnd(',')
            val inline = tailWithoutMode.substringAfter(':', "").trim().takeIf(String::isNotBlank)
            val explicit = if (chat != null) tailWithoutMode else ""
            val message = (quote ?: inline?.let(::unquote) ?: unquote(explicit)).trim().take(2_000)
            return ConversationRequest(app, recipient, message, !draftOnly)
        }

        private fun recipientName(value: String): String {
            val name = unquote(value.trim().trimEnd('.', ',', ';', '!', '?'))
            val clean = VisualLabels.normalize(name)
            return name.takeIf { it.length in 1..90 && clean.isNotBlank() && !genericRecipient.matches(clean) }.orEmpty()
        }

        private fun unquote(value: String) =
            value.removeSurrounding("«", "»").removeSurrounding("„", "“").removeSurrounding("\"")
    }
}
