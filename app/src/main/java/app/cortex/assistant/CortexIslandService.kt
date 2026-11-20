package app.cortex.assistant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.PointF
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.input.InputManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.Display
import android.view.DisplayCutout
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import androidx.core.content.ContextCompat
import kotlin.math.roundToInt

class CortexIslandService : Service(), DisplayManager.DisplayListener {
    private val ui = Handler(Looper.getMainLooper())
    private lateinit var overlayContext: Context
    private lateinit var manager: WindowManager
    private lateinit var displays: DisplayManager
    private val preferences by lazy { getSharedPreferences("cortex-display", MODE_PRIVATE) }
    private val assistantDelegate = lazy { IslandAssistant(this) }
    private val assistant by assistantDelegate
    private val voiceOutputDelegate = lazy { CortexVoiceOutput(this) }
    private val voiceOutput by voiceOutputDelegate
    private var island: LiquidIslandView? = null
    private var window: WindowManager.LayoutParams? = null
    private var legacyBars = Rect()
    private var legacyCutout: DisplayCutout? = null
    private var placement: IslandPlacement? = null
    private var placementForDemo = false
    private val demonstrating get() = CortexRuntime.firstExperienceActive
    private var keyboardFocus = false
    private var exiting = false
    private var poweringOff = false
    private var layoutGeneration = 0
    private var mode = "off"
    private var style = IslandAppearance.parse()
    private var reminder: Pair<String, String>? = null
    private var reminderActions: ((String) -> Unit)? = null
    private val showReminder: (String, String) -> Boolean = ::presentReminder
    private val reminderTimeout = Runnable { closeReminder(true) }
    private var phase = "idle"
    private var message = ""
    private var draft = ""
    private var reply = ""
    private var clarificationId: String? = null
    private val expireClarification = Runnable { clearClarification() }
    private var opening = false
    private var moving = false
    private var busy = false
    private var wakeExpanded = false
    private var systemInvocation = false
    private var screenListenerRegistered = false
    private var hiddenByVoice = false
    private var touchThrough = false
    private val passThroughAlpha by lazy {
        if (Build.VERSION.SDK_INT >= 31) {
            val maximum = getSystemService(InputManager::class.java).maximumObscuringOpacityForTouch
            (maximum - .03f).coerceIn(0f, 1f)
        } else 1f
    }

    private fun windowAlpha(passThrough: Boolean): Float =
        if (Build.VERSION.SDK_INT >= 33 || passThrough) passThroughAlpha else 1f
    private var task: CortexActionState.Status? = null
    private val actionBusy get() = task?.phase == "executing"
    private val actionStatus: (CortexActionState.Status) -> Unit = ::updateTask
    private val visibilityChanged: () -> Unit = { render() }
    private val wakeLevel: (Float) -> Unit = { island?.audioLevel(it) }
    private val passThrough: (PointF?) -> Boolean = ::passTouchesThrough

    private val clearTask = Runnable {
        if (opening && task?.answer?.isNotBlank() == true) return@Runnable
        task = null
        render()
    }
    private val returnToIdle = Runnable { updateStatus("idle", "") }
    private var repaintPending = false
    private var nextAnimation: Runnable? = null
    private val repaintAnswer = Runnable {
        repaintPending = false
        if (busy) render()
    }

