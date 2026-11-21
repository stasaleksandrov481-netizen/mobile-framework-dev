package app.cortex.assistant

import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import app.cortex.assistant.CortexSchedulePolicy.Alarm
import app.cortex.assistant.CortexSchedulePolicy.Installation
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

internal object CortexSchedule {
    const val EXTRA_TASK = "cortex.scheduled.task"
    private const val ALARM = "cortex.scheduled.alarm"
    private const val COMPLETE = "cortex.scheduled.complete"
    private const val SNOOZE = "cortex.scheduled.snooze"
    private const val CHANNEL = "cortex-reminders"
    private const val NOTIFICATION = 1410
    private const val DAY = 86_400_000L
    private val repeats = setOf("none", "daily", "weekly")
    private val activeStates = setOf("scheduled", "unarmed", "due", "blocked", "running")
    private const val ALARM_HINT = "Измените время или проверьте ограничения фоновой работы."
    private const val ALARM_UNAVAILABLE = "Android не установил будильник. $ALARM_HINT"
    private const val INTERRUPTED = "Предыдущий запуск прервался. Проверьте результат перед созданием нового поручения."
    private val format = DateTimeFormatter.ofPattern("d MMMM, HH:mm", Locale.forLanguageTag("ru"))
    private val drafts = linkedMapOf<String, Draft>()
    private var initialized = false

    private data class Draft(
        val reminder: Boolean, val text: String, val time: CortexScheduleIntent.Time?,
        val message: ConversationRequest? = null, val until: Long = SystemClock.elapsedRealtime() + 180_000
    )

    private data class Task(
        val id: String, val kind: String, val text: String, val at: Long, val local: String = "",
        val repeat: String = "none", val status: String = "scheduled", val detail: String = "",
        val message: ConversationRequest? = null, val resume: Boolean = false,
        val occurrence: String = "", val announced: Boolean = true
    ) {
        fun json(): JSONObject = JSONObject().put("id", id).put("kind", kind).put("text", text).put("at", at)
            .put("local", local).put("repeat", repeat).put("status", status).put("detail", detail)
            .put("resume", resume).put("occurrence", occurrence).put("announced", announced).apply {
                message?.let { put("message", JSONObject().put("app", it.app).put("recipient", it.recipient)
                    .put("text", it.message).put("send", it.send)) }
            }
    }

    private fun store(context: Context) = context.getSharedPreferences("cortex-schedule", Context.MODE_PRIVATE)
    private fun all(context: Context): List<Task> = runCatching {
        val items = JSONArray(store(context).getString("tasks", "[]"))
        (0 until items.length()).mapNotNull { i -> runCatching { readTask(items.getJSONObject(i)) }.getOrNull() }
    }.getOrDefault(emptyList())

    private fun readTask(item: JSONObject): Task {
        val message = item.optJSONObject("message")?.let {
            ConversationRequest(it.getString("app"), it.getString("recipient"), it.getString("text"), it.getBoolean("send"))
        }
        return Task(item.getString("id"), item.getString("kind"), item.getString("text"), item.getLong("at"),
            item.optString("local"), item.optString("repeat", "none"), item.optString("status", "scheduled"),
            item.optString("detail"), message, item.optBoolean("resume"), item.optString("occurrence"),
            item.optBoolean("announced", true))
    }

    private fun write(context: Context, items: List<Task>): Boolean {
        val (active, history) = items.partition { it.status in activeStates }
        val retained = active + history.sortedByDescending { it.at }.take(80)
        val prefs = store(context)
        val previous = prefs.getString("tasks", null)
        val ok = runCatching {
            prefs.edit().putString("tasks", JSONArray(retained.map(Task::json)).toString()).commit()
        }.getOrDefault(false)
        if (ok) runCatching { CortexRuntime.scheduleChanged?.invoke() }
        else runCatching {
            // A failed SharedPreferences commit may already have changed its in-memory value.
            prefs.edit().putString("tasks", previous).commit()
        }
        return ok
    }

    private fun replace(context: Context, task: Task, next: Task? = null): Boolean {
        val items = all(context)
        val nextItems = items.filterNot { it.id == task.id } + task + listOfNotNull(next)
        return write(context, nextItems)
    }

