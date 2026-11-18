package app.cortex.assistant

import android.graphics.Rect

/** Uses the same search, result, editor and send controls across accessible messaging apps. */
internal class ConversationNavigation(
    private val screen: CortexScreenService,
    private val navigation: VisualNavigation,
    private val confirm: suspend (String, String, String) -> Boolean
) {
    suspend fun run(request: ConversationRequest, report: (String) -> Unit): CortexActionEngine.Result {
        fun result(text: String, ok: Boolean = false) = CortexActionEngine.Result(text, ok)
        val app = navigation.resolve(request.app) ?: return result("Приложение «${request.app}» не найдено.")
        if (!navigation.open(app, report)) return result("Android не подтвердил открытие «${app.label}».")
        var frame = navigation.await { usable(it, app.pkg) }
            ?: return result("Приложение открылось, но экран переписки пока недоступен.")
        val searchName = searchName(request.recipient)
        var recipient = request.recipient
        if (header(frame, recipient) == null || composer(frame) == null) {
            report("Ищу переписку «${request.recipient}»…")
            if (searchField(frame) == null) {
                val search = findSearch(frame) ?: return result("В «${app.label}» не нашёл кнопку поиска переписки. Откройте нужный чат и повторите команду.")
                if (!activate(frame, search)) return result("Приложение не открыло поиск.")
                frame = navigation.await(2_600L) { usable(it, app.pkg) && searchField(it) != null }
                    ?: return result("Открыл поиск, но поле ввода пока недоступно.")
            }
            val field = searchField(frame) ?: return result("Поле поиска изменилось. Повторите команду.")
            val alreadySearching = screen.fieldMatches(frame, field, searchName)
            val before = frame.structure()
            if (!alreadySearching && !screen.setText(frame, field, searchName)) return result("Приложение не приняло запрос поиска.")
            val matching = navigation.await(4_500L) {
                usable(it, app.pkg) && (alreadySearching || it.structure() != before) && candidate(it, searchName) != null
            } ?: return result("Не удалось однозначно найти «${request.recipient}». Уточните имя в поиске или укажите @username.")
            val found = candidate(matching, searchName) ?: return result("Результаты поиска изменились.")
            recipient = found.title
            if (!activate(matching, found.row)) return result("Переписка не открылась.")
            frame = navigation.await(3_000L) {
                usable(it, app.pkg) && header(it, recipient) != null && composer(it) != null
            } ?: return result("Приложение не подтвердило получателя «$recipient». Сообщение осталось неотправленным.")
        }
        if (!navigation.isActive(frame)) return result("Экран переписки изменился до ввода.")
        var editor = composer(frame) ?: return result("Поле сообщения недоступно.")
        if (!screen.fieldEmpty(frame, editor)) return result("В переписке уже есть текст. Оставил его без изменений.")
        if (request.message.any { it.code < 32 && it !in "\n\t" }) return result("В тексте сообщения есть недопустимые символы.")
        if (request.send) {
            report("Жду подтверждения отправки…")
            val detail = "Найденный чат: $recipient в ${app.label}\nСверьте получателя: имена могут совпадать.\n\n${request.message}"
            if (!confirm("Отправить сообщение?", detail, "Отправить")) return result("Отправка отменена.")
            frame = navigation.await(2_000L) { current ->
                usable(current, app.pkg) && header(current, recipient) != null &&
                    composer(current)?.let { screen.fieldEmpty(current, it) } == true
            } ?: return result("Переписка или поле ввода изменились. Отправка отменена.")
            editor = composer(frame) ?: return result("Поле ввода изменилось. Отправка отменена.")
        }
        report("Ввожу сообщение…")
        if (!screen.setText(frame, editor, request.message)) return result("Приложение не приняло текст сообщения.")
        fun draftVisible(current: VisualFrame) = usable(current, app.pkg) && header(current, recipient) != null &&
            composer(current)?.let { screen.fieldMatches(current, it, request.message) } == true
        val drafted = navigation.await(2_000L, ::draftVisible)
            ?: return result("Приложение не подтвердило текст сообщения. Проверьте поле ввода.")
        if (!request.send) return result("Черновик для «$recipient» готов в ${app.label}.", true)
        val confirmed = drafted
        if (!navigation.isActive(confirmed)) return result("Переписка изменилась. Отправка отменена.")
        val freshEditor = composer(confirmed) ?: return result("Поле ввода изменилось. Отправка отменена.")
        val button = findSend(confirmed, freshEditor) ?: return result("Кнопка отправки изменилась.")
        val normalizedMessage = VisualLabels.clean(request.message)
        fun visibleCopies(current: VisualFrame) = current.tree.count { !it.editable && normalizedMessage == it.label &&
            it.bounds.top >= topLimit(current) }
        val previousCopies = visibleCopies(confirmed)
        report("Отправляю сообщение…")
        if (!activate(confirmed, button)) return result("Приложение отклонило нажатие кнопки отправки.")
        val verified = navigation.await(3_300L) { current ->
            usable(current, app.pkg) && header(current, recipient) != null &&
                composer(current)?.let { screen.fieldEmpty(current, it) } == true &&
                visibleCopies(current) > previousCopies
        }
        return if (verified != null) result("Сообщение появилось в переписке «$recipient».", true)
        else result("Нажал «Отправить». Проверьте переписку — результат пока не подтверждён.")
    }

    private suspend fun activate(frame: VisualFrame, node: VisualNode) =
        screen.click(frame, node) || screen.tap(frame, node)

    private fun usable(frame: VisualFrame, pkg: String) =
        frame.pkg == pkg && !frame.secure && !frame.hasPrivateFields

    private fun findSearch(frame: VisualFrame) = frame.tree.filter { node ->
        node.enabled && !node.editable && match(node, searchNames) && node.bounds.top < topLimit(frame)
    }.preferClick()

    private fun searchField(frame: VisualFrame): VisualNode? = frame.tree.filter { node ->
        node.enabled && node.editable && match(node, searchNames)
    }.singleOrNull()

    private data class Candidate(val row: VisualNode, val title: String, val score: Int)

    private fun searchName(name: String): String = when {
        // Voice requests often provide the name in the dative rather than as shown in search.
        name.startsWith('@') -> name
        name.matches(Regex("""(?iu)[а-яё]{2,}ке""")) -> name.dropLast(1) + "а"
        else -> name
    }

    private fun candidate(frame: VisualFrame, name: String): Candidate? {
        val field = searchField(frame) ?: return null
        val token = VisualLabels.normalize(name)
        if (token.length < 2) return null
        val results = frame.tree.mapNotNull { node ->
            if (!node.enabled || node.editable || node.bounds.top < field.bounds.bottom) return@mapNotNull null
            val title = node.label.ifBlank { node.description.substringBefore('\n') }.trim()
            if (title.isBlank() || title.length > 100) return@mapNotNull null
            val label = VisualLabels.normalize(title)
            val score = when {
                exact(node, name) -> 100
                name.startsWith('@') -> 0
                label.startsWith("$token ") -> 90
                token.length >= 4 && label.startsWith(token) -> 80
                else -> 0
            }
            if (score == 0) return@mapNotNull null
            val parent = frame.tree.filter { it.clickable && it.enabled && contains(it.bounds, node.bounds) &&
                it.path.size < node.path.size && node.path.take(it.path.size) == it.path &&
                it.bounds.height() <= node.bounds.height() * 5 }.maxByOrNull { it.path.size }
            Candidate(parent ?: node, title, score)
        }.sortedByDescending { it.score }.distinctBy { it.row.bounds }
        val best = results.firstOrNull() ?: return null
        return best.takeUnless { results.drop(1).any { it.score == best.score } }
    }

    private fun header(frame: VisualFrame, name: String) = frame.tree.firstOrNull {
        it.enabled && !it.editable && it.bounds.top < topLimit(frame) && exact(it, name)
    }

    private fun composer(frame: VisualFrame): VisualNode? = frame.tree.filter {
        it.enabled && it.editable && !match(it, searchNames) &&
            (match(it, editorNames) || it.bounds.centerY() > frame.bounds.top + frame.bounds.height() * .52)
    }.singleOrNull()

    private fun findSend(frame: VisualFrame, editor: VisualNode) = frame.tree.filter {
        it.enabled && !it.editable && match(it, sendNames) &&
            it.bounds.bottom >= editor.bounds.top && it.bounds.top <= editor.bounds.bottom + editor.bounds.height()
    }.preferClick()

    private fun List<VisualNode>.preferClick() = filter { it.clickable }.singleOrNull() ?: singleOrNull()

    private fun match(node: VisualNode, names: Set<String>) = listOf(node.label, node.description,
        node.resource.substringAfterLast('/')).any { VisualLabels.normalize(it) in names }

    private fun exact(node: VisualNode, name: String) =
        if (name.startsWith('@')) listOf(node.label, node.description).any { it.trim().equals(name, ignoreCase = true) }
        else VisualLabels.normalize(name).let { value ->
            listOf(node.label, node.description.substringBefore('\n')).any { VisualLabels.normalize(it) == value }
        }

    private fun contains(outer: Rect, inner: Rect) = outer.contains(inner.left, inner.top, inner.right, inner.bottom)

    private fun topLimit(frame: VisualFrame) = frame.bounds.top + frame.bounds.height() * .24

    private companion object {
        val searchNames = setOf("search", "search chats", "search messages", "поиск", "найти", "поиск чатов", "поиск сообщений",
            "search button", "search field", "search src text", "search input", "menu search", "action search", "action bar search")
        val editorNames = setOf("message", "message input", "type a message", "write a message", "сообщение", "напишите сообщение",
            "введите сообщение", "поле сообщения", "compose text", "chat input", "entry")
        val sendNames = setOf("send", "send message", "send button", "отправить", "отправить сообщение", "отправка", "message send")
    }
}
