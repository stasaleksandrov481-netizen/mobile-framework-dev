package app.cortex.assistant

import android.app.UiAutomation
import android.content.ComponentName
import android.content.Intent
import android.os.ParcelFileDescriptor
import android.provider.Settings
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import org.junit.rules.TestName
import java.io.File

/** Drives separate real Android windows through the production service/gesture/readback adapters. */
class FirstExperienceDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
    private val fixture = "qa.cortex.calculator"
    private var captureName = "device"
    @get:Rule val testName = TestName()

    private suspend fun service(): CortexScreenService {
        if (CortexScreenService.connected == null) withContext(Dispatchers.IO) {
            // am instrument force-stops the target before starting its runner. Enabling
            // the service outside instrumentation is therefore lost; bind it AFTER start.
            for (command in listOf("settings delete secure enabled_accessibility_services",
                "settings put secure accessibility_enabled 0",
                "settings put secure enabled_accessibility_services app.cortex.assistant/.CortexScreenService",
                "settings put secure accessibility_enabled 1")) {
                ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command)).use { it.readBytes() }
            }
        }
        return withTimeout(20_000L) {
            while (CortexScreenService.connected == null) delay(100L)
            requireNotNull(CortexScreenService.connected)
        }
    }

    private suspend fun calculator(mode: String): FirstExperienceCalculator {
        captureName = mode
        val service = service()
        context.startActivity(Intent().setComponent(ComponentName(fixture, "$fixture.CalculatorActivity"))
            .putExtra("mode", mode).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        withTimeout(8_000L) { while (service.activePackage() != fixture) delay(100L) }
        val calculator = FirstExperienceCalculator(context, service, {}, VisualApp("QA calculator", fixture)) {
            delay(minOf(it, 80L)) // Test pacing only; production keeps its full visible pauses.
        }
        assertTrue("open $mode", calculator.open())
        assertTrue(calculator.failure, calculator.clear())
        return calculator
    }

    @After fun capture() {
        val folder = context.getExternalFilesDir("device-tests") ?: return
        folder.mkdirs()
        val bitmap = automation.takeScreenshot() ?: return
        try { File(folder, "${testName.methodName}-$captureName.png").outputStream().use {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        } } finally { bitmap.recycle() }
    }

    @Test fun disabledDisplayAndUnfamiliarIntermediateFormula() = runBlocking(Dispatchers.Main) {
        val calculator = calculator("normal")
        assertTrue(calculator.failure, calculator.calculate(FirstExperienceMath.example))
        for (number in listOf(1, 17, 99)) {
            assertTrue(calculator.clear())
            assertTrue(calculator.failure, FirstExperienceMath.performPrediction(number) { _, step -> calculator.calculate(step) })
        }
    }

    @Test fun resultAvailableOnlyInChangingDescription() = runBlocking(Dispatchers.Main) {
        val calculator = calculator("description")
        assertTrue(calculator.failure, calculator.calculate(FirstExperienceMath.example))
        assertTrue(calculator.clear())
        assertTrue(calculator.failure, FirstExperienceMath.performPrediction(17) { _, step -> calculator.calculate(step) })
    }

    @Test fun unfamiliarOemDisplayIdStillUsesVerifiedNumericResult() = runBlocking(Dispatchers.Main) {
        val calculator = calculator("unknown_display")
        assertTrue(calculator.failure, calculator.calculate(FirstExperienceMath.example))
        assertTrue(calculator.clear())
        assertTrue(calculator.failure, FirstExperienceMath.performPrediction(17) { _, step -> calculator.calculate(step) })
    }

    @Test fun clearKeyMayBeHiddenWhileCalculatorIsAlreadyEmpty() = runBlocking(Dispatchers.Main) {
        val calculator = calculator("hidden_clear")
        assertTrue(calculator.failure, calculator.calculate(FirstExperienceMath.example))
        assertTrue(calculator.clear())
        assertTrue(calculator.failure, FirstExperienceMath.performPrediction(17) { _, step -> calculator.calculate(step) })
    }

    @Test fun delayedEqualityDoesNotGetSkipped() = runBlocking(Dispatchers.Main) {
        val calculator = calculator("delayed")
        assertTrue(calculator.failure, calculator.calculate(FirstExperienceMath.example))
    }

    @Test fun renderedValueWithoutAccessibleTextUsesLocalOcr() = runBlocking(Dispatchers.Main) {
        val calculator = calculator("opaque")
        assertTrue(calculator.failure, calculator.calculate(FirstExperienceMath.example))
        assertTrue(calculator.clear())
        assertTrue(calculator.failure, FirstExperienceMath.performPrediction(17) { _, step -> calculator.calculate(step) })
    }

    @Test fun correctPreviewCannotHideWrongFinalAnswer() = runBlocking(Dispatchers.Main) {
        val calculator = calculator("wrong")
        assertFalse(calculator.calculate(FirstExperienceMath.example))
        assertTrue(calculator.failure.orEmpty().contains("588"))
        assertTrue(calculator.clear())
        assertFalse(calculator.calculate(FirstExperienceMath.Calculation(listOf("3", "+", "3", "="), 5)))
    }

    @Test fun disabledNextKeyStopsBeforeEquals() = runBlocking(Dispatchers.Main) {
        val calculator = calculator("missing")
        assertFalse(calculator.calculate(FirstExperienceMath.example))
        assertTrue(calculator.failure.orEmpty().contains("7"))
        val service = service()
        val frame = requireNotNull(service.frame(fresh = true))
        val trace = frame.tree.first { it.resource.endsWith("/fixture_trace") }
        assertFalse(service.localText(frame, trace).orEmpty().contains("="))
    }

    @Test fun cancellationAfterMultiplicationSendsNoLaterKeys() = runBlocking(Dispatchers.Main) {
        val calculator = calculator("normal")
        val service = service()
        val job = launch { calculator.calculate(FirstExperienceMath.example) }
        withTimeout(6_000L) {
            while (true) {
                val frame = service.frame(fresh = true)
                val trace = frame?.tree?.firstOrNull { it.resource.endsWith("/fixture_trace") }
                if (frame != null && trace != null && service.localText(frame, trace).orEmpty().endsWith("×")) break
                delay(25L)
            }
        }
        job.cancelAndJoin()
        delay(600L)
        val frame = requireNotNull(service.frame(fresh = true))
        val trace = frame.tree.first { it.resource.endsWith("/fixture_trace") }
        assertTrue(service.localText(frame, trace).orEmpty().endsWith("×"))
    }

    @Test fun homeBrightnessWorksWithoutAnAccessibleSystemUiSlider() = runBlocking(Dispatchers.Main) {
        val service = service()
        val navigation = VisualNavigation(context, service)
        assertTrue(service.global(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME))
        assertNotNull(navigation.await(8_000L) { it.pkg in navigation.home })
        captureName = "home-brightness"
        val resolver = context.contentResolver
        val level = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS)
        val mode = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE)
        val outcome = FirstExperienceBrightness(context, service).runOnHome()
        assertTrue(outcome.message, outcome.performed)
        assertEquals(level, Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS))
        assertEquals(mode, Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE))
        assertFalse(FirstExperienceBrightness.hasPending(context))
    }

    @Test fun stopDuringRealBrightnessRampRestoresSettings() = runBlocking(Dispatchers.Main) {
        calculator("normal")
        captureName = "brightness-restored"
        assertTrue(Settings.System.canWrite(context))
        val resolver = context.contentResolver
        val level = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS)
        val mode = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE)
        val job = launch { FirstExperienceBrightness(context, service()).run() }
        try {
            withTimeout(12_000L) {
                while (!FirstExperienceBrightness.hasPending(context) ||
                    Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS) == level) delay(100L)
            }
            job.cancelAndJoin()
            assertEquals(level, Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS))
            assertEquals(mode, Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE))
            assertFalse(FirstExperienceBrightness.hasPending(context))
        } finally {
            job.cancelAndJoin()
            FirstExperienceBrightness.restorePending(context)
        }
    }
}
