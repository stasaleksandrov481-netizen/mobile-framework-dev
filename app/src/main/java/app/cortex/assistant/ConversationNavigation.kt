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
        val search = ScreenSearch(screen, navigation)
        var frame = navigation.await(VisualNavigation.APP_START_MS) {
            usable(it, app.pkg) && it.tree.isNotEmpty()
        } ?: return result("Приложение открылось, но экран переписки пока недоступен.")
        val query = ConversationMatch.searchQuery(request.recipient)
        var recipient = request.recipient
        var openedWindow = frame.window
        if (!chat(frame, recipient, search)) {
            report("Ищу переписку «${request.recipient}»…")
            val onList = search.field(frame) == null
            // Reuse an exact visible conversation before opening search.
            val nativeVisible = if (onList) candidate(frame, request.recipient, null, allowOcr = false) else null
            val visible = if (nativeVisible?.score == 100) frame to nativeVisible else if (onList) {
                // A native chat list may draw names without accessible click targets.
                val words = screen.recognize(frame)
                if (words.protected) null else {
                    val enriched = frame.copy(nodes = frame.nodes + words.nodes)
                    candidate(enriched, request.recipient, null, allowOcr = true)
                        ?.takeIf { it.score == 100 }?.let { enriched to it }
                }
            } else null
            val matching: Pair<VisualFrame, Candidate> = visible ?: run {
                val ready = search.open(frame) ?: return result("Не открылось поле поиска в «${app.label}».")
                val typed = navigation.writeText(ready, query, search::field)
                    ?: return result("Не удалось подтвердить текст в поле поиска «${app.label}».")
                findResult(typed, query, request.recipient, search)
                    ?: return result("В результатах поиска не нашёл однозначный чат «${request.recipient}». Назовите точное имя или @username.")
            }
            recipient = matching.second.title
            if (!activate(matching.first, matching.second.row)) return result("Переписка не открылась.")
            frame = navigation.await(7_000L) { usable(it, app.pkg) && chat(it, recipient, search) }
                ?: return result("CORTEX не увидел открытый чат «$recipient». Сообщение не отправлено.")
            openedWindow = frame.window
        }
        fun sameChat(current: VisualFrame) = usable(current, app.pkg) && current.window == openedWindow && chat(current, recipient, search)
        if (!sameChat(frame)) return result("Экран переписки изменился до ввода.")
        val editor = composer(frame) ?: return result("Поле сообщения недоступно.")
        if (!screen.fieldEmpty(frame, editor)) return result("В переписке уже есть текст. Оставил его без изменений.")
        if (request.message.any { it.code < 32 && it !in "\n\t" }) return result("В тексте сообщения есть недопустимые символы.")
        if (request.send) {
            report("Жду подтверждения отправки…")
            val detail = "Найденный чат: $recipient в ${app.label}\nСверьте получателя: имена могут совпадать.\n\n${request.message}"
            if (!confirm("Отправить сообщение?", detail, "Отправить")) return result("Отправка отменена.")
            frame = navigation.await(6_000L) { current ->
                sameChat(current) &&
                    composer(current)?.let { screen.fieldEmpty(current, it) } == true
            } ?: return result("Переписка или поле ввода изменились. Отправка отменена.")
        }
        report("Ввожу сообщение…")
        val drafted = navigation.writeText(frame, request.message) { current ->
            if (!sameChat(current)) null else composer(current)?.takeIf {
                screen.fieldEmpty(current, it) || screen.fieldMatches(current, it, request.message)
            }
        } ?: return result("Приложение не подтвердило черновик. Сообщение не отправлено.")
        if (!request.send) return result("Черновик для «$recipient» готов в ${app.label}.", true)
        val confirmed = screen.frame(fresh = true)?.takeIf { current ->
            sameChat(current) && composer(current)?.let { screen.fieldMatches(current, it, request.message) } == true
        } ?: return result("Переписка или текст изменились. Отправка отменена.")
        val freshEditor = composer(confirmed) ?: return result("Поле ввода изменилось. Отправка отменена.")
        val button = findSend(confirmed, freshEditor) ?: return result("Кнопка отправки изменилась.")
        val normalizedMessage = VisualLabels.clean(request.message)
        fun visibleCopies(current: VisualFrame) = current.tree.count { !it.editable && normalizedMessage == it.label &&
            it.bounds.top >= topLimit(current) }
        val previousCopies = visibleCopies(confirmed)
        report("Отправляю сообщение…")
        if (!activate(confirmed, button)) return result("Приложение отклонило нажатие кнопки отправки.")
        val verified = navigation.await(6_000L) { current ->
            sameChat(current) &&
                composer(current)?.let { screen.fieldEmpty(current, it) } == true &&
                visibleCopies(current) > previousCopies
        }
        return if (verified != null) result("Сообщение появилось в переписке «$recipient».", true)
        else result("Нажатие «Отправить» выполнено. Появление сообщения в чате ещё не подтверждено.")
    }

    private suspend fun activate(frame: VisualFrame, node: VisualNode) =
        screen.click(frame, node) || screen.tap(frame, node)

    private fun usable(frame: VisualFrame, pkg: String) =
        frame.pkg == pkg && !frame.secure && !frame.hasPrivateFields

    private data class Candidate(val row: VisualNode, val title: String, val score: Int)

    private suspend fun findResult(initial: VisualFrame, query: String, recipient: String, search: ScreenSearch): Pair<VisualFrame, Candidate>? {
        fun valid(frame: VisualFrame) = usable(frame, initial.pkg) && frame.window == initial.window &&
            search.field(frame)?.let { screen.fieldMatches(frame, it, query) } == true
        val native = navigation.await(4_500L) {
            valid(it) && candidate(it, recipient, search.field(it), allowOcr = false) != null
        }
        if (native != null) return native to requireNotNull(candidate(native, recipient, search.field(native), allowOcr = false))
        // Custom-drawn result rows may expose no title through accessibility.
        repeat(2) {
            val current = screen.frame(fresh = true)?.takeIf(::valid) ?: return null
            val words = screen.recognize(current)
            if (words.protected) return null
            val enriched = current.copy(nodes = current.nodes + words.nodes)
            candidate(enriched, recipient, search.field(enriched), allowOcr = true)?.let { return enriched to it }
            if (it == 0) navigation.await(1_600L) { valid(it) && it.structure() != current.structure() }
        }
        return null
    }

    private fun candidate(frame: VisualFrame, name: String, field: VisualNode?, allowOcr: Boolean): Candidate? {
        val top = field?.bounds?.bottom ?: (frame.bounds.top + frame.bounds.height() * .11).toInt()
        val boundary = frame.nodes.filter {
            !it.editable && it.bounds.centerY() > top && ConversationMatch.boundary(it.label, name.startsWith('@'))
        }.minOfOrNull { it.bounds.top } ?: frame.bounds.bottom
        val candidates = frame.nodes.mapNotNull { node ->
            if (!node.enabled || node.editable || node.bounds.centerY() <= top || node.bounds.centerY() >= boundary) return@mapNotNull null
            if (node.ocr && !allowOcr) return@mapNotNull null
            val title = ConversationMatch.title(node.label, node.description, node.descriptionLines)
            val score = ConversationMatch.score(title, node.descriptionLines, name)
            if (score == 0 || node.ocr && score < 100 || field == null && score < 100) return@mapNotNull null
            val row = if (node.clickable || node.ocr) node else frame.tree.filter { parent ->
                parent.clickable && parent.enabled && contains(parent.bounds, node.bounds) &&
                    parent.path.size < node.path.size && node.path.take(parent.path.size) == parent.path &&
                    parent.bounds.height() < frame.bounds.height() * .19
            }.maxByOrNull { it.path.size } ?: node.takeIf {
                // Some messenger builds expose a visible title without a clickable parent.
                // Only tap an exact title; opening must still verify the chat header.
                score == 100 && it.role in setOf("TextView", "View") && it.label.isNotBlank() &&
                    it.bounds.height() < frame.bounds.height() * .10
            } ?: return@mapNotNull null
            val resolvedTitle = if (name.startsWith('@') && title.startsWith('@')) {
                frame.nodes.filter { item ->
                    item.ocr && item.bounds.bottom <= node.bounds.top &&
                        node.bounds.top - item.bounds.bottom <= node.bounds.height() * 2 &&
                        kotlin.math.abs(item.bounds.left - node.bounds.left) <= node.bounds.height() * 2 &&
                        item.label.isNotBlank() && !item.label.startsWith('@') &&
                        !ConversationMatch.boundary(item.label, false)
                }.maxByOrNull { it.bounds.bottom }?.label ?: title
            } else title
            Candidate(row, resolvedTitle, score)
        }
        val best = candidates.maxWithOrNull(compareBy<Candidate> { it.score }.thenBy { !it.row.ocr }) ?: return null
        return best.takeUnless { candidates.any { other ->
            other.score == best.score && !Rect.intersects(other.row.bounds, best.row.bounds)
        } }
    }

    private fun chat(frame: VisualFrame, name: String, search: ScreenSearch) =
        search.field(frame) == null && header(frame, name) != null && composer(frame) != null

    private fun header(frame: VisualFrame, name: String) = frame.tree.firstOrNull {
        it.enabled && !it.editable && it.bounds.top < frame.bounds.top + frame.bounds.height() * .17 &&
            ConversationMatch.score(ConversationMatch.title(it.label, it.description, it.descriptionLines),
                it.descriptionLines, name) == 100
    }

    private fun composer(frame: VisualFrame): VisualNode? = frame.tree.filter {
        it.enabled && it.editable && !ScreenSearch.searchLabel(it) &&
            (match(it, editorNames) || it.bounds.centerY() > frame.bounds.top + frame.bounds.height() * .52)
    }.singleOrNull()

    private fun findSend(frame: VisualFrame, editor: VisualNode) = frame.tree.filter {
        it.enabled && !it.editable && match(it, sendNames) &&
            it.bounds.bottom >= editor.bounds.top && it.bounds.top <= editor.bounds.bottom + editor.bounds.height()
    }.preferClick()

    private fun List<VisualNode>.preferClick() = filter { it.clickable }.singleOrNull() ?: singleOrNull()

    private fun match(node: VisualNode, names: Set<String>) = listOf(node.label, node.description,
        node.resource.substringAfterLast('/')).any { VisualLabels.normalize(it) in names }

    private fun contains(outer: Rect, inner: Rect) = outer.contains(inner.left, inner.top, inner.right, inner.bottom)

    private fun topLimit(frame: VisualFrame) = frame.bounds.top + frame.bounds.height() * .24

    private companion object {
        val editorNames = setOf("message", "message input", "type a message", "write a message", "сообщение", "напишите сообщение",
            "введите сообщение", "поле сообщения", "compose text", "chat input", "entry")
        val sendNames = setOf("send", "send message", "send button", "отправить", "отправить сообщение", "отправка", "message send")
    }
}
