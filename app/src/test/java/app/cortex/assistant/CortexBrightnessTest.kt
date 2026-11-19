package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CortexBrightnessTest {
    private class Settings(
        var raw: Int? = 128,
        var automaticMode: Int? = 1,
        var acceptBrightness: Boolean = true,
        var acceptMode: Boolean = true,
        var ignoreBrightness: Boolean = false
    ) : CortexBrightness.Port {
        val writes = mutableListOf<String>()
        override fun brightness() = raw
        override fun mode() = automaticMode
        override fun writeBrightness(value: Int): Boolean {
            writes += "brightness:$value"
            if (acceptBrightness && !ignoreBrightness) raw = value
            return acceptBrightness
        }
        override fun writeMode(value: Int): Boolean {
            writes += "mode:$value"
            if (acceptMode) automaticMode = value
            return acceptMode
        }
    }

    @Test fun `relative brightness changes are read back and disable automatic brightness`() {
        val settings = Settings()
        val changed = CortexBrightness.apply(settings, "up", 20)
        assertEquals("done", changed.status)
        assertEquals(70, changed.percent)
        assertEquals(0, settings.automaticMode)
        assertEquals(179, settings.raw)
        assertEquals(listOf("mode:0", "brightness:179"), settings.writes)
        assertEquals("done", CortexBrightness.apply(settings, "down", 20).status)
        assertEquals(50, CortexBrightness.apply(settings, "status").percent)
    }

    @Test fun `write reported as successful without a value change is never confirmed`() {
        val settings = Settings(ignoreBrightness = true)
        val result = CortexBrightness.apply(settings, "set", 80)
        assertEquals("unavailable", result.status)
        assertEquals(128, settings.raw)
        assertEquals(1, settings.automaticMode)
        assertEquals(listOf("mode:0", "brightness:204", "mode:1"), settings.writes)
    }

    @Test fun `partial failure rolls original brightness and mode back`() {
        val settings = Settings(acceptBrightness = false)
        assertEquals("unavailable", CortexBrightness.apply(settings, "up").status)
        assertEquals(128, settings.raw)
        assertEquals(1, settings.automaticMode)
        val sticky = Settings(acceptBrightness = false, acceptMode = true)
        assertEquals("unavailable", CortexBrightness.apply(sticky, "down").status)
        assertEquals(1, sticky.automaticMode)
    }

    @Test fun `unverified rollback stays explicitly unconfirmed`() {
        val settings = Settings(ignoreBrightness = true)
        var modeWrites = 0
        val port = object : CortexBrightness.Port by settings {
            override fun writeMode(value: Int): Boolean {
                modeWrites++
                return if (modeWrites == 2) false else settings.writeMode(value)
            }
        }
        assertEquals("requested", CortexBrightness.apply(port, "set", 40).status)
        assertEquals(0, settings.automaticMode)
    }

    @Test fun `missing settings and unsupported ranges cause no writes`() {
        for (raw in listOf(null, -1, 1023)) {
            val settings = Settings(raw = raw)
            assertEquals("unavailable", CortexBrightness.apply(settings, "up").status)
            assertTrue(settings.writes.isEmpty())
        }
        val missingMode = Settings(automaticMode = null)
        assertEquals("unavailable", CortexBrightness.apply(missingMode, "up").status)
        assertTrue(missingMode.writes.isEmpty())
        val status = CortexBrightness.apply(Settings(), "status")
        assertEquals("done", status.status)
        assertTrue(status.automatic == true)
        assertFalse(CortexBrightness.apply(Settings(automaticMode = 0), "status").automatic == true)
    }

    @Test fun `auto and manual mode updates require readback`() {
        val settings = Settings(automaticMode = 0)
        assertEquals("done", CortexBrightness.apply(settings, "auto").status)
        assertEquals(1, settings.automaticMode)
        val refusing = Settings(acceptMode = false)
        assertEquals("unavailable", CortexBrightness.apply(refusing, "manual").status)
        assertEquals(1, refusing.automaticMode)
    }
}
