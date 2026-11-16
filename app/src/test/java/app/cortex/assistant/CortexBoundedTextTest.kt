package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.StringReader

class CortexBoundedTextTest {
    @Test fun permitsSmallAndExactlyLimitedResponses() {
        assertEquals("{}", CortexBoundedText.read(StringReader("{}"), 2))
        assertEquals("", CortexBoundedText.read(StringReader(""), 1))
    }

    @Test fun rejectsOversizedOrUnboundedResponses() {
        assertThrows(IllegalArgumentException::class.java) {
            CortexBoundedText.read(StringReader("abcdef"), 5)
        }
        assertThrows(IllegalArgumentException::class.java) {
            CortexBoundedText.read(StringReader("x".repeat(60_000)), 16_384)
        }
        assertThrows(IllegalArgumentException::class.java) {
            CortexBoundedText.read(StringReader("ok"), Int.MAX_VALUE)
        }
    }
}
