package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VisualPlanTest {
    private val installed: (String) -> Boolean = { it.equals("Telegram", true) || it.equals("Settings", true) }

    @Test fun mixedPhoneRequestKeepsItsOriginalOrder() {
        val steps = requireNotNull(VisualRequest.local(
            "Включи фонарик, открой Telegram, выключи фонарик, закрой Telegram и выключи экран", installed
        ))
        assertEquals(listOf(
            VisualAction.QUICK_SETTINGS, VisualAction.SET, VisualAction.OPEN, VisualAction.QUICK_SETTINGS,
            VisualAction.SET, VisualAction.HOME, VisualAction.LOCK
        ), steps.map { it.action })
        assertEquals(listOf("on", "off"), steps.filter { it.action == VisualAction.SET }.map { it.value })
    }

    @Test fun explicitScreenPathsUseGenericLabels() {
        val steps = requireNotNull(VisualRequest.local("Открой Settings → Display → Dark theme", installed))
        assertEquals(listOf("Settings", "Display", "Dark theme"), steps.map { it.target })
        assertEquals(listOf(VisualAction.OPEN, VisualAction.TAP, VisualAction.TAP), steps.map { it.action })
        assertNull(VisualRequest.local("Открой приложение, которого нет", installed))
        assertTrue(VisualRequest.isAction("Сделай фото"))
        assertFalse(VisualRequest.isAction("Как выключить экран?"))
    }

    @Test fun screenActionsAreGroundedWithoutUploadingUnrelatedChats() {
        assertTrue(VisualRequest.needsVisibleScreen("Нажми на кнопку Продолжить"))
        assertTrue(VisualRequest.needsVisibleScreen("Введи код в поле на экране"))
        assertTrue(VisualRequest.needsVisibleScreen("Прочитай что сейчас на экране"))
        assertFalse(VisualRequest.needsVisibleScreen("Как нажать на кнопку в Android?"))
        assertFalse(VisualRequest.needsVisibleScreen("Напиши пост о технологиях"))
        assertFalse(VisualRequest.needsVisibleScreen("Открой Telegram"))
    }

    @Test fun naturalPhoneVerbsReachTheActionEngine() {
        assertTrue(VisualRequest.isAction("Позвони маме"))
        assertTrue(VisualRequest.isAction("Ответь в Телеграме"))
        assertTrue(VisualRequest.isAction("Переименуй файл"))
        assertTrue(VisualRequest.isAction("Переключи настройку"))
        assertTrue(VisualRequest.isAction("Сделай скриншот"))
        assertFalse(VisualRequest.isAction("Как позвонить маме?"))
        assertFalse(VisualRequest.isAction("Напиши пост о технологиях"))
    }

    @Test fun plannerRejectsUnknownOperationsAndInvalidParameters() {
        assertNull(VisualPlan.parse("""{"steps":[{"action":"tap","target":"OK","x":12}]}"""))
        assertNull(VisualPlan.parse("""{"steps":[{"action":"set","target":"Wi-Fi","value":"toggle"}]}"""))
        assertNull(VisualPlan.parse("""{"steps":[{"action":"open","target":123}]}"""))
        assertNotNull(VisualPlan.parse("""{"steps":[{"action":"type","value":"Привет!"},{"action":"read"}]}"""))
        assertNotNull(VisualPlan.parse("""{"question":"Где открыт аккаунт?"}"""))
        assertTrue(requireNotNull(VisualPlan.parse("""{"done":true}""")).done)
        assertNull(VisualPlan.parse("""{"steps":[{"action":"read"}],"done":true}"""))
    }

    @Test fun quotedTextAndSimpleGesturesStayLocal() {
        val steps = requireNotNull(VisualRequest.local(
            "Введи текст «Привет, потом открой файл» и свайпни вверх, вернись назад", installed
        ))
        assertEquals(listOf(VisualAction.TYPE, VisualAction.SWIPE, VisualAction.BACK), steps.map { it.action })
        assertEquals("Привет, потом открой файл", steps.first().value)
        assertEquals("up", steps[1].value)
    }

    @Test fun longPressUsesAccessibilityAndProtectsSensitiveControls() {
        val step = requireNotNull(VisualRequest.local("Зажми «Сообщение»", installed)).single()
        assertEquals(VisualAction.LONG_PRESS, step.action)
        assertEquals("Сообщение", step.target)
        assertTrue(VisualRequest.isAction("Удерживай сообщение"))
        assertNotNull(VisualPlan.parse("""{"steps":[{"action":"long_press","target":"Сообщение"}]}"""))
        assertNull(VisualPlan.parse("""{"steps":[{"action":"long_press","target":""}]}"""))
        assertEquals(VisualRisk.CONFIRM, VisualSafety.risk("Удали сообщение", step,
            "Удалить", "action_delete", "Button"))
    }

    @Test fun finalSubmissionIsManualForGradedTasksAndConfirmedForMessages() {
        assertEquals(VisualRisk.MANUAL, VisualSafety.risk("Выполни тест на Учи.ру", VisualStep(VisualAction.TAP),
            "Завершить", "button", "Button"))
        assertEquals(VisualRisk.CONFIRM, VisualSafety.risk("Напиши сообщение", VisualStep(VisualAction.TAP),
            "", "toolbar_button", "Button"))
        assertEquals(VisualRisk.CONFIRM, VisualSafety.risk("Нажми кнопку", VisualStep(VisualAction.TAP),
            "Send", "action", "Button"))
        assertEquals(VisualRisk.NORMAL, VisualSafety.risk("Напиши сообщение", VisualStep(VisualAction.TAP),
            "Поиск", "toolbar_search", "ImageButton"))
        assertEquals(VisualRisk.CONFIRM, VisualSafety.risk("Открой раздел", VisualStep(VisualAction.TAP),
            "", "com.example:id/btnSend", "ImageButton"))
        assertEquals(VisualRisk.CONFIRM, VisualSafety.risk("Открой раздел", VisualStep(VisualAction.TAP),
            "", "com.example:id/confirmPayment", "Button"))
        assertEquals(VisualRisk.NORMAL, VisualSafety.risk("Открой раздел", VisualStep(VisualAction.TAP),
            "", "com.example:id/btnOpen", "Button"))
    }

    @Test fun callsConsentAndAccountExitAlwaysNeedConfirmation() {
        for ((label, resource) in listOf("Позвонить" to "button", "" to "com.example:id/btnCall",
                "Принять" to "button", "Я согласен" to "terms", "Agree" to "button", "Выйти" to "profile_row",
                "Log out" to "settings", "Отписаться" to "button", "Форматировать" to "sd_card")) {
            assertEquals(label + resource, VisualRisk.CONFIRM, VisualSafety.risk("Открой настройки",
                VisualStep(VisualAction.TAP), label, resource, "Button"))
        }
        // Ordinary navigation still runs without interrupting the user.
        assertEquals(VisualRisk.NORMAL, VisualSafety.risk("Открой настройки", VisualStep(VisualAction.TAP),
            "Звонки", "settings_calls", "TextView"))
    }
    @Test fun colloquialMessageRetainsRecipientAndTextAcrossMessengerClarification() {
        val pending = requireNotNull(ConversationRequest.parse("напиши рыбке как дела", installed))
        assertEquals("рыбке", pending.recipient)
        assertEquals("как дела", pending.message)
        assertTrue(pending.app.isBlank())
        assertTrue(pending.question.startsWith("В каком мессенджере"))
        val answer = pending.withAnswer("давай в телеграме")
        assertEquals("Telegram", answer.app)
        assertEquals("рыбке", answer.recipient)
        assertEquals("как дела", answer.message)
        assertTrue(answer.send)
        assertTrue(answer.question.isBlank())
    }

    @Test fun sameSentenceMessengerAndMessageStaySeparate() {
        val request = requireNotNull(ConversationRequest.parse("напиши рыбке в тг как дела", installed))
        assertEquals("Telegram", request.app)
        assertEquals("рыбке", request.recipient)
        assertEquals("как дела", request.message)
        assertNull(ConversationRequest.parse("напиши статью о погоде", installed))
    }

    @Test fun understandsUnquotedTextAfterAnExplicitUsername() {
        val command = requireNotNull(ConversationRequest.parse("передай @example_user в тг буду в восемь", installed))
        assertEquals("Telegram", command.app)
        assertEquals("@example_user", command.recipient)
        assertEquals("буду в восемь", command.message)
    }

    @Test fun chatRowsKeepTitleSeparateFromPreviewAndGlobalResults() {
        val title = ConversationMatch.title("Рыбка Тимофей", "Рыбка Тимофей", listOf("Рыбка", "Тимофей"))
        assertEquals("Рыбка", title)
        assertEquals(100, ConversationMatch.score(title, listOf("Рыбка", "Тимофей"), "рыбка"))
        assertEquals(0, ConversationMatch.score("Медиа", listOf("Медиа", "Это рыбка"), "рыбка"))
        assertTrue(ConversationMatch.boundary("Сообщения", true))
        assertTrue(ConversationMatch.boundary("Глобальный поиск", false))
        assertFalse(ConversationMatch.boundary("Глобальный поиск", true))
        assertEquals(100, ConversationMatch.score("Имя", listOf("Имя", "@example_user, 13 подписчиков"), "@example_user"))
    }

    @Test fun inflectedTelegramNamesMatchVerifiedTitlesNotMessagePreviews() {
        assertEquals("рыбк", ConversationMatch.searchQuery("рыбке"))
        assertEquals("саш", ConversationMatch.searchQuery("Саше"))
        assertEquals("@example_user", ConversationMatch.searchQuery("@example_user"))
        assertEquals(100, ConversationMatch.score("Рыбка", listOf("Рыбка", "был в сети"), "рыбке"))
        assertEquals(100, ConversationMatch.score("Саша", listOf("Саша"), "Саше"))
        assertEquals(100, ConversationMatch.score("Катя", listOf("Катя"), "Кате"))
        assertEquals(100, ConversationMatch.score("Антон", listOf("Антон"), "Антоне"))
        assertEquals(100, ConversationMatch.score("Андрей", listOf("Андрей"), "Андрею"))
        assertEquals(0, ConversationMatch.score("Рыбка Новости", listOf("Рыбка Новости"), "рыбке"))
        assertEquals(0, ConversationMatch.score("Медиа", listOf("Медиа", "Рыбка"), "рыбке"))
        assertEquals(0, ConversationMatch.score("Рыба", listOf("Рыба"), "рыбке"))
    }

    @Test fun youtubeSearchParsesNaturalLocationPhrasesBeforeLaunching() {
        assertEquals(AppSearchRequest("YouTube", "гта 6"),
            AppSearchRequest.parse("Открой в Ютубе и найди гта 6", installed))
        assertEquals(AppSearchRequest("YouTube", "gta 6"),
            AppSearchRequest.parse("Открой ютуб и найди gta 6", installed))
        assertEquals(AppSearchRequest("YouTube", "гта 6"),
            AppSearchRequest.parse("Открыть в Ютубе и найти гта 6", installed))
        assertEquals(AppSearchRequest("YouTube", "GTA 6"),
            AppSearchRequest.parse("Найди GTA 6 в ютубе", installed))
    }

    @Test fun genericSystemDestinationUsesSemanticNavigationInsteadOfAppNotFound() {
        assertTrue(VisualRequest.isAction("Открой статистику использования телефона"))
        assertFalse(VisualRequest.explicitAppLaunch("Открой статистику использования телефона"))
        assertFalse(VisualRequest.explicitAppLaunch("Покажи цифровое благополучие"))
        assertTrue(VisualRequest.explicitAppLaunch("Открой приложение Тестовый помощник"))
    }

    @Test fun shoppingVideoAndInstalledAppSearchDoNotNeedAPlanFromTheModel() {
        assertEquals(AppSearchRequest("TikTok", "прогулка по городу"),
            AppSearchRequest.parse("открой тик ток и найди прогулка по городу", installed))
        assertEquals(AppSearchRequest("Wildberries", "белые кеды"),
            AppSearchRequest.parse("найди белые кеды на вб", installed))
        assertEquals(AppSearchRequest("Settings", "яркость"),
            AppSearchRequest.parse("запусти Settings, найди яркость", installed))
        assertNull(AppSearchRequest.parse("открой вб и найди кеды, потом купи их", installed))
        assertEquals("Chrome", CortexActionEngine.schoolBrowser("в хроме"))
    }

    @Test fun modelClaimsAreRecognizedEvenAfterAnIntroOrInPassiveVoice() {
        assertTrue(PhoneActionEvidence.containsClaim("Понял, отправил сообщение. Текст доставлен."))
        assertTrue(PhoneActionEvidence.containsClaim("Обновление опубликовано."))
        assertFalse(PhoneActionEvidence.containsClaim("Я не отправил сообщение."))
        assertFalse(PhoneActionEvidence.containsClaim("Кому отправить сообщение?"))
    }
    @Test fun mascotWaitsThreeMinutesAfterCompletionAndInterruption() {
        val mascot = IslandMascotClock(10L)
        assertNull(mascot.frame(180_009L, eligible = true))
        val walk = requireNotNull(mascot.frame(180_010L, eligible = true))
        assertEquals(IslandScene.WALK, walk.scene)
        assertNull(mascot.frame(181_000L, eligible = false))
        assertNull(mascot.frame(360_999L, eligible = true))
        assertEquals(IslandScene.BOUNCE, mascot.frame(361_000L, eligible = true)?.scene)
        assertNull(mascot.frame(363_700L, eligible = true))
        assertNull(mascot.frame(543_699L, eligible = true))
        assertEquals(IslandScene.THINK, mascot.frame(543_700L, eligible = true)?.scene)
    }

    @Test fun torchAndShadeSwitchesBecomeBoundedAndroidCommands() {
        val chain = requireNotNull(CortexLocalCommands.parse(
            "открой шторку и включи фонарик", { null }
        ))
        assertEquals(listOf("shade", "torch"), chain.map { it.getString("kind") })
        assertEquals("on", chain[1].getString("mode"))
        val switch = requireNotNull(CortexLocalCommands.parse("в шторке отключи Bluetooth", { null })).single()
        assertEquals("system_toggle", switch.getString("kind"))
        assertEquals("bluetooth", switch.getString("target"))
        assertEquals("off", switch.getString("mode"))
        assertEquals(false, CortexSystemTiles.state(null, "Bluetooth, Выкл."))
        assertEquals(true, CortexSystemTiles.state(true, "Режим полёта"))
        assertNull(CortexSystemTiles.state(null, "Bluetooth доступен"))
    }
}