    private val screenOff = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF && systemInvocation) {
                systemInvocation = false
                if (backgroundDisabled()) dismissIsland(power = true) else setExpanded(false)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        CortexActionState.restoreGate(this)
        running = this
        CortexActionState.listener = actionStatus
        CortexRuntime.islandVisibility = visibilityChanged
        CortexRuntime.wakeLevel = wakeLevel
        CortexRuntime.reminder = showReminder
        CortexRuntime.islandTouchPassThrough = passThrough
        displays = getSystemService(DisplayManager::class.java)
        val primary = displays.getDisplay(Display.DEFAULT_DISPLAY)
        overlayContext = if (Build.VERSION.SDK_INT >= 30 && primary != null) {
            runCatching { createDisplayContext(primary).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null) }
                .getOrDefault(this)
        } else this
        manager = overlayContext.getSystemService(WindowManager::class.java)
        displays.registerDisplayListener(this, ui)
        val notification = runCatching {
            val notifications = getSystemService(NotificationManager::class.java)
            notifications.createNotificationChannel(NotificationChannel(CHANNEL, "CORTEX · островок", NotificationManager.IMPORTANCE_LOW))
            val pending = PendingIntent.getActivity(this, 32, Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            Notification.Builder(this, CHANNEL)
                .setContentTitle("CORTEX")
                .setContentText("Островок доступен поверх приложений")
                .setSmallIcon(R.drawable.ic_cortex)
                .setContentIntent(pending)
                .setOngoing(true)
                .build()
        }.getOrNull()
        if (notification == null) {
            stopSelf()
            return
        }
        val foregroundStarted = runCatching {
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(NOTIFICATION, notification)
        }.isSuccess
        if (!foregroundStarted) {
            stopSelf()
            return
        }
        screenListenerRegistered = runCatching {
            ContextCompat.registerReceiver(this, screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED)
        }.isSuccess
        CortexActionState.status?.takeIf {
            it.phase == "executing" || SystemClock.uptimeMillis() - it.at < RESULT_MS
        }?.let(::updateTask)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val systemRequested = intent?.action == ACTION_SYSTEM_ASSIST
        val demoSession = intent?.getStringExtra(EXTRA_DEMO_SESSION).orEmpty()
        val demoRequested = intent?.action == ACTION_FIRST_EXPERIENCE && demonstrating && demoLease.accepts(demoSession)
        if (poweringOff) {
            if (!systemRequested && !demoRequested && preferences.getBoolean(WAKE_PAUSED, false)) return START_NOT_STICKY
            poweringOff = false
            exiting = false
            removeIsland()
        }
        if (intent?.action == ACTION_CONFIG) {
            val requested = intent.getStringExtra(EXTRA_MODE)
            if (requested in setOf("always", "wake", "off")) {
                preferences.edit().putString("mode", requested)
                    .putBoolean(EXTRA_HIDE_LANDSCAPE, intent.getBooleanExtra(EXTRA_HIDE_LANDSCAPE, true)).apply()
            }
        }
        mode = preferences.getString("mode", "off") ?: "off"
        val appearance = IslandAppearance.read(preferences)
        if (style != appearance) {
            if (style.size != appearance.size || style.widthScale != appearance.widthScale ||
                style.heightScale != appearance.heightScale || style.offsetX != appearance.offsetX ||
                style.offsetY != appearance.offsetY) placement = null
            style = appearance
        }
        if (mode != "off" && intent?.getBooleanExtra(EXTRA_RESUME, false) == true) {
            if (hiddenByVoice && exiting) {
                exiting = false
                removeIsland()
            }
            hiddenByVoice = false
        }
        if (systemRequested) {
            assistant.refreshGate()
            openFromSystem()
            return if (backgroundDisabled()) START_NOT_STICKY else START_STICKY
        }
        if (demoRequested) {
            if (voiceOutputDelegate.isInitialized()) voiceOutput.stop()
            hiddenByVoice = false
            if (exiting) { exiting = false; removeIsland() }
            task = CortexActionState.status
            render()
            val firstStart = demoLease.acknowledge(demoSession)
            island?.let { visible ->
                if (firstStart && !preferences.getBoolean("reduceMotion", false) && style.motion != "none") {
                    visible.alpha = 0f
                    visible.animate().alpha(1f).setDuration(340L).start()
                }
            }
            return START_NOT_STICKY
        }
        if (backgroundDisabled() && !systemInvocation && !demonstrating) {
            dismissIsland(power = true)
            return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_WAKE -> {
                if (hiddenByVoice && exiting) {
                    exiting = false
                    removeIsland()
                }
                hiddenByVoice = false
                if (!busy && !actionBusy) {
                    task = null
                    ui.removeCallbacks(clearTask)
                    wakeExpanded = !opening
                    updateStatus("listening", "Слушаю команду…")
                    setExpanded(true)
                } else render()
            }
            ACTION_WAKE_CLOSED -> if (phase == "listening" && !busy) {
                if (wakeExpanded) setExpanded(false)
                wakeExpanded = false
                updateStatus("idle", "")
            }
            ACTION_SUBMIT -> {
                val text = intent.getStringExtra(EXTRA_MESSAGE).orEmpty()
                handleControl(this, text)?.let { control ->
                    if (control.startsWith("Выключить островок")) {
                        reply = control
                        updateStatus("understood", control)
                        setExpanded(true)
                    }
                    return START_STICKY
                }
                if (text.trim().matches(STOP_COMMAND)) stopAnswer()
                else if (text.isNotBlank() && !hiddenByVoice && canShow() && !busy && !actionBusy) {
                    submit(text, fromVoice = true)
                }
            }
            else -> render()
        }
        return if (backgroundDisabled()) START_NOT_STICKY else START_STICKY
    }

    private fun backgroundDisabled() = mode == "off" || preferences.getBoolean(WAKE_PAUSED, false)

    private fun canShow() = Settings.canDrawOverlays(this) && allowedInOrientation(this)

    private fun openFromSystem() {
        if (!CortexSchedule.screenReady(this) || !canShow()) {
            if (backgroundDisabled()) dismissIsland(power = true)
            return
        }
        if (exiting) {
            exiting = false
            removeIsland()
        }
        hiddenByVoice = false
        wakeExpanded = false
        systemInvocation = true
        render()
        if (island == null) {
            systemInvocation = false
            if (backgroundDisabled()) dismissIsland(power = true)
            return
        }
        if (!actionBusy) setExpanded(true)
    }

    private fun closeComposer() {
        if (reminder != null) {
            closeReminder(true)
            return
        }
        if (systemInvocation && !busy && !actionBusy) {
            systemInvocation = false
            if (backgroundDisabled()) {
                dismissIsland(power = true)
                return
            }
        }
        setExpanded(false)
    }

    private fun presentReminder(id: String, text: String): Boolean {
        if (mode == "off" || hiddenByVoice || poweringOff || exiting || busy || actionBusy ||
            reminder != null || !canShow() || !CortexSchedule.screenReady(this)) return false
        reminder = id to text
        reminderActions = { action ->
            if (action == "open") {
                val opened = runCatching { startActivity(CortexSchedule.openIntent(this, id)) }.isSuccess
                closeReminder(!opened)
            } else {
                val result = CortexSchedule.handle(this, id, action)
                closeReminder(!result.ok)
            }
        }
        render()
        if (island == null) {
            reminder = null
            reminderActions = null
            return false
        }
        setExpanded(true)
        ui.postDelayed(reminderTimeout, 20_000L)
        return true
    }

    private fun closeReminder(notify: Boolean) {
        val id = reminder?.first ?: return
        ui.removeCallbacks(reminderTimeout)
        reminder = null
        reminderActions = null
        if (notify) CortexSchedule.showNotification(this, id)
        setExpanded(false)
        render()
    }

    private fun updateTask(status: CortexActionState.Status) {
        if (poweringOff) return
        if (status.phase == "executing") closeReminder(true)
        task = status
        ui.removeCallbacks(clearTask)
        if (actionBusy) {
            reply = ""
            if (!busy) setExpanded(false)
        } else {
            val remaining = RESULT_MS - (SystemClock.uptimeMillis() - status.at)
            ui.postDelayed(clearTask, remaining.coerceAtLeast(0))
        }
        render()
        if (!actionBusy && !busy && status.answer.isNotBlank() && !hiddenByVoice && !CortexRuntime.appVisible) {
            setExpanded(true)
        }
    }

    private fun hideTemporarily() {
        if (hiddenByVoice || poweringOff) return
        hiddenByVoice = true
        systemInvocation = false
        dismissIsland(power = backgroundDisabled())
    }

    private fun dismissIsland(power: Boolean) {
        reminder?.first?.let { CortexSchedule.showNotification(this, it) }
        reminder = null
        reminderActions = null
        ui.removeCallbacks(reminderTimeout)
        if (power) {
            if (poweringOff) return
            poweringOff = true
            systemInvocation = false
            ui.removeCallbacks(returnToIdle)
            ui.removeCallbacks(clearTask)
            ui.removeCallbacks(repaintAnswer)
        } else if (exiting) return
        val view = island
        if (view == null) {
            if (power) stopSelf()
            return
        }
        exiting = true
        ++layoutGeneration
        keyboardFocus = false
        touchThrough = true
        view.conversation.hideKeyboard()
        window?.let { params ->
            params.flags = windowFlags(false)
            if (Build.VERSION.SDK_INT >= 31) {
                params.alpha = (getSystemService(InputManager::class.java).maximumObscuringOpacityForTouch - .02f)
                    .coerceIn(0f, 1f)
            }
            runCatching { manager.updateViewLayout(view, params) }
        }
        view.disappear(power) {
            if (island === view && exiting) {
                exiting = false
                removeIsland()
                if (poweringOff) stopSelf()
                else if (!hiddenByVoice && !CortexRuntime.appVisible) render()
            }
        }
    }

    private fun updateStatus(state: String, text: String) {
        ui.removeCallbacks(returnToIdle)
        phase = state
        message = text
        if (!busy) {
            val delay = when (state) {
                "done", "error", "stopped" -> if (reply.isNotBlank()) 12_000L else RESULT_MS
                "listening" -> 0L
                "understood" -> 12_000L
                "executing" -> 0L
                else -> 0L
            }
            if (delay > 0) ui.postDelayed(returnToIdle, delay)
        }
        render()
    }

    private fun render() {
        if (exiting || poweringOff) return
        if (!canShow()) {
            val wasInvoked = systemInvocation
            systemInvocation = false
            if (island != null || wasInvoked && backgroundDisabled()) dismissIsland(power = backgroundDisabled())
            return
        }
        val hiddenInApp = CortexRuntime.appVisible && reminder == null && !moving
        val waitingForWake = mode == "wake" && phase == "idle" && task == null && reminder == null && !opening && !moving
        if (!demonstrating && !systemInvocation && (backgroundDisabled() || hiddenByVoice || hiddenInApp || waitingForWake)) {
            if (island != null) dismissIsland(power = backgroundDisabled())
            return
        }
        if (placementForDemo != demonstrating) { placement = null; placementForDemo = demonstrating }
        if (placement == null) placement = IslandPlacement(measureScreen(), overlayContext.resources.displayMetrics.density, style, demonstrating)
        val visible = island ?: createIsland() ?: return
        val state = if (reminder != null) "reminder" else if (busy && !actionBusy) phase else task?.phase ?: phase
        val progressText = task?.message.orEmpty()
        val label = when (state) {
            "listening" -> message.ifBlank { "Слушаю…" }
            "thinking" -> "Думаю…"
            "executing" -> progressText.ifBlank { message.ifBlank { "Выполняю…" } }
            "reminder" -> "Напоминание"
            "done" -> "Готово"
            "error" -> "Проверьте результат"
            "stopped" -> "Остановлено"
            "understood" -> message
            else -> ""
        }
        visible.appearance(if (demonstrating) style.copy(background = android.graphics.Color.BLACK,
            text = android.graphics.Color.WHITE, accent = android.graphics.Color.WHITE,
            border = android.graphics.Color.WHITE, glass = false, mascot = false) else style)
        visible.phase(state, label, actionBusy, demonstrating)
        visible.haptics = preferences.getBoolean("haptics", true)
        visible.reduceMotion(preferences.getBoolean("reduceMotion", false) || style.motion == "none")
        visible.conversation.status(state, label)
        visible.conversation.busy(busy || actionBusy)
        visible.conversation.reminder(reminderActions)
        val asking = clarificationId != null && !busy && !actionBusy && reminder == null
        visible.conversation.clarification(asking)
        val resultText = task?.takeUnless { actionBusy }?.answer.orEmpty()
        visible.conversation.answer(reminder?.second ?: when {
            busy || asking -> reply
            !style.results -> ""
            reply.isNotBlank() -> reply
            else -> resultText
        })
        placeIsland(visible)
    }

    private fun createIsland(): LiquidIslandView? {
        val panel = IslandConversationPanel(overlayContext, { submit(it) }, ::stopAnswer,
            ::closeComposer, ::openApplication, { clearClarification() })
        panel.draft(draft)
        panel.onKeyboardFocus = { focused ->
            keyboardFocus = focused && opening && !exiting
            island?.let(::placeIsland)
        }
        val view = LiquidIslandView(overlayContext, panel, { setExpanded(true) },
            ::closeComposer, ::openApplication, ::stopAnswer)
        val params = layoutParams()
        window = params
        placeIsland(view)
        if (Build.VERSION.SDK_INT in 26..28) watchLegacyInsets(view)
        return runCatching { manager.addView(view, params); view }.onSuccess { island = it }
            .onFailure { window = null }.getOrNull()
    }

    private fun setExpanded(open: Boolean) {
        if (exiting || poweringOff || open && actionBusy) return
        val view = island ?: return
        if (open == opening) return
        nextAnimation?.let(view::removeCallbacks)
        view.cancelPlacementWait()
        val generation = ++layoutGeneration
        opening = open
        moving = true
        if (!open) {
            keyboardFocus = false
            view.conversation.hideKeyboard()
        }
        placeIsland(view)
        val targetWindow = placement?.window(true) ?: return
        nextAnimation = Runnable {
            nextAnimation = null
            if (island !== view || generation != layoutGeneration || exiting) return@Runnable
            view.whenWindowReady(targetWindow) {
                if (island === view && generation == layoutGeneration && !exiting) {
                    view.expand(open) {
                        if (island === view && generation == layoutGeneration && !exiting) {
                            val settle = {
                                if (island === view && generation == layoutGeneration && !exiting) {
                                    moving = false
                                    placeIsland(view)
                                    val player = if (open && CortexActionState.gate == "open" && CortexSchedule.screenReady(this))
                                        CortexMedia.player(this) else null
                                    view.conversation.media(player)
                                    if (!open) {
                                        if (task?.let { it.phase != "executing" && SystemClock.uptimeMillis() - it.at >= RESULT_MS } == true) task = null
                                        render()
                                    }
                                }
                            }
                            // Never shrink the touch window in the middle of a
                            // morph. Let Android compose the final capsule first.
                            if (open) settle() else view.postOnAnimation { settle() }
                        }
                    }
                }
            }
        }.also(view::postOnAnimation)
    }

    private fun placeIsland(view: LiquidIslandView) {
        val geometry = placement ?: return
        val params = window ?: return
        val touchBox = geometry.window(opening || moving)
        val box = if (Build.VERSION.SDK_INT >= 33) geometry.window(true) else touchBox
        // Android 13+ keeps the surface fixed; older versions resize around its center.
        // The artwork uses screen coordinates in both cases.
        val x = if (Build.VERSION.SDK_INT >= 33) box.left - geometry.screen.bounds.left
            else (box.exactCenterX() - geometry.screen.bounds.exactCenterX()).roundToInt()
        val y = box.top - geometry.screen.bounds.top
        val flags = windowFlags(keyboardFocus)
        val changed = x != params.x || y != params.y || box.width() != params.width ||
            box.height() != params.height || flags != params.flags
        params.x = x
        params.y = y
        params.width = box.width().coerceAtLeast(1)
        params.height = box.height().coerceAtLeast(1)
        params.flags = flags
        view.place(geometry, box, touchBox)
        if (changed && view.isAttachedToWindow) runCatching { manager.updateViewLayout(view, params) }
    }

    private fun submit(raw: String, fromVoice: Boolean = false) {
        if (demonstrating) return
        val text = raw.trim().take(2400)
        if (clarificationId == null) handleControl(this, text)?.let { control ->
            if (control.startsWith("Выключить островок")) {
                reply = control
                updateStatus("understood", control)
            }
            return
        }
        if (busy || actionBusy || text.isEmpty() || poweringOff) return
        val answering = clarificationId
        clarificationId = null
        ui.removeCallbacks(expireClarification)
        if (voiceOutputDelegate.isInitialized()) voiceOutput.stop()
        if (fromVoice) island?.conversation?.hideKeyboard()
        busy = true
        task = null
        ui.removeCallbacks(clearTask)
        reply = ""
        updateStatus("thinking", "Думаю…")
        val streamed = StringBuilder()
        var spoken = ""
        fun canSpeak() = fromVoice && !poweringOff && preferences.getBoolean("voiceReplies", true)
        assistant.send(text, preferences.getString("profile", "auto") ?: "auto",
            modelId = preferences.getString("aiModel", "auto").takeUnless { it == "auto" },
            beforeScreen = { setExpanded(false) },
            clarificationId = answering,
            toolsAllowed = { preferences.getBoolean("phoneActions", true) && Settings.canDrawOverlays(this) },
            progress = { updateStatus("executing", it) },
            delta = { chunk ->
                if (streamed.length < 20_000) {
                    val first = streamed.isEmpty()
                    streamed.append(chunk.take(20_000 - streamed.length))
                    reply = streamed.toString()
                    message = "Отвечаю…"
                    if (first) render()
                    else if (!repaintPending) {
                        repaintPending = true
                        ui.postDelayed(repaintAnswer, 32L)
                    }
                }
            },
            textReady = {
                if (canSpeak() && streamed.isNotBlank()) {
                    spoken = streamed.toString().trim()
                    voiceOutput.speak(spoken) {}
                }
            },
            finished = { answer, ok, questionId ->
                busy = false
                ui.removeCallbacks(repaintAnswer)
                repaintPending = false
                reply = answer.trim()
                clarificationId = questionId
                if (questionId != null) ui.postDelayed(expireClarification, CortexActionEngine.CLARIFICATION_TIMEOUT_MS)
                updateStatus(when {
                    questionId != null -> "understood"
                    ok -> "done"
                    else -> "error"
                }, if (questionId != null) "Уточнение" else "")
                if (!hiddenByVoice && !poweringOff) {
                    setExpanded(true)
                    if (opening && CortexActionState.gate == "open") {
                        ui.postDelayed({
                            if (opening && !busy && CortexActionState.gate == "open") island?.conversation?.media(CortexMedia.player(this))
                        }, 400L)
                    }
                }
                if (spoken.isNotEmpty() && reply != spoken) voiceOutput.stop()
                if (reply != spoken && canSpeak() && reply.isNotBlank())
                    voiceOutput.speak(reply) { /* The answer stays visible if Android cannot play audio. */ }
            })
    }

    private fun clearClarification() {
        val id = clarificationId ?: return
        CortexActionEngine.dismissClarification("island", id)
        clarificationId = null
        ui.removeCallbacks(expireClarification)
        reply = ""
        if (task?.phase == "understood") task = null
        updateStatus("idle", "")
    }

    private fun stopAnswer() {
        CortexSchedule.clearDraft("island")
        if (voiceOutputDelegate.isInitialized()) voiceOutput.stop()
        if (!busy) { if (actionBusy) CortexActionState.stop(); return }
        assistant.cancel()
        ui.removeCallbacks(repaintAnswer)
        repaintPending = false
        busy = false
        if (reply.isBlank()) reply = "Ответ остановлен."
        updateStatus("stopped", "Остановлено")
    }

    private fun openApplication() {
        closeComposer()
        runCatching {
            startActivity(Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }
    }

    private fun layoutParams(): WindowManager.LayoutParams =
        WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            windowFlags(false),
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = if (Build.VERSION.SDK_INT >= 33) Gravity.TOP or Gravity.LEFT
                else Gravity.TOP or Gravity.CENTER_HORIZONTAL
            alpha = windowAlpha(false)
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING or WindowManager.LayoutParams.SOFT_INPUT_STATE_UNCHANGED
            if (Build.VERSION.SDK_INT >= 30) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                setFitInsetsTypes(0)
                setFitInsetsSides(0)
            } else if (Build.VERSION.SDK_INT >= 28) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }

    @Suppress("DEPRECATION")
    private fun windowFlags(focus: Boolean): Int =
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED or
            (if (Build.VERSION.SDK_INT < 30) WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS else 0) or
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
            (if (focus && !touchThrough) 0 else WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE) or
            (if (touchThrough) WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else 0)

    private fun passTouchesThrough(point: PointF?): Boolean {
        val view = island ?: return false
        if (exiting) return false
        val lp = window ?: return false
        if (point != null && !view.windowContains(point)) return false
        val enabled = point != null
        if (enabled == touchThrough) return enabled
        touchThrough = enabled
        lp.alpha = windowAlpha(enabled)
        lp.flags = windowFlags(keyboardFocus && !actionBusy)
        val updated = runCatching { manager.updateViewLayout(view, lp) }.isSuccess
        if (!updated) {
            touchThrough = false
            lp.alpha = windowAlpha(false)
            lp.flags = windowFlags(keyboardFocus && !actionBusy)
        }
        return enabled && updated
    }

    @Suppress("DEPRECATION")
    private fun measureScreen(): IslandScreen {
        if (Build.VERSION.SDK_INT >= 30) {
            val metrics = manager.maximumWindowMetrics
            val bars = metrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars())
            val cutout = manager.defaultDisplay.cutout ?: metrics.windowInsets.displayCutout
            val waterfall = cutout?.waterfallInsets
            return IslandScreen(Rect(metrics.bounds), Rect(maxOf(bars.left, waterfall?.left ?: 0),
                maxOf(bars.top, waterfall?.top ?: 0), maxOf(bars.right, waterfall?.right ?: 0),
                maxOf(bars.bottom, waterfall?.bottom ?: 0)), cutouts(cutout, metrics.bounds))
        }
        val display = manager.defaultDisplay
        val size = Point()
        display.getRealSize(size)
        val bounds = Rect(0, 0, size.x, size.y)
        val cutout = if (Build.VERSION.SDK_INT >= 29) display.cutout else legacyCutout
        val status = resources.getIdentifier("status_bar_height", "dimen", "android")
            .takeIf { it != 0 }?.let(resources::getDimensionPixelSize) ?: (24 * resources.displayMetrics.density).roundToInt()
        val bars = Rect(legacyBars).apply {
            top = maxOf(top, status)
            if (bottom == 0) bottom = (24 * resources.displayMetrics.density).roundToInt()
        }
        return IslandScreen(bounds, bars, cutouts(cutout, bounds))
    }

    private fun cutouts(value: DisplayCutout?, bounds: Rect): List<IslandCutout> {
        if (value == null || Build.VERSION.SDK_INT < 28) return emptyList()
        if (Build.VERSION.SDK_INT >= 29) return listOf(
            Gravity.TOP to value.boundingRectTop, Gravity.LEFT to value.boundingRectLeft,
            Gravity.RIGHT to value.boundingRectRight, Gravity.BOTTOM to value.boundingRectBottom
        ).filterNot { (_, rect) -> rect.isEmpty }.map { (edge, rect) -> IslandCutout(edge, rect) }
        return value.boundingRects.map { rect ->
            val edge = listOf(
                Gravity.TOP to rect.top - bounds.top, Gravity.LEFT to rect.left - bounds.left,
                Gravity.RIGHT to bounds.right - rect.right, Gravity.BOTTOM to bounds.bottom - rect.bottom
            ).minBy { it.second }.first
            IslandCutout(edge, rect)
        }
    }

    @Suppress("DEPRECATION")
    private fun watchLegacyInsets(view: View) {
        view.setOnApplyWindowInsetsListener { _, insets ->
            val bars = Rect(insets.stableInsetLeft, insets.stableInsetTop, insets.stableInsetRight, insets.stableInsetBottom)
            val cutout = if (Build.VERSION.SDK_INT >= 28) insets.displayCutout else null
            if (bars != legacyBars || cutout != null && cutout != legacyCutout) {
                legacyBars = bars
                if (cutout != null) legacyCutout = cutout
                placement = null
                ui.post(::render)
            }
            insets
        }
    }

    private fun removeIsland() {
        ++layoutGeneration
        island?.let { view ->
            nextAnimation?.let(view::removeCallbacks)
            nextAnimation = null
            draft = view.conversation.draft()
            view.cancelAnimation()
            view.conversation.hideKeyboard()
            runCatching { manager.removeViewImmediate(view) }
        }
        island = null
        window = null
        touchThrough = false
        keyboardFocus = false
        opening = false
        moving = false
        wakeExpanded = false
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        placement = null
        legacyCutout = null
        ui.post(::render)
    }

    override fun onDisplayChanged(displayId: Int) {
        if (displayId != Display.DEFAULT_DISPLAY) return
        placement = null
        ui.post(::render)
    }
    override fun onDisplayAdded(displayId: Int) = Unit
    override fun onDisplayRemoved(displayId: Int) = Unit
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        if (demonstrating) CortexFirstExperience.stop("Знакомство остановлено: островок недоступен.")
        reminder?.first?.let { CortexSchedule.showNotification(this, it) }
        if (CortexRuntime.reminder === showReminder) CortexRuntime.reminder = null
        if (CortexActionState.listener === actionStatus) CortexActionState.listener = null
        if (CortexRuntime.islandVisibility === visibilityChanged) CortexRuntime.islandVisibility = null
        if (CortexRuntime.wakeLevel === wakeLevel) CortexRuntime.wakeLevel = null
        if (CortexRuntime.islandTouchPassThrough === passThrough) CortexRuntime.islandTouchPassThrough = null
        if (running === this) running = null
        if (screenListenerRegistered) unregisterReceiver(screenOff)
        displays.unregisterDisplayListener(this)
        ui.removeCallbacksAndMessages(null)
        removeIsland()
        if (assistantDelegate.isInitialized()) assistant.close()
        if (voiceOutputDelegate.isInitialized()) voiceOutput.close()
        super.onDestroy()
    }

    companion object {
        const val ACTION_CONFIG = "app.cortex.assistant.island.CONFIG"
        const val ACTION_ENSURE = "app.cortex.assistant.island.ENSURE"
        internal const val ACTION_SYSTEM_ASSIST = "app.cortex.assistant.island.SYSTEM_ASSIST"
        private const val ACTION_FIRST_EXPERIENCE = "app.cortex.assistant.island.FIRST_EXPERIENCE"
        private const val EXTRA_DEMO_SESSION = "firstExperienceSession"
        const val ACTION_WAKE = "app.cortex.assistant.island.WAKE"
        const val ACTION_WAKE_CLOSED = "app.cortex.assistant.island.WAKE_CLOSED"
        const val ACTION_SUBMIT = "app.cortex.assistant.island.SUBMIT"
        const val EXTRA_MODE = "mode"
        const val EXTRA_HIDE_LANDSCAPE = "hideLandscape"
        const val EXTRA_RESUME = "resume"
        const val EXTRA_MESSAGE = "message"
        internal const val WAKE_PAUSED = "wakePausedByVoice"
        private val STOP_COMMAND = Regex("(?iu)^(?:стоп|остановись|отмена)[.!?]*$")
        private val HIDE_COMMAND = Regex("(?iu)^(?:убери|скрой|спрячь|закрой) (?:островок|динамический островок)$")
        private val POWER_COMMAND = Regex("(?iu)^(?:выключись|отключись|выключи себя|отключи себя|выключи кортекс|останови работу в фоне|иди спи|иди спать|отдыхай|перестань слушать|усни)$")
        private const val RESULT_MS = 6_800L
        private const val CHANNEL = "cortex-island"
        private const val NOTIFICATION = 2810
        private var running: CortexIslandService? = null
        private val demoLease = FirstExperienceIslandSession()

        internal fun beginFirstExperience(context: Context, session: String): Boolean {
            if (running?.busy == true || !CortexRuntime.firstExperienceActive) return false
            demoLease.request(session)
            return runCatching {
                context.startForegroundService(Intent(context, CortexIslandService::class.java)
                    .setAction(ACTION_FIRST_EXPERIENCE).putExtra(EXTRA_DEMO_SESSION, session))
                true
            }.getOrElse { demoLease.release(session); false }
        }

        internal fun firstExperienceReady(session: String) = running?.let {
            it.demonstrating && it.canShow() && demoLease.ready(session,
                it.island?.isAttachedToWindow == true, it.exiting || it.poweringOff, it.island?.alpha ?: 0f)
        } == true

        /** Ongoing availability is independent of cosmetic opacity/animation progress. */
        internal fun firstExperienceAvailable(session: String) = running?.let {
            it.demonstrating && it.canShow() && demoLease.available(session,
                it.island?.isAttachedToWindow == true, it.exiting || it.poweringOff)
        } == true

        internal fun pulseFirstExperience() { running?.island?.experiencePulse() }

        internal fun endFirstExperience(session: String) {
            running?.let { it.mode = it.preferences.getString("mode", "off") ?: "off" }
            if (!demoLease.release(session)) { running?.render(); return }
            running?.apply {
                task = null
                ui.removeCallbacks(clearTask)
                updateStatus("idle", "")
            }
        }

        internal fun allowedInOrientation(context: Context) =
            context.resources.configuration.orientation != Configuration.ORIENTATION_LANDSCAPE ||
                !context.getSharedPreferences("cortex-display", MODE_PRIVATE).getBoolean(EXTRA_HIDE_LANDSCAPE, true)

        internal fun handleControl(context: Context, raw: String): String? {
            val command = (CortexHotword.command(raw) ?: raw).trim().trimEnd('.', '!', '?').trim()
                .replace(Regex("\\s+"), " ")
            return when {
                HIDE_COMMAND.matches(command) -> {
                    running?.hideTemporarily()
                    "Островок скрыт до следующего вызова."
                }
                POWER_COMMAND.matches(command) -> {
                    "Выключить островок можно только в настройках приложения CORTEX."
                }
                else -> null
            }
        }

        fun shutdownFromApp(context: Context) {
            // Late normal-mode configuration must not remove the demo's only Stop control.
            // The saved off/paused mode is applied by endFirstExperience after cleanup.
            if (CortexRuntime.firstExperienceActive) {
                running?.apply { mode = preferences.getString("mode", "off") ?: "off"; render() }
                return
            }
            val service = running
            if (service != null) service.dismissIsland(power = true)
            else context.stopService(Intent(context, CortexIslandService::class.java))
        }

        fun send(context: Context, action: String, extras: Intent.() -> Unit = {}) {
            val preferences = context.getSharedPreferences("cortex-display", MODE_PRIVATE)
            if (preferences.getBoolean(WAKE_PAUSED, false) || preferences.getString("mode", "off") == "off") return
            val intent = Intent(context, CortexIslandService::class.java).apply { this.action = action; extras() }
            runCatching { context.startService(intent) }.onFailure {
                if (action == ACTION_WAKE || action == ACTION_SUBMIT) {
                    CortexRuntime.reportWake("Android ограничил запуск островка в фоне. Откройте CORTEX и проверьте разрешения.")
                }
            }
        }
    }
}
