package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalIntentTest {
    private val installed: (String) -> Boolean = {
        it.equals("Telegram", true) || it.equals("телеграме", true) || it.equals("Test Chat", true)
    }

    @Test fun spokenWifiAndHotspotFaultIsARepairIntent() {
        val request = NetworkRequest.parse(
            "Кортекс, бро помоги мне у меня вайфай выключается и включается модем"
        )
        assertEquals(NetworkRequest(NetworkRequest.Mode.REPAIR, wifi = true, hotspot = true), request)
    }

    @Test fun networkStatusAndExplicitSwitchesStayLocal() {
        assertEquals(NetworkRequest.Mode.CHECK, NetworkRequest.parse("Почему отключается Wi-Fi?")?.mode)
        assertEquals(NetworkRequest.Mode.CHECK, NetworkRequest.parse("Проверь точку доступа")?.mode)
        assertEquals(NetworkRequest.Mode.ENABLE, NetworkRequest.parse("Включи вай-фай")?.mode)
        assertEquals(NetworkRequest.Mode.DISABLE, NetworkRequest.parse("Выключи режим модема")?.mode)
        assertEquals(NetworkRequest.Mode.OPEN, NetworkRequest.parse("Открой настройки Wi-Fi")?.mode)
        assertNull(NetworkRequest.parse("Как настроить Wi-Fi на другом телефоне?"))
        assertNull(NetworkRequest.parse("Напиши другу в Telegram «Помоги, не работает Wi-Fi»"))
        assertNull(NetworkRequest.parse("Включи Wi-Fi и выключи фонарик"))
    }

    @Test fun conversationAsksForExactRecipientAndTextBeforeActing() {
        val intent = requireNotNull(ConversationRequest.parse(
            "Кортекс, открой Telegram, зайди в переписку с другом и напиши сообщение", installed
        ))
        assertEquals("", intent.recipient)
        assertEquals("", intent.message)
        assertTrue(intent.question.contains("контакт"))
        val next = intent.withAnswer("Анна")
        assertEquals("Анна", next.recipient)
        assertTrue(next.question.contains("текст"))
        assertEquals("Привет!", next.withAnswer("«Привет!»").message)
        assertTrue(next.withAnswer("«Привет!»").send)
    }

    @Test fun messageBodyAndDraftFlagStayDistinct() {
        val direct = requireNotNull(ConversationRequest.parse(
            "Открой Test Chat, зайди в переписку с Анна и напиши сообщение: «Привет, не отправляй пароль»", installed
        ))
        assertEquals("Test Chat", direct.app)
        assertEquals("Анна", direct.recipient)
        assertEquals("Привет, не отправляй пароль", direct.message)
        assertTrue(direct.send)
        val draft = requireNotNull(ConversationRequest.parse(
            "Напиши Анне в Телеграме: «Скоро буду» без отправки", installed
        ))
        assertEquals("Анне", draft.recipient)
        assertEquals("Скоро буду", draft.message)
        assertFalse(draft.send)
        val followed = direct.copy(message = "").withAnswer("«Скоро буду» без отправки")
        assertEquals("Скоро буду", followed.message)
        assertFalse(followed.send)
        assertNull(ConversationRequest.parse("Как отправить сообщение в Telegram?", installed))
    }

    @Test fun genericDeviceDiagnosisIsAnAction() {
        assertTrue(VisualRequest.isAction("Кортекс, бро, проверь настройки телефона"))
        assertTrue(VisualRequest.isAction("Кортекс, открой Telegram"))
        assertEquals("Telegram", VisualRequest.singleApp("Кортекс, открой Telegram"))
        assertNull(VisualRequest.singleApp("Открой Telegram и найди Анну"))
        assertTrue(VisualRequest.isAction("Кортекс, что сейчас на экране?"))
        assertTrue(VisualRequest.readsScreen("Кортекс, что сейчас на экране?"))
        assertFalse(VisualRequest.isAction("Напиши текст про настройки телефона"))
    }

    @Test fun cortexExplainsRealCapabilitiesWithoutSendingACloudRequest() {
        val enabled = requireNotNull(CortexDeviceContext.capabilities("Кортекс, что ты умеешь?", true, true))
        assertTrue(enabled.startsWith("Я CORTEX"))
        assertTrue(enabled.contains("запускать сценарии"))
        assertTrue(requireNotNull(CortexDeviceContext.capabilities("Кто ты?", false, false))
            .contains("можно включить"))
        assertNull(CortexDeviceContext.capabilities("Кортекс, открой Telegram", true, true))
    }

    @Test fun localSettingsBrightnessAndLaunchUnderstandSynonyms() {
        val resolve: (String) -> String? = { if (it == "telegram") "org.telegram.messenger" else null }
        val settings = requireNotNull(CortexLocalCommands.parse("Пожалуйста, открой настройки телефона", resolve)).single()
        assertEquals("settings", settings.getString("kind"))
        assertEquals("system", settings.getString("target"))
        val launch = requireNotNull(CortexLocalCommands.parse("Telegram открой", resolve)).single()
        assertEquals("org.telegram.messenger", launch.getString("target"))
        val polite = requireNotNull(CortexLocalCommands.parse("Кортекс, можешь мне открыть Telegram?", resolve)).single()
        assertEquals("org.telegram.messenger", polite.getString("target"))
        val brightness = requireNotNull(CortexLocalCommands.parse("Яркость экрана уменьши на 15 процентов", resolve)).single()
        assertEquals("brightness", brightness.getString("kind"))
        assertEquals("down", brightness.getString("mode"))
        assertEquals(15, brightness.getInt("level"))
        assertNull(CortexLocalCommands.parse("Как открыть настройки телефона?", resolve))
    }
    @Test fun localDiagnosticsAndSettingsUseTypedAndroidActions() {
        fun step(text: String) = requireNotNull(CortexLocalCommands.parse(text) { null }).single()
        assertEquals("display", step("Кортекс, открой настройки и раздел «Дисплей»").getString("target"))
        assertEquals("bluetooth", step("Перейди в настройки Bluetooth").getString("target"))
        assertEquals("phone", step("Скажи какая версия Андроида").getString("target"))
        assertEquals("refresh", step("Сколько сейчас герц на экране?").getString("target"))
        assertEquals("network", step("Проверь подключение").getString("target"))
        assertEquals("display_refresh", step("Бро, включи 90 герц на телефоне").getString("kind"))
        assertEquals(120, step("Поставь частоту экрана на 120 Hz").getInt("level"))
        assertEquals("off", step("Выключи автоповорот").getString("mode"))
        assertEquals("auto", step("Включи адаптивную яркость").getString("mode"))
        assertEquals("https://example.org/News", step("Открой сайт example.org/News").getString("target"))
        assertNull(CortexLocalCommands.parse("Как включить 90 Гц?") { null })
    }

    @Test fun moreEverydayTasksWorkLocallyWithoutAnAiRequest() {
        fun step(text: String) = requireNotNull(CortexLocalCommands.parse(text) { null }).single()
        assertEquals(300, step("Поставь таймер на 5 минут").getInt("seconds"))
        assertEquals(7200, step("Запусти таймер на 2 часа").getInt("seconds"))
        assertNull(CortexLocalCommands.parse("Поставь таймер на 200 часов") { null })
        assertEquals(7, step("Поставь будильник на 07:30").getInt("hour"))
        assertEquals(30, step("Поставь будильник на 07:30").getInt("minute"))
        assertEquals("CORTEX Premium", step("Скопируй текст «CORTEX Premium»").getString("text"))
        assertEquals("Где купить билеты", step("Найди в интернете Где купить билеты").getString("query"))
        assertEquals("Москва Сити", step("Найди на карте Москва Сити").getString("query"))
        assertEquals("silent", step("Включи беззвучный режим").getString("mode"))
        assertEquals("vibrate", step("Включи вибрацию").getString("mode"))
        assertEquals("camera_video", step("Сними видео").getString("target"))
        assertEquals("+79991234567", step("Позвони +7 (999) 123-45-67").getString("number"))
        val sms = step("Напиши смс на номер +7 (999) 123-45-67 с текстом «CORTEX QA»")
        assertEquals("sms", sms.getString("kind"))
        assertEquals("CORTEX QA", sms.getString("text"))
    }

    @Test fun fastCommandsHandleColloquialTorchAndNavigation() {
        fun parsed(text: String) = requireNotNull(CortexLocalCommands.parse(text) { null }).single()
        assertEquals("off", parsed("Потуши фонарик").getString("mode"))
        assertEquals("off", parsed("Выключить фонарь").getString("mode"))
        assertEquals("off", parsed("Убери фонарик").getString("mode"))
        assertEquals("on", parsed("Вруби вспышку").getString("mode"))
        assertEquals("home", parsed("Вернись домой").getString("kind"))
        assertEquals("recents", parsed("Покажи открытые приложения").getString("kind"))
        assertEquals("app", requireNotNull(CortexLocalCommands.parse("Запускай Telegram") {
            if (it == "telegram") "org.telegram.messenger" else null
        }).single().getString("kind"))
    }

}
