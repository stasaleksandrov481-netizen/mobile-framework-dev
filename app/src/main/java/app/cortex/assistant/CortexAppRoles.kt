package app.cortex.assistant

import java.util.Locale

/**
 * Spoken names of standard Android app roles. Launcher labels differ across One UI, HyperOS,
 * Funtouch/OriginOS, ColorOS, MagicOS and Pixel ("Мои файлы", "Проводник", "Files"...), and Russian
 * commands are inflected ("открой галерею"), so these resolve through Android's role intents
 * instead of guessing vendor package names.
 */
internal object CortexAppRoles {
    enum class Role { GALLERY, MESSAGING, CONTACTS, PHONE, CLOCK, CALENDAR, EMAIL, MAPS, MUSIC, BROWSER, FILES, CALCULATOR, SETTINGS }

    private val names = mapOf(
        Role.GALLERY to setOf("галерея", "галерею", "галерее", "галереи", "фото", "фотки", "фотографии", "gallery", "photos"),
        Role.MESSAGING to setOf("сообщения", "сообщениях", "смс", "sms", "смски", "messages", "messaging"),
        Role.CONTACTS to setOf("контакты", "контактах", "телефонная книга", "телефонную книгу", "contacts"),
        Role.PHONE to setOf("телефон", "звонилка", "звонилку", "звонки", "набор номера", "номеронабиратель", "phone", "dialer"),
        Role.CLOCK to setOf("часы", "будильник", "будильники", "таймер", "секундомер", "clock", "alarm"),
        Role.CALENDAR to setOf("календарь", "календаре", "calendar"),
        Role.EMAIL to setOf("почта", "почту", "почте", "электронная почта", "электронную почту", "email", "mail"),
        Role.MAPS to setOf("карты", "карта", "карту", "картах", "навигатор", "maps"),
        Role.MUSIC to setOf("музыка", "музыку", "плеер", "музыкальный плеер", "music"),
        Role.BROWSER to setOf("браузер", "браузере", "browser"),
        Role.FILES to setOf("файлы", "файлах", "мои файлы", "проводник", "файловый менеджер", "диспетчер файлов", "files", "file manager"),
        Role.CALCULATOR to setOf("калькулятор", "калькуляторе", "calculator"),
        Role.SETTINGS to setOf("настройки", "настройках", "параметры", "настройки телефона", "settings"),
    )

    fun role(target: String): Role? {
        val clean = target.lowercase(Locale.ROOT).replace('ё', 'е').trim().trim('«', '»', '"', '.', '!')
            .replace(Regex("""\s+"""), " ").removePrefix("приложение ").removePrefix("app ")
        return names.entries.firstOrNull { clean in it.value }?.key
    }
}
