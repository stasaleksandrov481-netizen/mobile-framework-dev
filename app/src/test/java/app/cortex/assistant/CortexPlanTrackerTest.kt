package app.cortex.assistant

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CortexPlanTrackerTest {
    @Test fun repeatedPlanOnUnchangedScreenStops() {
        val tracker = CortexPlanTracker()
        assertTrue(tracker.accept("screen-1:tap-settings"))
        assertTrue(tracker.accept("screen-1:tap-settings"))
        assertFalse(tracker.accept("screen-1:tap-settings"))
    }

    @Test fun newScreenResetsStallCounter() {
        val tracker = CortexPlanTracker()
        assertTrue(tracker.accept("screen-1:tap-settings"))
        assertTrue(tracker.accept("screen-1:tap-settings"))
        assertTrue(tracker.accept("screen-2:tap-settings"))
        assertTrue(tracker.accept("screen-2:tap-settings"))
        assertFalse(tracker.accept("screen-2:tap-settings"))
    }

    @Test fun acceptedActionsDoNotHideAnUnchangedScreenLoop() {
        val tracker = CortexPlanTracker()
        assertTrue(tracker.accept("same-screen:tap-refresh"))
        assertTrue(tracker.accept("same-screen:tap-refresh"))
        // A previous tap may be accepted by Android even if it accomplished nothing.
        assertFalse(tracker.accept("same-screen:tap-refresh"))
    }
}
