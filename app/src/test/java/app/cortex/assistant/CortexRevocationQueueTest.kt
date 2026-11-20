package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Test

class CortexRevocationQueueTest {
    @Test fun preservesAnEarlierOfflineLogoutWhenAddingAnother() {
        val legacy = CortexRevocationQueue.decode("first")
        val queued = CortexRevocationQueue.append(legacy, "second")
        assertEquals(listOf("first", "second"), CortexRevocationQueue.decode(CortexRevocationQueue.encode(queued)))
    }

    @Test fun boundsTheQueueAndDeduplicatesPersistedTokens() {
        val tokens = (1..16).map(Int::toString)
        assertEquals(tokens, CortexRevocationQueue.append(tokens, "2"))
        assertEquals(tokens.drop(1) + "17", CortexRevocationQueue.append(tokens, "17"))
        assertEquals(emptyList<String>(), CortexRevocationQueue.decode("[broken"))
    }
}