    fun list(context: Context): JSONArray = JSONArray(all(context)
        .sortedWith(compareBy<Task> { it.status !in setOf("scheduled", "unarmed") }.thenBy {
            if (it.status in setOf("scheduled", "unarmed")) it.at else -it.at
        }).map(Task::json))

    fun screenReady(context: Context) = runCatching {
        context.getSystemService(PowerManager::class.java).isInteractive &&
            !context.getSystemService(KeyguardManager::class.java).isKeyguardLocked
    }.getOrDefault(false)

    fun exactAllowed(context: Context) = Build.VERSION.SDK_INT < 31 || runCatching {
        context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    }.getOrDefault(false)

    fun notificationsAllowed(context: Context) = runCatching {
        context.getSystemService(NotificationManager::class.java).let {
            it.areNotificationsEnabled() && it.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
        }
    }.getOrDefault(false)

    fun clearDraft(source: String) { drafts.remove(source) }

    fun initialize(context: Context) {
        if (!initialized) restore(context)
    }

    fun command(context: Context, raw: String, source: String): CortexActionEngine.Result? {
        val parsed = CortexScheduleIntent.parse(raw)
        val previous = drafts.remove(source)?.takeIf { it.until > SystemClock.elapsedRealtime() }
        if (parsed == null && previous == null) return null
        if (raw.trim().lowercase(Locale.ROOT) in setOf("отмена", "не надо", "отмени")) {
            return CortexActionEngine.Result("Планирование отменено.", true)
        }
        val draft = when {
            previous != null && previous.time == null && CortexScheduleIntent.time(raw) != null ->
                previous.copy(time = CortexScheduleIntent.time(raw))
            parsed != null -> Draft(parsed.reminder, parsed.text, parsed.time,
                if (parsed.reminder) null else message(context, parsed.text))
            previous?.time == null -> previous ?: return null
            previous.text.isBlank() -> previous.copy(text = raw.trim().take(2400),
                message = if (previous.reminder) null else message(context, raw))
            previous.message?.app?.isBlank() == true -> {
                val name = raw.trim().removePrefix("в ").removePrefix("В ").trim('«', '»', '"', '.', ' ')
                val app = CortexPhoneActions(context).resolveApp(name)
                previous.copy(message = previous.message.copy(app = app?.pkg.orEmpty()))
            }
            previous.message?.question?.isNotBlank() == true -> previous.copy(message = previous.message.withAnswer(raw))
            else -> previous
        }
        val prompt = question(draft)
        if (prompt != null) {
            drafts[source] = draft
            if (drafts.size > 8) drafts.remove(drafts.keys.first())
            return CortexActionEngine.Result(prompt, false)
        }
        return saveDraft(context, draft, "none")
    }

    private fun question(draft: Draft): String? = when {
        draft.time == null -> "Когда запланировать? Например, через 10 минут или завтра в 8:00."
        draft.text.isBlank() -> if (draft.reminder) "О чём напомнить?" else "Какое действие запланировать?"
        draft.message?.app?.isBlank() == true -> "В каком приложении написать сообщение? Назовите установленное приложение."
        draft.message?.question?.isNotBlank() == true -> draft.message.question
        else -> null
    }

    private fun message(context: Context, text: String): ConversationRequest? {
        val phone = CortexPhoneActions(context)
        val send = SIMPLE_MESSAGE.matchEntire(text.trim()) ?: return ConversationRequest.parse(text) { phone.resolveApp(it) != null }
        val (name, app, body) = send.destructured
        val exact = name.trim().trim('«', '»', '"')
        val recipient = when (exact.lowercase(Locale.ROOT)) {
            "папе", "маме", "брату", "сестре", "другу", "подруге" -> ""
            else -> exact
        }
        return ConversationRequest(app.trim().takeIf(String::isNotBlank)?.let { phone.resolveApp(it)?.pkg }.orEmpty(), recipient.take(90),
            body.trim().trim('«', '»', '"').take(2000), true)
    }

    fun save(context: Context, input: JSONObject): CortexActionEngine.Result {
        val text = input.optString("text").trim().take(2400)
        val reminder = input.optString("kind") == "reminder"
        val local = runCatching { LocalDateTime.parse(input.optString("local")) }.getOrNull()
        val time = local?.let { CortexScheduleIntent.Time(it.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(), it) }
        val old = all(context).firstOrNull { it.id == input.optString("id") && it.status in setOf("scheduled", "unarmed") }
        if (input.optString("id").isNotBlank() && old == null) return failure("Это поручение уже изменилось.")
        val message = if (reminder) null else old?.message?.takeIf { old.text == text } ?: message(context, text)
        return saveDraft(context, Draft(reminder, text, time, message), input.optString("repeat", "none"), old)
    }

