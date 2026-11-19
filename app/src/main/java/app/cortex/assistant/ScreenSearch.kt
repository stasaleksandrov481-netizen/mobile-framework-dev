package app.cortex.assistant

internal data class AppSearchRequest(val app: String, val query: String) {
    companion object {
        private const val FIND = "(?:найди|найти|поищи|поискать|вбей|введи в поиск|покажи результаты по)"
        private val open = Regex("""^(?:открой|открыть|запусти|запустить|зайди в|зайти в)\s+(.+?)(?:\s*[,;]\s*|\s+)(?:и\s+|потом\s+|затем\s+)?$FIND\s+(.+)$""", RegexOption.IGNORE_CASE)
        private val find = Regex("""^$FIND\s+(.+?)\s+(?:в|на|через)\s+(.+)$""", RegexOption.IGNORE_CASE)
        private val aliases = mapOf("тт" to "TikTok", "тик ток" to "TikTok", "тикток" to "TikTok", "тиктоке" to "TikTok",
            "tiktok" to "TikTok", "вб" to "Wildberries", "вайлдберриз" to "Wildberries", "wildberries" to "Wildberries",
            "ютубе" to "YouTube", "ютуб" to "YouTube", "youtube" to "YouTube",
            "озоне" to "Ozon", "телеграме" to "Telegram", "тг" to "Telegram",
            "хром" to "Chrome", "хроме" to "Chrome")
        private val appFirst = Regex("""^$FIND\s+(?:в|на|через)\s+(.+?)\s+(.+)$""", RegexOption.IGNORE_CASE)
        private val secondAction = Regex("""(?:[,;]\s*|\s+(?:и|затем|потом)\s+)(?:купи|закажи|отправь|перешли|опубликуй|нажми|открой|закрой)\s""", RegexOption.IGNORE_CASE)

        fun parse(raw: String, installed: (String) -> Boolean): AppSearchRequest? {
            val text = (CortexHotword.command(raw) ?: raw).trim()
            fun request(app: String, query: String): AppSearchRequest? {
                if (secondAction.containsMatchIn(query)) return null
                val name = app.trim().replace(Regex("""(?iu)^(?:(?:в|на|через)\s+)+"""), "")
                    .trimEnd(',', '.', '!')
                val target = aliases[VisualLabels.normalize(name)] ?: name.takeIf { installed(it) } ?: return null
                val terms = query.trim().removeSurrounding("«", "»").removeSurrounding("\"")
                return terms.takeIf { it.length in 1..220 }?.let { AppSearchRequest(target, it) }
            }
            open.matchEntire(text)?.destructured?.let { (app, query) -> request(app, query)?.let { return it } }
            find.matchEntire(text)?.destructured?.let { (query, app) -> request(app, query)?.let { return it } }
            appFirst.matchEntire(text)?.destructured?.let { (app, query) -> request(app, query)?.let { return it } }
            return null
        }
    }
}

/** Search controls shared by messaging, shopping, and other apps. */
internal class ScreenSearch(private val screen: CortexScreenService, private val navigation: VisualNavigation) {
    fun field(frame: VisualFrame): VisualNode? {
        val editors = frame.tree.filter { it.enabled && it.editable && inToolbar(frame, it) }
        return editors.filter(::searchLabel).singleOrNull() ?: editors.filter { it.focused }.singleOrNull()
    }

    suspend fun open(frame: VisualFrame): VisualFrame? {
        if (field(frame) != null) return frame
        val tool = searchButton(frame)
        val clicked = if (tool != null) screen.click(frame, tool) || screen.tap(frame, tool)
        else {
            val words = screen.recognize(frame)
            val label = words.nodes.filter { inToolbar(frame, it) && searchLabel(it) }.singleOrNull()
            !words.protected && label != null && screen.tap(frame, label)
        }
        if (!clicked) return null
        return navigation.await(8_000L) {
            it.pkg == frame.pkg && !it.secure && !it.hasPrivateFields && field(it) != null
        }
    }

