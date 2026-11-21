package app.cortex.assistant

import android.app.UiAutomation
import android.content.ComponentName
import android.content.Intent
import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test

/** Real accessibility dispatch against a separate, account-free Android test window. */
class ConversationAndSearchDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
    private val fixture = "qa.cortex.calculator"
    private val fixtureLabel = "CORTEX QA Calculator"

    private suspend fun service(): CortexScreenService {
        if (CortexScreenService.connected == null) withContext(Dispatchers.IO) {
            for (command in listOf(
                "settings delete secure enabled_accessibility_services",
                "settings put secure accessibility_enabled 0",
                "settings put secure enabled_accessibility_services app.cortex.assistant/.CortexScreenService",
                "settings put secure accessibility_enabled 1"
            )) {
                ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command)).use { it.readBytes() }
            }
        }
        return withTimeout(20_000L) {
            while (CortexScreenService.connected == null) delay(100L)
            requireNotNull(CortexScreenService.connected)
        }
    }

    private suspend fun launch(mode: String): CortexScreenService {
        val screen = service()
        context.startActivity(Intent().setComponent(ComponentName(fixture, "$fixture.SearchActivity"))
            .putExtra("mode", mode).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        withTimeout(12_000L) {
            while (true) {
                val frame = screen.frame(fresh = true)
                if (frame?.pkg == fixture && frame.tree.any { node ->
                    when (mode) {
                        "chat" -> node.label == "Рыбка"
                        "chat-search" -> node.editable && ScreenSearch.searchLabel(node)
                        else -> node.label.contains("Загрузка приложения")
                    }
                }) break
                delay(85L)
            }
        }
        return screen
    }

    private fun draftVisible(screen: CortexScreenService, value: String): Boolean {
        val frame = screen.frame(fresh = true) ?: return false
        return frame.pkg == fixture && frame.tree.any { it.editable && screen.fieldMatches(frame, it, value) }
    }

    @Test fun visibleRecentConversationIsOpenedWithoutCloudAndDraftVerified() = runBlocking(Dispatchers.Main) {
        val screen = launch("chat")
        // Android has granted the service; the same grant is present even when
        // the consumer is still waiting for a bound instance.
        val access = CortexDeviceContext.screenAccess(context, null)
        assertTrue(access == CortexDeviceContext.ScreenAccess.CONNECTING && access.granted)
        assertTrue(CortexDeviceContext.permissions(context).optString("screenAccess") == "ready")
        assertTrue(CortexDeviceContext.permissionAnswer(context, "У тебя есть доступ к экрану?", false)
            ?.contains("Визуальное управление БЕТА отдельно выключено") == true)
        val request = ConversationRequest(fixtureLabel, "рыбке", "Привет!", send = false)
        val result = ConversationNavigation(screen, VisualNavigation(context, screen), { _, _, _ -> false })
            .run(request, {})
        assertTrue(result.text, result.ok)
        assertTrue(draftVisible(screen, "Привет!"))
    }

    @Test fun inflectedSearchResultIsOpenedAfterSearchAndDraftVerified() = runBlocking(Dispatchers.Main) {
        val screen = launch("chat-search")
        val request = ConversationRequest(fixtureLabel, "рыбке", "Как дела?", send = false)
        val result = ConversationNavigation(screen, VisualNavigation(context, screen), { _, _, _ -> false })
            .run(request, {})
        assertTrue(result.text, result.ok)
        assertTrue(draftVisible(screen, "Как дела?"))
    }

    @Test fun messageIsNotTypedOrSentWhenUserDeclinesConfirmation() = runBlocking(Dispatchers.Main) {
        val screen = launch("chat")
        var confirmations = 0
        val result = ConversationNavigation(screen, VisualNavigation(context, screen), { _, detail, _ ->
            confirmations++
            assertTrue(detail.contains("Рыбка"))
            false
        }).run(ConversationRequest(fixtureLabel, "рыбке", "Секретный текст", send = true), {})
        assertFalse(result.ok)
        assertEquals(1, confirmations)
        assertFalse(draftVisible(screen, "Секретный текст"))
    }

    @Test fun delayedAppSearchWaitsForRealButtonAndSearchResults() = runBlocking(Dispatchers.Main) {
        val screen = launch("search-slow")
        val result = ScreenSearch(screen, VisualNavigation(context, screen))
            .find(AppSearchRequest(fixtureLabel, "гта 6"), {})
        assertTrue(result.text, result.ok)
        val frame = requireNotNull(screen.frame(fresh = true))
        assertTrue(frame.tree.any { !it.editable && it.label.contains("гта 6", ignoreCase = true) })
    }
}
