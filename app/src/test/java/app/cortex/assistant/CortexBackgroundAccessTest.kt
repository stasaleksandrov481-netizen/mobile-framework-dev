package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CortexBackgroundAccessTest {
    @Test fun vendorScreensMatchTheShellNotOtherBrands() {
        assertEquals(listOf("com.miui.securitycenter"), CortexBackgroundAccess.vendorScreens("Xiaomi").map { it.packageName })
        assertEquals(listOf("com.vivo.permissionmanager", "com.iqoo.secure"),
            CortexBackgroundAccess.vendorScreens("vivo").map { it.packageName })
        assertEquals(listOf("com.coloros.safecenter", "com.oplus.safecenter"),
            CortexBackgroundAccess.vendorScreens("OPPO").map { it.packageName })
        assertEquals(listOf("com.hihonor.systemmanager"), CortexBackgroundAccess.vendorScreens("HONOR").map { it.packageName })
        // Pixel, Motorola and unknown brands use Android's own battery settings only.
        for (brand in listOf("Google", "motorola", "Nothing", "")) {
            assertTrue(brand, CortexBackgroundAccess.vendorScreens(brand).isEmpty())
        }
    }
}
