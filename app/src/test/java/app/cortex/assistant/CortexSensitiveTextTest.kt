package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CortexSensitiveTextTest {
    @Test fun hidesVerificationCodesInEitherField() {
        assertEquals("Защищённое уведомление", CortexSensitiveText.notificationPart("Ваш код: 123456", "Для входа"))
        assertEquals("Защищённое уведомление", CortexSensitiveText.notificationPart("Вход", "Your one-time code is 892001"))
        assertEquals("Защищённое уведомление", CortexSensitiveText.notificationPart("Bank", "Подтвердите вход в приложение"))
    }

    @Test fun hidesCardsAndAccessTokens() {
        assertTrue(CortexSensitiveText.containsSecret("Card 4111 1111 1111 1111"))
        assertTrue(CortexSensitiveText.containsSecret("Authorization: Bearer abcdefgh123456"))
        assertTrue(CortexSensitiveText.containsSecret("api_key=super-secret-value"))
    }

    @Test fun keepsNormalNotificationsReadable() {
        assertEquals("Андрей: Встреча в 18:00", CortexSensitiveText.notificationPart("Андрей", "Встреча в 18:00"))
        assertFalse(CortexSensitiveText.containsSecret("Заказ доставят завтра к 12:30"))
    }
}
