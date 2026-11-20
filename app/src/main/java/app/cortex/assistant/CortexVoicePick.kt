package app.cortex.assistant

import java.util.Locale

/**
 * Picks a male Russian voice for the Android TTS fallback so CORTEX does not
 * switch to a random (often female) system voice when cloud speech fails.
 * Android exposes no gender API; engines that encode it in the voice name
 * (Google "ru-RU-language#male_1-local", RHVoice male speakers) are matched,
 * otherwise the engine default is kept.
 */
internal object CortexVoicePick {
    data class Candidate(val name: String, val locale: Locale, val installed: Boolean, val network: Boolean)

    private val male = Regex("""(?:^|[^a-z])male|(?:^|[#_\-.])(?:aleksandr|artemiy|mikhail|pavel|yuriy|denis|timofey|vitaliy|dmitri|maxim)""")

    fun choose(voices: Collection<Candidate>, online: Boolean): Candidate? = voices
        .asSequence()
        .filter { it.locale.language == "ru" && it.installed && (online || !it.network) }
        .filter { male.containsMatchIn(it.name.lowercase(Locale.ROOT)) }
        // Prefer an on-device voice: it starts instantly and works without network.
        .sortedWith(compareBy<Candidate> { it.network }.thenBy { it.name })
        .firstOrNull()
}
