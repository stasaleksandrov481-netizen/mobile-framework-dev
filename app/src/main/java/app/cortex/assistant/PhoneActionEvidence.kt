package app.cortex.assistant

/** Model text can describe what to do. Only observed Android actions can report completion. */
internal object PhoneActionEvidence {
    private val claim = Regex("""(?iu)(?<![\p{L}\p{N}_])(?:отправил[аи]?|переслал[аи]?|написал[аи]?|отправлено|доставлено|доставлен[аы]?|опубликовал[аи]?|опубликовано|выложил[аи]?|открыл[аи]?|запустил[аи]?|удалил[аи]?|создал[аи]?|установил[аи]?|включил[аи]?|выключил[аи]?|заблокировал[аи]?|заказал[аи]?|купил[аи]?|сдал[аи]?|решил[аи]?)(?![\p{L}\p{N}_])""")
    private val denied = Regex("""(?iu)\b(?:не|не\s+смог|не\s+удалось)\s+$""")

    fun containsClaim(text: String): Boolean = claim.findAll(text).any { found ->
        !denied.containsMatchIn(text.substring(maxOf(0, found.range.first - 24), found.range.first))
    }
}
