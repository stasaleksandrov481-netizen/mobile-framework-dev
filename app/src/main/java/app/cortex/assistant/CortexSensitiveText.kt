package app.cortex.assistant

/** Never pass transient credentials from a notification or screen to speech or an AI model. */
internal object CortexSensitiveText {
    private val verification = Regex(
        """(?iu)(?:\b(?:otp|2fa|mfa|pin|cvv|cvc|passcode|password|verification[\s_-]*code|security[\s_-]*code|one[\s_-]*time|reset[\s_-]*code|auth[\s_-]*code|login[\s_-]*code)\b|код\s*(?:из\s*смс|подтвержден(?:ия|ие)|для\s*входа|восстановления|безопасности|доступа)|одноразов(?:ый|ого|ым)\s*(?:код|парол)|парол[ья]|пин[ -]?код|код\s*авторизац|двухфакторн|подтвердите\s*вход)"""
    )
    private val longNumber = Regex("""(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)""")
    private val inlineCode = Regex("""(?iu)(?:\b(?:code|otp|pin)\b|код|парол[ья])\s*[:№#=-]?\s*\d{4,10}\b""")
    private val credential = Regex(
        """(?iu)(?:\b(?:bearer|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|secret[_ -]?key)\b\s*[:= ]\s*\S+|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)"""
    )

    fun containsSecret(text: String): Boolean = verification.containsMatchIn(text) || inlineCode.containsMatchIn(text) ||
        longNumber.containsMatchIn(text) || credential.containsMatchIn(text)

    fun notificationPart(title: String, body: String): String {
        // Hide *both* fields: the code may appear in the title, while the body
        // supplies the context needed to recognize an otherwise plain number.
        if (containsSecret("$title $body")) return "Защищённое уведомление"
        return listOf(title, body).filter(String::isNotBlank).joinToString(": ")
    }
}
