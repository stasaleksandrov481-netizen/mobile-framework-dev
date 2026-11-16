package app.cortex.assistant

/** Resource names vary by manufacturer and app; do not rely on isPassword alone. */
internal object CortexSensitiveUi {
    private val privateField = Regex(
        """(?i)(?:password|passwd|passcode|passphrase|private[_-]?key|secret[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|credit[_-]?card|card[_-]?number|cardnumber|card[_-]?cvc|card[_-]?cvv|security[_-]?code|verification[_-]?code|verificationcode|sms[_-]?code|smscode|otp|one[_-]?time|two[_-]?factor|2fa|mfa|pin[_-]?code|pincode|cvv|cvc)"""
    )

    fun privateField(resourceId: String?, hint: String?): Boolean =
        privateField.containsMatchIn(resourceId.orEmpty().substringAfterLast('/')) ||
            privateField.containsMatchIn(hint.orEmpty()) ||
            CortexSensitiveText.containsSecret(hint.orEmpty())
}
