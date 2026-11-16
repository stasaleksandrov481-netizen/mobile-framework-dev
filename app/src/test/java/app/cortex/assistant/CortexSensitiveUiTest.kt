package app.cortex.assistant

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CortexSensitiveUiTest {
    @Test fun recognizesCommonCredentialFields() {
        listOf("com.example:id/otpCode", "com.example:id/sms_code", "com.example:id/verificationCode",
            "com.example:id/cardNumber", "com.example:id/cvv", "com.example:id/security_code",
            "com.example:id/authToken", "com.example:id/one_time_password", "com.example:id/pinCode"
        ).forEach { assertTrue(it, CortexSensitiveUi.privateField(it, null)) }
        assertTrue(CortexSensitiveUi.privateField("com.example:id/input", "Введите код подтверждения"))
    }

    @Test fun doesNotBlockOrdinaryInputs() {
        assertFalse(CortexSensitiveUi.privateField("com.example:id/searchInput", "Найти товар"))
        assertFalse(CortexSensitiveUi.privateField("com.example:id/message", "Напишите сообщение"))
    }
}
