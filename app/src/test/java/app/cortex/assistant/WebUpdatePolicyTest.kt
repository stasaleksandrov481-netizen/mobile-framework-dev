package app.cortex.assistant

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebUpdatePolicyTest {
    @Test fun bundleIsDroppedWhenTheInstalledApkChanges() {
        assertFalse(WebUpdatePolicy.supersededByApk(127, 127))
        assertTrue(WebUpdatePolicy.supersededByApk(127, 128))
        assertTrue(WebUpdatePolicy.supersededByApk(128, 127))
        // Bundles activated before the APK was recorded cannot prove they match this native bridge.
        assertTrue(WebUpdatePolicy.supersededByApk(0, 127))
    }

    @Test fun cleanupKeepsActiveRollbackAndLiveSnapshots() {
        val keep = setOf(0L, 2026111602L, 2026111601L)
        assertFalse(WebUpdatePolicy.obsolete("v2026111602", keep, Long.MAX_VALUE))
        assertFalse(WebUpdatePolicy.obsolete("v2026111601", keep, Long.MAX_VALUE))
        assertTrue(WebUpdatePolicy.obsolete("v2026111500", keep, 0L))
    }

    @Test fun cleanupNeverTouchesInFlightOrUnknownDirectories() {
        assertFalse(WebUpdatePolicy.obsolete("staging-1234", emptySet(), 60_000L))
        assertTrue(WebUpdatePolicy.obsolete("staging-1234", emptySet(), 31 * 60_000L))
        listOf("v0", "v", "vx1", "v01", "cache", "../v1").forEach {
            assertFalse(it, WebUpdatePolicy.obsolete(it, emptySet(), Long.MAX_VALUE))
        }
    }
}