    private fun saveDraft(context: Context, draft: Draft, repeat: String, old: Task? = null): CortexActionEngine.Result {
        question(draft)?.let { return failure(it) }
        val time = requireNotNull(draft.time)
        val now = System.currentTimeMillis()
        if (time.epoch <= now || time.epoch > now + 366 * DAY) return failure("Выберите время в пределах ближайшего года.")
        if (repeat !in repeats) return failure("Выберите период повторения.")
        if (old == null && all(context).count { it.status in activeStates } >= 100) {
            return failure("В списке уже 100 активных поручений. Завершите или отмените одно из них.")
        }
        val task = Task(old?.id ?: UUID.randomUUID().toString(), if (draft.reminder) "reminder" else "action",
            draft.text, time.epoch, time.local?.toString().orEmpty(), repeat, message = draft.message,
            occurrence = UUID.randomUUID().toString())
        val armed = when (val result = install(context, task, old)) {
            is Installation.Saved -> result.alarm
            Installation.AlarmFailed -> return failure(ALARM_UNAVAILABLE)
            Installation.StorageFailed -> return failure("Android не сохранил поручение.")
        }
        val kind = if (draft.reminder) "Напомню" else "Запланировал действие"
        val timeLabel = format.format(Instant.ofEpochMilli(task.at).atZone(ZoneId.systemDefault()))
        val delivery = when {
            !notificationsAllowed(context) -> " Включите уведомления, чтобы увидеть поручение при выключенном экране."
            armed == Alarm.INEXACT -> " Android может доставить его позже указанного времени."
            else -> ""
        }
        return CortexActionEngine.Result("$kind $timeLabel. «${task.text}».$delivery", true)
    }

    private fun failure(text: String) = CortexActionEngine.Result(text, false)

    fun restore(context: Context, rebase: Boolean = false) {
        if (!prepare(context)) return
        val now = System.currentTimeMillis()
        all(context).filter { it.status == "scheduled" || needsAlarm(it) }.forEach { task ->
            val at = if (rebase && task.local.isNotBlank()) runCatching {
                LocalDateTime.parse(task.local).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            }.getOrDefault(task.at) else task.at
            restoreTask(context, task, at, now)
        }
        announcePending(context)
    }

    fun recoverPending(context: Context) {
        if (!initialized) { initialize(context); return }
        val now = System.currentTimeMillis()
        all(context).filter { needsAlarm(it) || it.status == "scheduled" && it.at <= now }
            .forEach { restoreTask(context, it, it.at, now) }
        announcePending(context)
    }

    private fun needsAlarm(task: Task) = task.status == "unarmed" || task.status == "blocked" && task.kind == "reminder"

    private fun prepare(context: Context): Boolean {
        if (!initialized) initialized = restoreInterrupted(context)
        return initialized
    }

    private fun restoreInterrupted(context: Context): Boolean {
        val tasks = all(context)
        if (tasks.none { it.status == "running" || it.resume }) return true
        return write(context, tasks.map { task ->
            if (task.status == "running" || task.resume) task.copy(status = "failed", resume = false,
                detail = INTERRUPTED) else task
        })
    }

    private fun restoreTask(context: Context, original: Task, at: Long, now: Long) {
        val changed = original.at != at || original.status != "scheduled"
        val scheduled = if (changed) original.copy(at = at, status = "scheduled", detail = "",
            occurrence = UUID.randomUUID().toString()) else original
        if (at <= now) {
            finishOccurrence(context, scheduled, original, now, recovered = true)
        } else if (changed) {
            if (install(context, scheduled, original) == Installation.AlarmFailed) {
                markUnarmed(context, original, scheduled)
            }
        } else if (alarm(context, original) == Alarm.UNAVAILABLE) {
            markUnarmed(context, original, original)
        }
    }

