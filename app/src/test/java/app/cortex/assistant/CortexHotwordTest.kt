package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CortexHotwordTest {
    @Test fun capitalisedFinalResultsMatchLikeLowerCasePartials() {
        assertEquals("открой камеру", CortexHotword.command("Кортекс, открой камеру"))
        assertEquals("открой камеру", CortexHotword.command("кортекс открой камеру"))
        assertEquals("который час", CortexHotword.command("КОРТЕКС, который час?")?.trimEnd('?'))
        assertEquals("Включи фонарик", CortexHotword.command("Эй, Кортекс! Включи фонарик"))
    }

    @Test fun commonMisrecognitionsOfTheNameStillWake() {
        for (heard in listOf("Кортес, позвони маме", "картэкс позвони маме", "Коротекс позвони маме",
                "кор текс позвони маме", "Cortex позвони маме", "Ну кортекс, позвони маме", "алло Кортекса позвони маме")) {
            assertEquals(heard, "позвони маме", CortexHotword.command(heard))
        }
        assertEquals("", CortexHotword.command("Кортекс"))
    }

    @Test fun ordinaryWordsAndMentionsInsideASentenceDoNotWake() {
        assertNull(CortexHotword.command("корт и теннис"))
        assertNull(CortexHotword.command("я установил кортекс вчера"))
        assertNull(CortexHotword.command("кортексный слой мозга"))
        assertNull(CortexHotword.command("Кортеж проехал"))
    }
}
