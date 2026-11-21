package app.cortex.assistant

/** A process-wide revision that can be checked without decrypting a bearer on the UI thread. */
internal class CortexSessionScope {
    @Volatile var revision = 0L
        private set

    fun accepts(expected: Long?): Boolean = expected == null || revision == expected

    @Synchronized fun <T> read(expected: Long?, read: () -> T): T {
        if (!accepts(expected)) throw Changed()
        return read()
    }

    @Synchronized fun <T> advance(expected: Long? = null, write: () -> T): T {
        if (!accepts(expected)) throw Changed()
        try {
            return write()
        } finally {
            // An interrupted multi-step write can have persisted new credentials.
            revision++
        }
    }

    class Changed : IllegalStateException()
}
