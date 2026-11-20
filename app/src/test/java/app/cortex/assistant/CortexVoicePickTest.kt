package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Locale

class CortexVoicePickTest {
    private val ru = Locale.forLanguageTag("ru-RU")
    private fun voice(name: String, locale: Locale = ru, installed: Boolean = true, network: Boolean = false) =
        CortexVoicePick.Candidate(name, locale, installed, network)

    @Test fun picksAnInstalledMaleRussianVoiceAndNeverAFemaleOne() {
        val voices = listOf(voice("ru-RU-language#female_1-local"), voice("ru-RU-language#male_2-local"),
            voice("en-US-language#male_1-local", Locale.US), voice("ru-RU-language#male_1-network", network = true))
        assertEquals("ru-RU-language#male_2-local", CortexVoicePick.choose(voices, online = true)?.name)
    }

    @Test fun keepsTheEngineDefaultWhenNoMaleVoiceIsKnown() {
        assertNull(CortexVoicePick.choose(listOf(voice("ru-ru-x-ruc-local"), voice("ru-RU-language#female_2-local")), online = true))
        assertNull(CortexVoicePick.choose(listOf(voice("ru-RU-language#male_1-network", network = true)), online = false))
        assertNull(CortexVoicePick.choose(listOf(voice("ru-RU-language#male_1-local", installed = false)), online = true))
    }

    @Test fun recognisesRhVoiceMaleSpeakers() {
        assertEquals("rhvoice-ru-aleksandr", CortexVoicePick.choose(listOf(voice("rhvoice-ru-anna"), voice("rhvoice-ru-aleksandr")), online = false)?.name)
    }
}
