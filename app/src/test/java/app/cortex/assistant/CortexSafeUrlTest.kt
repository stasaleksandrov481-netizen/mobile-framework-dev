package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CortexSafeUrlTest {
    @Test fun acceptsNormalHttpsLinks() {
        assertEquals("https://cortexapp.ru/help?q=hi", CortexSafeUrl.parse("https://cortexapp.ru/help?q=hi")?.toString())
    }

    @Test fun rejectsDangerousOrAmbiguousLinks() {
        listOf("javascript:alert(1)", "http://example.com", "https://", "https://evil.test@trusted.test/",
            "https://host.test\\@evil.test/", "https://host.test/\nheader: yes", "https://host.test:0/",
            "https://host.test:65536/", "intent://evil.test/", "https://user:password@host.test/",
            "https://127.0.0.1/admin", "https://192.168.1.1/", "https://[::1]/", "https://printer.local/"
        ).forEach { assertNull(it, CortexSafeUrl.parse(it)) }
    }
}