    private fun install(context: Context, task: Task, previous: Task?): Installation = CortexSchedulePolicy.install(
        arm = { alarm(context, task) },
        save = { replace(context, task) },
        cancelReplacement = { cancelAlarm(context, task) },
        cancelPrevious = {
            previous?.let {
                cancelAlarm(context, it)
                dismissNotification(context, it.id)
            }
        }
    )

    private fun markUnarmed(context: Context, previous: Task, desired: Task) {
        val failed = desired.copy(status = "unarmed", detail = ALARM_HINT,
            occurrence = if (desired.at == previous.at) previous.occurrence else desired.occurrence)
        if (failed != previous && replace(context, failed)) {
            cancelAlarm(context, previous)
            notify(context, failed)
        }
    }

    private fun alarm(context: Context, task: Task): Alarm {
        val manager = runCatching { context.getSystemService(AlarmManager::class.java) }.getOrNull() ?: return Alarm.UNAVAILABLE
        val target = runCatching { pending(context, task, ALARM) }.getOrNull() ?: return Alarm.UNAVAILABLE
        val due = task.at.coerceAtLeast(System.currentTimeMillis())
        if (exactAllowed(context) && runCatching {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due, target)
            }.isSuccess) {
            return Alarm.EXACT
        }
        // Alarm permissions can change after canScheduleExactAlarms(). OEMs may
        // reject both paths; treat that as a failure instead of crashing.
        return if (runCatching { manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due, target) }.isSuccess)
            Alarm.INEXACT else Alarm.UNAVAILABLE
    }

    private fun next(task: Task, now: Instant): Task? {
        val zone = ZoneId.systemDefault()
        val previous = runCatching { LocalDateTime.parse(task.local) }.getOrNull()
            ?: Instant.ofEpochMilli(task.at).atZone(zone).toLocalDateTime()
        val next = CortexSchedulePolicy.nextLocal(previous, task.repeat, now, zone) ?: return null
        return task.copy(id = UUID.randomUUID().toString(), at = next.atZone(zone).toInstant().toEpochMilli(),
            local = next.toString(), status = "scheduled", detail = "", announced = true,
            occurrence = UUID.randomUUID().toString())
    }

    fun deliver(context: Context, id: String, at: Long, occurrence: String = "", recovered: Boolean = false) {
        val task = all(context).firstOrNull { it.id == id && it.at == at && it.occurrence == occurrence && it.status == "scheduled" } ?: return
        val now = System.currentTimeMillis()
        if (task.at > now) {
            if (alarm(context, task) == Alarm.UNAVAILABLE) markUnarmed(context, task, task)
            return
        }
        finishOccurrence(context, task, task, now, recovered)
    }

    private fun finishOccurrence(context: Context, task: Task, original: Task, now: Long, recovered: Boolean) {
        val following = next(task, Instant.ofEpochMilli(now))?.let { successor ->
            if (alarm(context, successor) != Alarm.UNAVAILABLE) successor else {
                cancelAlarm(context, successor)
                successor.copy(status = "unarmed", detail = ALARM_HINT)
            }
        }
        val reminder = task.kind == "reminder"
        val hold = recovered || now - task.at > 15 * 60_000L
        val state = task.copy(status = if (reminder) "due" else "blocked", repeat = "none", announced = !reminder,
            detail = if (!reminder && hold) "Назначенное время прошло. Запустите поручение после проверки." else "")
        if (!replace(context, state, following)) {
            following?.let { cancelAlarm(context, it) }
            return
        }
        cancelAlarm(context, original)
        if (following?.status == "unarmed") notify(context, following)
        if (reminder) announce(context, state, allowIsland = !recovered)
        else if (hold) notify(context, state)
        else run(context, task.id, background = true)
    }

    fun handle(context: Context, id: String, action: String, beforeScreen: () -> Unit = {}): CortexActionEngine.Result {
        val task = all(context).firstOrNull { it.id == id } ?: return failure("Поручение больше недоступно.")
        val updated = when (action) {
            "run" -> return run(context, id, background = false, beforeScreen)
            "done" -> task.takeIf { it.status == "due" }?.copy(status = "done")
            "snooze" -> task.takeIf { it.status == "due" }?.copy(
                status = "scheduled", at = System.currentTimeMillis() + 5 * 60_000L, local = "", detail = "",
                occurrence = UUID.randomUUID().toString(), announced = true)
            "cancel" -> task.takeIf { it.status in setOf("scheduled", "unarmed", "due", "blocked") }?.copy(status = "cancelled")
            else -> null
        } ?: return failure("Действие уже недоступно для этого поручения.")
        if (updated.status == "scheduled") {
            when (install(context, updated, task)) {
                is Installation.Saved -> Unit
                Installation.AlarmFailed -> return failure("Android не разрешил отложить напоминание. Попробуйте снова после проверки разрешений.")
                Installation.StorageFailed -> return failure("Не удалось сохранить состояние поручения.")
            }
        } else {
            if (!replace(context, updated)) return failure("Не удалось сохранить состояние поручения.")
            cancelAlarm(context, task)
        }
        dismissNotification(context, id)
        return CortexActionEngine.Result(when (action) {
            "snooze" -> "Отложено на 5 минут."
            "cancel" -> "Поручение отменено."
            else -> "Отмечено выполненным."
        }, true)
    }

    private fun run(context: Context, id: String, background: Boolean, beforeScreen: () -> Unit = {}): CortexActionEngine.Result {
        val task = all(context).firstOrNull { it.id == id && it.kind == "action" && it.status == "blocked" }
            ?: return failure("Поручение уже завершено или запущено.")
        val prefs = context.getSharedPreferences("cortex-display", Context.MODE_PRIVATE)
        val source = "schedule:$id"
        if (task.resume && !CortexActionEngine.canResume(source)) {
            val reason = "Поручение прервалось после запуска. Проверьте результат перед повтором."
            replace(context, task.copy(status = "failed", detail = reason, resume = false))
            return failure(reason)
        }
        val reason = when {
            !screenReady(context) -> "Не могу выполнить поручение: экран выключен или заблокирован."
            !prefs.getBoolean("phoneActions", true) -> "Управление телефоном CORTEX выключено."
            CortexActionState.gate != "open" -> "CORTEX ожидает обновления или завершения техработ."
            CortexActionState.busy -> "CORTEX выполняет другое действие."
            CortexScreenService.connected == null && !canRunLocally(task) ->
                "Разрешите CORTEX управление экраном в специальных возможностях."
            else -> null
        }
        if (reason != null) { block(context, task, reason); return failure(reason) }
        if (!replace(context, task.copy(status = "running", detail = ""))) return failure("Не удалось сохранить запуск.")
        dismissNotification(context, id)
        val engine = CortexActionEngine(context)
        val text = if (CortexActionEngine.canResume(source)) "Продолжи" else task.text
        val handled = engine.start(text, "fast", force = true, source = source,
            beforeScreen = if (background) ({ if (CortexRuntime.appVisible) CortexRuntime.leaveForAction?.invoke() }) else beforeScreen,
            scheduled = true, explicitConversation = task.message) { result ->
            when {
                result.ok -> replace(context, task.copy(status = "done", detail = result.text, resume = false))
                result.resumable && CortexActionEngine.canResume(source) -> block(context, task.copy(resume = true), result.text)
                else -> {
                    val failed = task.copy(status = "failed", detail = result.text)
                    if (replace(context, failed) && background) notify(context, failed)
                }
            }
            engine.close()
        }
        if (!handled) {
            engine.close()
            val reasonText = "Уточните действие CORTEX."
            block(context, task, reasonText)
            return failure(reasonText)
        }
        return CortexActionEngine.Result("Поручение запущено.", true)
    }

    private fun block(context: Context, task: Task, reason: String) {
        val blocked = task.copy(status = "blocked", detail = reason)
        if (replace(context, blocked)) notify(context, blocked)
    }

    private fun canRunLocally(task: Task): Boolean = task.message == null &&
        CortexLocalCommands.parse(VisualRequest.goal(task.text)) { null }?.all {
            it.optString("kind") in setOf("read_device", "volume", "torch")
        } == true

    fun openIntent(context: Context, id: String) = Intent(context, MainActivity::class.java)
        .putExtra(EXTRA_TASK, id).setData(Uri.parse("cortex-schedule://open/$id"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

    fun showNotification(context: Context, id: String) {
        all(context).firstOrNull { it.id == id && it.status == "due" }?.let { announce(context, it, allowIsland = false) }
    }

    private fun taskIntent(context: Context, task: Task, action: String): Intent {
        val uri = Uri.Builder().scheme("cortex-schedule").authority("task").appendPath(task.id)
        if (task.occurrence.isNotEmpty()) uri.appendPath(task.occurrence)
        return Intent(context, CortexScheduleReceiver::class.java).setAction(action).setData(uri.build()).putExtra("at", task.at)
    }

    private fun pending(context: Context, task: Task, action: String): PendingIntent =
        PendingIntent.getBroadcast(context, 0, taskIntent(context, task, action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun cancelAlarm(context: Context, task: Task) {
        runCatching {
            val alarm = PendingIntent.getBroadcast(context, 0, taskIntent(context, task, ALARM),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE) ?: return@runCatching
            context.getSystemService(AlarmManager::class.java).cancel(alarm)
            alarm.cancel()
        }
    }

    private fun dismissNotification(context: Context, id: String) {
        runCatching { context.getSystemService(NotificationManager::class.java).cancel(id, NOTIFICATION) }
    }

    private fun announcePending(context: Context) {
        all(context).filter { it.status == "due" && !it.announced }.forEach { announce(context, it, allowIsland = false) }
    }

    private fun announce(context: Context, task: Task, allowIsland: Boolean) {
        val presented = allowIsland && screenReady(context) &&
            runCatching { CortexRuntime.reminder?.invoke(task.id, task.text) == true }.getOrDefault(false)
        if ((presented || notify(context, task)) && !task.announced) replace(context, task.copy(announced = true))
    }

    private fun notify(context: Context, task: Task): Boolean {
        if (!notificationsAllowed(context)) return false
        return runCatching {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Напоминания и поручения CORTEX", NotificationManager.IMPORTANCE_HIGH))
            val open = PendingIntent.getActivity(context, 0, openIntent(context, task.id),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val text = if (task.status == "due") task.text else task.detail
            val builder = Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_cortex)
                .setContentTitle(when (task.status) {
                    "due" -> "Напоминание CORTEX"
                    "failed" -> "Поручение завершилось с ошибкой"
                    "unarmed" -> "Нужно восстановить будильник"
                    else -> "Поручение ожидает продолжения"
                })
                .setContentText(text).setStyle(Notification.BigTextStyle().bigText(text)).setContentIntent(open)
                .setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
            if (task.status == "due") {
                builder.addAction(Notification.Action.Builder(null, "Готово", pending(context, task, COMPLETE)).build())
                    .addAction(Notification.Action.Builder(null, "Отложить на 5 мин", pending(context, task, SNOOZE)).build())
            } else if (task.status == "blocked") {
                builder.addAction(Notification.Action.Builder(null, "Продолжить", open).build())
            }
            manager.notify(task.id, NOTIFICATION, builder.build())
        }.isSuccess
    }

    fun receive(context: Context, intent: Intent) {
        when (intent.action) {
            ALARM, COMPLETE, SNOOZE -> receiveTask(context, intent)
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> restore(context)
            Intent.ACTION_TIMEZONE_CHANGED -> restore(context, rebase = true)
            Intent.ACTION_TIME_CHANGED, AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED -> restore(context)
        }
    }

    private fun receiveTask(context: Context, intent: Intent) {
        val uri = intent.data ?: return
        if (uri.scheme != "cortex-schedule" || uri.host != "task" || uri.pathSegments.size !in 1..2) return
        val id = uri.pathSegments[0]
        val occurrence = uri.pathSegments.getOrElse(1) { "" }
        val at = intent.getLongExtra("at", 0)
        if (intent.action == ALARM) {
            if (!prepare(context)) return
            deliver(context, id, at, occurrence)
        } else if (all(context).any { it.id == id && it.at == at && it.occurrence == occurrence }) {
            handle(context, id, if (intent.action == COMPLETE) "done" else "snooze")
        }
    }

    private val SIMPLE_MESSAGE = Regex(
        """^(?:напиши|отправь)(?:\s+(?:сообщение|текст))?\s+([^,:]+?)(?:\s+в\s+([^,:]+))?(?:\s*,\s*что\s+|\s*:\s*|\s*[,—]\s*)(.+)$""",
        RegexOption.IGNORE_CASE
    )
}

class CortexScheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!CortexRuntime.firstExperienceActive) FirstExperienceBrightness.restorePending(context)
        CortexSchedule.receive(context.applicationContext, intent)
    }
}
