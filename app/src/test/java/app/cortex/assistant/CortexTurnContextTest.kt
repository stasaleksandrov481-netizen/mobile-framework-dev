package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Test

class CortexTurnContextTest {
    @Test fun appPronounRefersToRecentNamedApp() {
        val context = CortexTurnContext()
        context.observeUser("Кортекс, открой YouTube", "alice", 1000L)
        assertEquals("открой YouTube", context.resolve("Да, открой ЕГО", "alice", 1200L))
    }

    @Test fun yesOnlyActsWhenAssistantExplicitlyAskedToOpen() {
        val context = CortexTurnContext()
        context.observeUser("открой Telegram", "alice", 1000L)
        assertEquals("да", context.resolve("да", "alice", 1200L))
        context.observeAnswer("Точно открыть Telegram?", "alice", 1400L)
        assertEquals("открой Telegram", context.resolve("да", "alice", 1500L))
        assertEquals("да", context.resolve("да", "alice", 1700L))
    }

    @Test fun expiredContextAndOtherAccountsCannotInheritApp() {
        val context = CortexTurnContext()
        context.observeUser("открой TikTok", "alice", 1000L)
        assertEquals("открой его", context.resolve("открой его", "bob", 1001L))
        context.observeUser("открой TikTok", "alice", 2000L)
        assertEquals("открой его", context.resolve("открой его", "alice", 190_001L))
    }

    @Test fun neverUsesTheAppReferenceForMessagesOrPayments() {
        val context = CortexTurnContext()
        context.observeUser("открой WhatsApp", "alice", 1000L)
        for (unsafe in listOf("напиши ему привет", "отправь ему деньги",
            "удали его", "нажми подтвердить оплату")) {
            assertEquals(unsafe, context.resolve(unsafe, "alice", 2000L))
        }
    }

    @Test fun cancellationDoesNotConfirmPendingAction() {
        val context = CortexTurnContext()
        context.observeUser("открой YouTube", "alice", 1000L)
        context.observeAnswer("Точно открыть?", "alice", 1100L)
        assertEquals("нет", context.resolve("нет", "alice", 1200L))
        assertEquals("да", context.resolve("да", "alice", 1300L))
    }
}
