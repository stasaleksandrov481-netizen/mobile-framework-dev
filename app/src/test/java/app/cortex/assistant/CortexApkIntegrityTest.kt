package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CortexApkIntegrityTest {
    @Test fun unsignedOrResignedApkNeverSendsDeviceId() {
        assertNull(CortexApkIntegrity.deviceHeaderValue(false, "cafebabe12345678"))
        assertNull(CortexApkIntegrity.deviceHeaderValue(false, null))
    }

    @Test fun approvedApkOnlySendsExistingDeviceId() {
        assertEquals("cafebabe12345678", CortexApkIntegrity.deviceHeaderValue(true, "cafebabe12345678"))
        assertNull(CortexApkIntegrity.deviceHeaderValue(true, null))
    }
}
