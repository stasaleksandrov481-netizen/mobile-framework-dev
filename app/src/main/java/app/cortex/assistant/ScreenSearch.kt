package app.cortex.assistant

internal data class AppSearchRequest(val app: String, val query: String) {
    companion object {
        private const val FIND = "(?:найди|поищи|вбей|введи в поиск|покажи результаты по)"
        private val open = Regex("""^(?:открой|запусти|зайди в)\s+(.+?)(?:\s*[,;]\s*|\s+)(?:и\s+|потом\s+|затем\s+)?$FIND\s+(.+)$""", RegexOption.IGNORE_CASE)
        private val find = Regex("""^$FIND\s+(.+?)\s+(?:в|на|через)\s+(.+)$""", RegexOption.IGNORE_CASE)
        private val aliases = mapOf("тт" to "TikTok", "тик ток" to "TikTok", "тикток" to "TikTok", "тиктоке" to "TikTok",
            "tiktok" to "TikTok", "вб" to "Wildberries", "вайлдберриз" to "Wildberries", "wildberries" to "Wildberries",
            "ютубе" to "YouTube", "озоне" to "Ozon", "телеграме" to "Telegram", "тг" to "Telegram",
            "хром" to "Chrome", "хроме" to "Chrome")
        private val appFirst = Regex("""^$FIND\s+(?:в|на|через)\s+(.+?)\s+(.+)$""", RegexOption.IGNORE_CASE)
        private val secondAction = Regex("""(?:[,;]\s*|\s+(?:и|затем|потом)\s+)(?:купи|закажи|отправь|перешли|опубликуй|нажми|открой|закрой)\s""", RegexOption.IGNORE_CASE)

        fun parse(raw: String, installed: (String) -> Boolean): AppSearchRequest? {
            val text = (CortexHotword.command(raw) ?: raw).trim()
            fun request(app: String, query: String): AppSearchRequest? {
                if (secondAction.containsMatchIn(query)) return null
                val name = app.trim().trimEnd(',', '.', '!')
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
        return navigation.await(6_000L) {
            it.pkg == frame.pkg && !it.secure && !it.hasPrivateFields && field(it) != null
        }
    }

    suspend fun find(request: AppSearchRequest, report: (String) -> Unit): CortexActionEngine.Result {
        val app = navigation.resolve(request.app)
            ?: return CortexActionEngine.Result("На телефоне не найдено приложение «${request.app}».", false)
        if (!navigation.open(app, report)) return CortexActionEngine.Result("«${app.label}» не открылось за отведённое время.", false)
        val start = navigation.await(6_000L) {
            it.pkg == app.pkg && !it.secure && !it.hasPrivateFields && (field(it) != null || searchButton(it) != null)
        } ?: screen.frame(fresh = true)?.takeIf { it.pkg == app.pkg && !it.secure && !it.hasPrivateFields }
            ?: return CortexActionEngine.Result("В «${app.label}» пока не вижу экран поиска.", false)
        val ready = open(start) ?: return CortexActionEngine.Result("В «${app.label}» не открылось поле поиска.", false)
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
        val matches = navigation.await(if (requested) 9_000L else 2_400L) {
            it.pkg == app.pkg && !it.secure && !it.hasPrivateFields &&
                it.structure() != typed.structure() && it.tree.any { node ->
                    !node.editable && !inToolbar(it, node) && VisualLabels.score(node.label, request.query) >= 82
                }
        }
        return if (matches != null) CortexActionEngine.Result("Поиск «${request.query}» открыт в ${app.label}.", true)
        else CortexActionEngine.Result(if (requested) "Запрос «${request.query}» передан в ${app.label}. Результаты ещё не подтверждены."
            else "Ввёл «${request.query}» в поиск ${app.label}.", !requested)
    }

    private fun searchButton(frame: VisualFrame): VisualNode? = frame.tree.filter {
        it.enabled && !it.editable && inToolbar(frame, it) && searchLabel(it)
    }.let { it.filter(VisualNode::clickable).singleOrNull() ?: it.singleOrNull() }

    companion object {
        private fun inToolbar(frame: VisualFrame, node: VisualNode) =
            node.bounds.top < frame.bounds.top + frame.bounds.height() * .23
        fun searchLabel(node: VisualNode) = listOf(node.label, node.description, node.resource.substringAfterLast('/'))
            .map(VisualLabels::normalize).any {
                it in names || it.startsWith("поиск по ") || it.startsWith("search in ") ||
                    it.startsWith("поиск или ") || it.startsWith("search or ")
            }
        private val names = setOf("search", "search chats", "search messages", "поиск", "найти", "поиск чатов",
            "поиск сообщений", "поиск товаров", "search button", "search field", "search src text", "search input",
            "menu search", "action search", "action bar search", "search edit text", "search text", "search icon")
    }
}
