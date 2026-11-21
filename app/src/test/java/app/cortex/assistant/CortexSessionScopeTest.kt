package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CortexSessionScopeTest {
    @Test fun queuedRequestCannotReadCredentialsFromNewSession() {
        val scope = CortexSessionScope()
        var bearer = "first"
        val original = scope.revision
        assertEquals("first", scope.read(original) { bearer })
        scope.advance { bearer = "second" }

        assertThrows(CortexSessionScope.Changed::class.java) {
            scope.read(original) { error("The stale request accessed shared storage") }
        }
        assertFalse(scope.accepts(original))
        assertEquals("second", scope.read(scope.revision) { bearer })
    }

    @Test fun signingBackIntoTheSameAccountDoesNotReviveOldRequests() {
        val scope = CortexSessionScope()
        val original = scope.revision
        scope.advance { }
        scope.advance { }
        val current = scope.revision

        assertThrows(CortexSessionScope.Changed::class.java) {
            scope.advance(original) { error("Queued sign-out touched the new session") }
        }
        assertTrue(scope.accepts(current))
        assertFalse(scope.accepts(original))
    }

    @Test fun failedWriteStillInvalidatesThePreviousLease() {
        val scope = CortexSessionScope()
        val original = scope.revision
        assertThrows(IllegalArgumentException::class.java) {
            scope.advance { throw IllegalArgumentException("Partially written") }
        }
        assertFalse(scope.accepts(original))
    }
}
