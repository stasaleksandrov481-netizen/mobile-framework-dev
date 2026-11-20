package app.cortex.assistant

import java.text.Normalizer
import java.util.Locale

internal object CortexHotword {
    // Matched against a lower-cased copy: recognisers often capitalise the final
    // result ("Кортекс, …") while partials are lower case, and Cyrillic case folding
    // in IGNORE_CASE is not guaranteed on every regex engine. The list covers common
    // on-device misrecognitions of the name.
    private val address = Regex(
        """^[\s«"„]*(?:(?:эй|ей|хей|hey|окей|ок|ok|привет|пожалуйста|слушай|бро|ну|алло)[\s,.:;!?—–-]+)?""" +
            """(?:кортекс|кортэкс|кортексу|кортекса|кортексе|кортекст|кортекз|кортес|кортэс|картекс|картэкс|кортикс|коротекс|кор текс|""" +
            """cortex|kortex|kortecs|cortecs)(?=$|[\s,.:;!?«»"—–-])"""
    )
    private val ru = Locale.forLanguageTag("ru")

    fun command(text: String): String? {
        val normalized = Normalizer.normalize(text, Normalizer.Form.NFKC)
        val lower = normalized.lowercase(ru).replace('ё', 'е')
        // Lower-casing Cyrillic and Latin keeps string length, so indices map back;
        // in the rare case it does not, match the original text instead.
        val source = if (lower.length == normalized.length) lower else normalized
        val prefix = address.find(source) ?: return null
        return normalized.substring(prefix.range.last + 1).trimStart {
            it.isWhitespace() || it in ",.:;!?«»\"—–-"
        }.trim()
    }
}
