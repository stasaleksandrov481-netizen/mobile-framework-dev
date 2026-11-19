package app.cortex.assistant

import org.junit.Assert.*
import org.junit.Test

class FirstExperienceLifecycleTest {
    @Test fun `old visible island cannot satisfy a queued new start`() {
        val lease = FirstExperienceIslandSession()
        lease.request("new")
        // report() may have rendered a fully opaque view before Android dispatches onStartCommand.
        assertFalse(lease.ready("new", attached = true, stopping = false, opacity = 1f))
        assertFalse(lease.available("new", attached = true, stopping = false))
        assertTrue(lease.acknowledge("new"))
        assertTrue(lease.ready("new", attached = true, stopping = false, opacity = 1f))
    }

    @Test fun `queued service start then 340ms fade never becomes permission loss`() {
        val lease = FirstExperienceIslandSession()
        lease.request("demo")
        assertFalse(lease.ready("demo", true, false, 1f))
        lease.acknowledge("demo")
        for (opacity in listOf(0f, .18f, .53f, .9f)) {
            assertFalse(lease.ready("demo", true, false, opacity))
            // The ongoing watchdog deliberately has no visual opacity input.
            assertNull(FirstExperienceHealth.failure(true, true, true, true,
                lease.available("demo", attached = true, stopping = false)))
        }
        assertTrue(lease.ready("demo", true, false, 1f))
    }

    @Test fun `duplicate start cannot restart the entrance animation`() {
        val lease = FirstExperienceIslandSession()
        lease.request("demo")
        assertTrue(lease.acknowledge("demo"))
        assertFalse(lease.acknowledge("demo"))
        assertTrue(lease.ready("demo", true, false, 1f))
    }

    @Test fun `late old intents and cleanup cannot take over a new session`() {
        val lease = FirstExperienceIslandSession()
        lease.request("old")
        lease.acknowledge("old")
        lease.request("new")
        assertFalse(lease.accepts("old"))
        assertFalse(lease.acknowledge("old"))
        assertFalse(lease.release("old"))
        assertFalse(lease.ready("new", true, false, 1f))
        assertTrue(lease.acknowledge("new"))
        assertTrue(lease.available("new", true, false))
    }

    @Test fun `detached island and real service shutdown remain unavailable`() {
        val lease = FirstExperienceIslandSession()
        lease.request("demo")
        lease.acknowledge("demo")
        assertFalse(lease.available("demo", attached = false, stopping = false))
        assertFalse(lease.available("demo", attached = true, stopping = true))
        assertEquals(FirstExperienceStopReason.ISLAND,
            FirstExperienceHealth.failure(true, true, true, true, false))
    }

    @Test fun `actual lock or revoked access stops with the specific cause`() {
        assertEquals(FirstExperienceStopReason.ACCESSIBILITY,
            FirstExperienceHealth.failure(false, true, true, true, true))
        assertEquals(FirstExperienceStopReason.SCREEN_LOCKED,
            FirstExperienceHealth.failure(true, false, true, true, true))
        assertEquals(FirstExperienceStopReason.OVERLAY_PERMISSION,
            FirstExperienceHealth.failure(true, true, false, true, true))
        assertEquals(FirstExperienceStopReason.ORIENTATION,
            FirstExperienceHealth.failure(true, true, true, false, true))
        assertNull(FirstExperienceHealth.failure(true, true, true, true, true))
    }

    @Test fun `permission cause is not overwritten by the hidden island consequence`() {
        assertEquals(FirstExperienceStopReason.OVERLAY_PERMISSION,
            FirstExperienceHealth.failure(true, true, false, true, false))
        assertEquals(FirstExperienceStopReason.ACCESSIBILITY,
            FirstExperienceHealth.failure(false, false, true, true, false))
    }

    @Test fun `releasing the owner clears readiness and invalid identifiers are rejected`() {
        val lease = FirstExperienceIslandSession()
        assertFalse(lease.accepts(""))
        assertTrue(runCatching { lease.request(" ") }.isFailure)
        lease.request("demo")
        lease.acknowledge("demo")
        assertTrue(lease.release("demo"))
        assertFalse(lease.ready("demo", true, false, 1f))
        assertFalse(lease.available("demo", true, false))
    }
}
