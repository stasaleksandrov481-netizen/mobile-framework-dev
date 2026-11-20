package app.cortex.assistant

import app.cortex.assistant.CortexAppRoles.Role
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CortexAppRolesTest {
    @Test fun inflectedSystemAppNamesMapToStandardAndroidRoles() {
        mapOf("галерею" to Role.GALLERY, "Фотографии" to Role.GALLERY, "сообщения" to Role.MESSAGING,
            "СМС" to Role.MESSAGING, "контакты" to Role.CONTACTS, "телефонную книгу" to Role.CONTACTS,
            "звонилку" to Role.PHONE, "будильник" to Role.CLOCK, "часы" to Role.CLOCK, "календарь" to Role.CALENDAR,
            "почту" to Role.EMAIL, "карты" to Role.MAPS, "музыку" to Role.MUSIC, "браузер" to Role.BROWSER,
            "проводник" to Role.FILES, "Мои файлы" to Role.FILES, "файловый  менеджер" to Role.FILES,
            "калькулятор" to Role.CALCULATOR, "настройки телефона" to Role.SETTINGS, "«Настройки»" to Role.SETTINGS,
            "приложение галерея" to Role.GALLERY
        ).forEach { (spoken, role) -> assertEquals(spoken, role, CortexAppRoles.role(spoken)) }
    }

    @Test fun thirdPartyAndUnknownNamesAreNotGuessed() {
        listOf("telegram", "ютуб", "галерея мемов", "почтальон", "", "сообщение маме").forEach {
            assertNull(it, CortexAppRoles.role(it))
        }
    }
}