    suspend fun find(request: AppSearchRequest, report: (String) -> Unit): CortexActionEngine.Result {
        val app = navigation.resolve(request.app)
            ?: return CortexActionEngine.Result("На телефоне не найдено приложение «${request.app}».", false)
        if (!navigation.open(app, report)) return CortexActionEngine.Result("«${app.label}» не открылось за отведённое время.", false)
        report("Жду, пока откроется поиск в ${app.label}…")
        // An app can expose an accessibility tree while its home screen is still loading.
        // Wait for its search control, not just the package name or the splash screen.
        val start = navigation.await(15_000L) {
            it.pkg == app.pkg && !it.secure && !it.hasPrivateFields &&
                (field(it) != null || searchButton(it) != null)
        } ?: screen.frame(fresh = true)?.takeIf {
            it.pkg == app.pkg && !it.secure && !it.hasPrivateFields && it.tree.isNotEmpty()
        } ?: return CortexActionEngine.Result("«${app.label}» открылось, но интерфейс поиска ещё загружается.", false)
        val ready = open(start) ?: navigation.await(5_000L) {
            it.pkg == app.pkg && !it.secure && !it.hasPrivateFields &&
                (field(it) != null || searchButton(it) != null)
        }?.let { open(it) }
            ?: return CortexActionEngine.Result("В «${app.label}» не открылось поле поиска после ожидания загрузки.", false)
        report("Ввожу запрос в ${app.label}…")
        val typed = navigation.writeText(ready, request.query, ::field)
            ?: return CortexActionEngine.Result("«${app.label}» не подтвердило текст в поле поиска.", false)

        val editor = field(typed) ?: return CortexActionEngine.Result("Поле поиска изменилось.", false)
        val explicit = typed.tree.filter { it.enabled && !it.editable && inToolbar(typed, it) &&
            searchLabel(it) && it.clickable && it.bounds.top <= editor.bounds.bottom }.singleOrNull()
        val requested = screen.submit(typed, editor) || explicit?.let { screen.click(typed, it) } == true ||
            (screen.focusField(typed, editor) && navigation.await(1_400L) { current ->
                current.pkg == typed.pkg && current.window == typed.window && !current.secure && !current.hasPrivateFields &&
                    field(current)?.let { it.focused && screen.fieldMatches(current, it, request.query) && screen.submit(current, it) } == true
            } != null)
        // Results may already be drawn *during* text entry. Requiring a
        // structure change after typing gives a false failure for fast searches.
        // Do not count the editable query itself as a result.
        fun hasResults(current: VisualFrame): Boolean {
            if (current.pkg != app.pkg || current.secure || current.hasPrivateFields) return false
            // The first result can be near the top of the screen, well above
            // the old 23%-height cutoff. Bound it to the actual search editor.
            val resultTop = field(current)?.bounds?.bottom ?: editor.bounds.bottom
            return current.tree.any { node ->
                node.enabled && !node.editable && node.bounds.centerY() > resultTop &&
                    VisualLabels.score(node.label, request.query) >= 82
            }
        }
        val matches = if (hasResults(typed)) typed else navigation.await(if (requested) 9_000L else 2_400L, ::hasResults)
        return if (matches != null) CortexActionEngine.Result("Поиск «${request.query}» открыт в ${app.label}.", true)
        else CortexActionEngine.Result(if (requested) "Запрос «${request.query}» передан в ${app.label}. Результаты ещё не подтверждены."
            else "Ввёл «${request.query}» в поиск ${app.label}, но результаты не подтвердились.", false)
    }

    private fun searchButton(frame: VisualFrame): VisualNode? = frame.tree.filter {
        it.enabled && !it.editable && inToolbar(frame, it) && searchLabel(it)
    }.let { it.filter(VisualNode::clickable).singleOrNull() ?: it.singleOrNull() }

    companion object {
        private fun inToolbar(frame: VisualFrame, node: VisualNode) =
            node.bounds.top < frame.bounds.top + frame.bounds.height() * .23
        fun searchLabel(node: VisualNode) = listOf(node.label, node.description, node.resource.substringAfterLast('/'))
            .map(VisualLabels::normalize).any {
                it in names || it.startsWith("поиск по ") || it.startsWith("поиск в ") ||
                    it.startsWith("поиск на ") || it.startsWith("искать в ") ||
                    it.startsWith("search in ") || it.startsWith("search on ") ||
                    it.startsWith("search youtube") || it.startsWith("search for ") ||
                    it.startsWith("поиск или ") || it.startsWith("search or ")
            }
        private val names = setOf("search", "search chats", "search messages", "поиск", "найти", "поиск чатов",
            "поиск сообщений", "поиск товаров", "search button", "search field", "search src text", "search input",
            "menu search", "action search", "action bar search", "search edit text", "search text", "search icon")
    }
}
