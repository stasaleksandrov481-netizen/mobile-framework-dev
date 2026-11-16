package app.cortex.assistant

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.SystemClock
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.text.method.LinkMovementMethod
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.animation.PathInterpolator
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.exp
import kotlin.math.roundToInt
import kotlin.math.sin

internal class IslandConversationPanel(
    context: Context,
    private val sendMessage: (String) -> Unit,
    private val stopMessage: () -> Unit,
    close: () -> Unit,
    openApp: () -> Unit
) : LinearLayout(context) {
    private val density = resources.displayMetrics.density
    private val status = label(11.5f, 0xFFBABABA.toInt())
    private val signal = Signal()
    private val response = label(15f, Color.WHITE)
    private val answerScroll = ScrollView(context)
    private val header = LinearLayout(context)
    private val divider = View(context)
    private val editor = EditText(context)
    private val entry = Entry()
    private val sendButton = Glyph("send", "Отправить", true)
    private val widgets = LinearLayout(context)
    private var appearance = IslandAppearance.parse()
    private var reminderActions: ((String) -> Unit)? = null
    private var busy = false
    private var answer = ""
    private var motion = ValueAnimator.areAnimatorsEnabled()
    var onKeyboardFocus: ((Boolean) -> Unit)? = null

    init {
        orientation = VERTICAL
        setPadding(dp(17), dp(12), dp(15), dp(14))
        isSoundEffectsEnabled = false
        isFocusableInTouchMode = true
        isClickable = true
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        descendantFocusability = FOCUS_AFTER_DESCENDANTS

        header.gravity = Gravity.CENTER_VERTICAL
        val identity = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        identity.addView(signal, LayoutParams(dp(42), dp(42)))
        status.maxLines = 1
        status.ellipsize = TextUtils.TruncateAt.END
        status.text = ""
        // Keep the header geometry fixed while the model changes phases.
        status.visibility = INVISIBLE
        status.minHeight = dp(17)
        status.accessibilityLiveRegion = ACCESSIBILITY_LIVE_REGION_POLITE
        identity.addView(status, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(5) })
        header.addView(identity, LayoutParams(0, dp(44), 1f))
        header.addView(Glyph("open", "Открыть приложение").apply { setOnClickListener { openApp() } },
            LayoutParams(dp(44), dp(44)))
        header.addView(Glyph("close", "Свернуть островок").apply { setOnClickListener { close() } },
            LayoutParams(dp(44), dp(44)))
        addView(header, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(divider, LayoutParams(LayoutParams.MATCH_PARENT, dp(1)).apply {
            topMargin = dp(5)
            bottomMargin = dp(9)
            marginStart = dp(2)
            marginEnd = dp(2)
        })
        divider.setBackgroundColor(0x1FFFFFFF)

        answerScroll.apply {
            isFillViewport = false
            isVerticalScrollBarEnabled = true
            overScrollMode = OVER_SCROLL_NEVER
            visibility = INVISIBLE
            isSoundEffectsEnabled = false
            addView(response, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        }
        response.apply {
            // The AI answer is text on the island canvas, never its own pill.
            background = null
            setBackgroundColor(Color.TRANSPARENT)
            elevation = 0f
            setPadding(dp(2), dp(8), dp(2), dp(11))
            setLineSpacing(dp(2).toFloat(), 1.10f)
            letterSpacing = 0f
            linksClickable = true
            movementMethod = LinkMovementMethod.getInstance()
            setLinkTextColor(Color.WHITE)
            isFocusable = true
        }
        decorateReply()
        addView(answerScroll, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f).apply { bottomMargin = dp(6) })
        addView(widgets, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(4) })

        editor.apply {
            hint = "Спросить CORTEX…"
            isSoundEffectsEnabled = false
            contentDescription = "Сообщение Кортексу"
            setHintTextColor(0xFFAAAAAA.toInt())
            setTextColor(Color.WHITE)
            highlightColor = 0x55FFFFFF
            if (Build.VERSION.SDK_INT >= 29) {
                textCursorDrawable = GradientDrawable().apply {
                    setColor(Color.WHITE)
                    setSize(dp(2), dp(18))
                }
            }
            textSize = 14f
            includeFontPadding = false
            gravity = Gravity.CENTER_VERTICAL
            background = null
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            imeOptions = EditorInfo.IME_ACTION_SEND or EditorInfo.IME_FLAG_NO_EXTRACT_UI
            minHeight = dp(44)
            maxLines = 2
            filters = arrayOf(InputFilter.LengthFilter(600))
            setPadding(dp(11), dp(5), dp(5), dp(5))
            setOnFocusChangeListener { _, focused ->
                entry.focused = focused
                entry.invalidate()
                onKeyboardFocus?.invoke(focused)
            }
            setOnEditorActionListener { _, action, event ->
                val enter = event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN && !event.isShiftPressed
                if (action != EditorInfo.IME_ACTION_SEND && !enter) false
                else {
                    if (!busy) submit()
                    true
                }
            }
            setOnTouchListener { _, event ->
                if (event.actionMasked == MotionEvent.ACTION_UP && !hasFocus()) {
                    onKeyboardFocus?.invoke(true)
                    requestFocus()
                    post { keyboard()?.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT) }
                }
                false
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: Editable?) = refreshSend()
            })
        }
        entry.addView(editor, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
        entry.addView(sendButton, LayoutParams(dp(44), dp(44)))
        sendButton.setOnClickListener { if (busy) stopMessage() else submit() }
        addView(entry, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        refreshSend()
        renderWidgets()
    }

    fun status(phase: String, label: String) {
        val changed = signal.phase != phase
        if (changed) {
            signal.phase = phase
            signal.invalidate()
        }
        val message = label.trim()
        val show = (appearance.status || phase == "reminder") && phase != "idle" && message.isNotBlank()
        status.visibility = if (show) VISIBLE else INVISIBLE
        if (status.text.toString() == message) return
        status.text = message
        if (changed && motion) {
            status.animate().cancel()
            status.alpha = .64f
            status.animate().alpha(1f).setDuration(190L).start()
        }
    }

    fun animateSignal(animate: Boolean) {
        if (motion == animate) return
        motion = animate
        signal.invalidate()
    }

    fun audioLevel(level: Float) {
        signal.level = level
        signal.levelAt = SystemClock.uptimeMillis()
        signal.invalidate()
    }

    fun busy(active: Boolean) {
        if (busy == active) return
        busy = active
        sendButton.kind = if (active) "stop" else "send"
        sendButton.contentDescription = if (active) "Остановить задачу" else "Отправить"
        sendButton.invalidate()
        refreshSend()
        renderWidgets()
    }

    fun answer(value: String) {
        if (answer == value) return
        val wasEmpty = answer.isBlank()
        val appended = value.startsWith(answer)
        val pinned = answerScroll.scrollY >= response.height - answerScroll.height - dp(22)
        answer = value
        val hasAnswer = value.isNotBlank()
        response.text = IslandMarkdown.render(value, appearance.accent)
        answerScroll.visibility = if (hasAnswer) VISIBLE else INVISIBLE
        if (wasEmpty == hasAnswer) renderWidgets()
        if (wasEmpty && hasAnswer) {
            answerScroll.scrollTo(0, 0)
            if (motion) {
                response.animate().cancel()
                response.alpha = .52f
                response.translationY = dp(6).toFloat()
                response.animate().alpha(1f).translationY(0f).setDuration(275)
                    .setInterpolator(android.view.animation.PathInterpolator(.18f, 1f, .32f, 1f)).start()
            }
        } else if (hasAnswer && appended && pinned) {
            answerScroll.post {
                if (answer == value) answerScroll.scrollTo(0, (response.height - answerScroll.height).coerceAtLeast(0))
            }
        }
    }

    private fun decorateReply() {
        // The answer is part of the same true-black surface, not a grey bubble.
        answerScroll.background = null
        answerScroll.setBackgroundColor(Color.TRANSPARENT)
        answerScroll.elevation = 0f
    }

    fun reveal(progress: Float) {
        val density = resources.displayMetrics.density
        header.translationY = (1f - progress) * 5 * density
        divider.alpha = progress
        answerScroll.alpha = ((progress - .12f) / .88f).coerceIn(0f, 1f)
        answerScroll.translationY = (1f - progress) * 8 * density
        entry.alpha = ((progress - .28f) / .72f).coerceIn(0f, 1f)
        entry.translationY = (1f - progress) * 9 * density
        widgets.alpha = entry.alpha
    }

    fun appearance(value: IslandAppearance) {
        if (appearance == value) return
        appearance = value
        decorateReply()
        response.setTextColor(value.text)
        response.setLinkTextColor(value.accent)
        status.setTextColor((value.text and 0x00FFFFFF) or 0xB0000000.toInt())
        divider.setBackgroundColor((value.text and 0x00FFFFFF) or 0x24000000)
        editor.setTextColor(value.text)
        editor.setHintTextColor((value.text and 0x00FFFFFF) or 0xA0000000.toInt())
        signal.tint(value.accent)
        entry.invalidate()
        sendButton.invalidate()
        for (i in 0 until header.childCount) header.getChildAt(i).invalidate()
        renderWidgets()
    }

    fun reminder(action: ((String) -> Unit)?) {
        if (action === reminderActions) return
        reminderActions = action
        if (action != null) hideKeyboard()
        entry.visibility = if (action == null) VISIBLE else GONE
        renderWidgets()
    }

    private fun renderWidgets() {
        widgets.removeAllViews()
        val reminder = reminderActions
        // Only task-specific actions belong in the island. General phone facts and
        // canned prompts belong to the full app, never to this compact surface.
        val options = if (reminder != null) listOf("Готово" to "done", "Отложить" to "snooze", "Открыть" to "open")
            else emptyList()
        widgets.visibility = if (options.isEmpty()) GONE else VISIBLE
        options.forEach { (name, command) ->
            val chip = label(11.5f, appearance.text).apply {
                text = name
                gravity = Gravity.CENTER
                minHeight = dp(42)
                isFocusable = true
                isSoundEffectsEnabled = false
                background = GradientDrawable().apply {
                    cornerRadius = dp(13).toFloat()
                    setColor(Color.BLACK)
                    setStroke(dp(1), (appearance.border and 0x00FFFFFF) or 0x40000000)
                }
                setOnClickListener { if (reminder == null) sendMessage(command) else reminder(command) }
            }
            widgets.addView(chip, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(4) })
        }
    }

    fun hideKeyboard() {
        if (!editor.hasFocus()) return
        keyboard()?.hideSoftInputFromWindow(windowToken, 0)
        requestFocus()
        editor.clearFocus()
        onKeyboardFocus?.invoke(false)
    }

    fun draft() = editor.text.toString()
    fun draft(value: String) { editor.setText(value); editor.setSelection(editor.length()) }

    private fun submit() {
        val value = draft().trim()
        if (value.isEmpty()) return
        editor.text.clear()
        hideKeyboard()
        sendMessage(value)
    }

    private fun refreshSend() {
        val enabled = busy || editor.text.isNotBlank()
        if (sendButton.isEnabled != enabled) {
            sendButton.isEnabled = enabled
            sendButton.invalidate()
        }
    }

    private fun keyboard() = context.getSystemService(InputMethodManager::class.java)
    private fun dp(value: Int) = (value * density).roundToInt()
    private fun label(size: Float, color: Int) = TextView(context).apply {
        textSize = size
        setTextColor(color)
        includeFontPadding = false
    }

    private inner class Signal : View(context) {
        private val drawing = IslandSignal(density)
        var phase = "idle"
        var levelAt = 0L
        var level = 0f
        fun tint(color: Int) {
            drawing.tint = color
            invalidate()
        }

        init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }

        override fun onDraw(canvas: Canvas) {
            val moving = motion && isShown && windowVisibility == VISIBLE
            val now = SystemClock.uptimeMillis()
            val time = if (moving) (now % 720_000L) / 1000f else 0f
            val active = appearance.progress && (phase == "listening" || phase == "thinking" || phase == "executing")
            val pulse = if (moving) (sin(time * if (active) 5f else 1.8f) + 1f) * .5f else .5f
            val voice = if (phase == "listening") level * exp((levelAt - now) / 240f) else 0f
            val centerX = width / 2f
            val centerY = height / 2f
            canvas.save()
            canvas.scale(.96f + pulse * .08f + .12f * voice, .96f + pulse * .08f + .12f * voice, centerX, centerY)
            drawing.mark(canvas, centerX, centerY, .78f + pulse * .22f)
            canvas.restore()
            if (moving) postInvalidateDelayed(if (active) 48 else 85)
        }
    }

    private inner class Entry : LinearLayout(context) {
        var focused = false
        private val ink = Paint(Paint.ANTI_ALIAS_FLAG)

        init {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(11), dp(2), dp(2), dp(2))
            setWillNotDraw(false)
        }

        override fun onDraw(canvas: Canvas) {
            val inset = .65f * density
            val radius = (height / 2f).coerceAtMost(19 * density)
            ink.style = Paint.Style.FILL
            ink.color = Color.BLACK
            ink.alpha = 255
            canvas.drawRoundRect(inset, inset, width - inset, height - inset, radius, radius, ink)
            ink.style = Paint.Style.STROKE
            ink.strokeWidth = density * .8f
            ink.color = if (focused) appearance.accent else appearance.border
            ink.alpha = if (focused) 125 else 42
            canvas.drawRoundRect(inset, inset, width - inset, height - inset, radius, radius, ink)
        }
    }

    private inner class Glyph(
        var kind: String,
        label: String,
        private val prominent: Boolean = false
    ) : View(context) {
        private val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            strokeWidth = 1.65f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        private val symbol = Path()

        init {
            isClickable = true
            isSoundEffectsEnabled = false
            isFocusable = true
            contentDescription = label
        }

        override fun onTouchEvent(event: MotionEvent): Boolean {
            if (isEnabled && motion && ValueAnimator.areAnimatorsEnabled()) {
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        animate().scaleX(.93f).scaleY(.93f).setInterpolator(null).setDuration(100).start()
                    }
                    MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_UP -> {
                        animate().scaleX(1f).scaleY(1f)
                            .setInterpolator(PathInterpolator(.2f, 0f, .2f, 1f)).setDuration(200).start()
                    }
                }
            }
            return super.onTouchEvent(event)
        }

        override fun onDraw(canvas: Canvas) {
            canvas.save()
            canvas.translate(width / 2f, height / 2f)
            canvas.scale(density, density)
            if (prominent) {
                pen.style = Paint.Style.FILL
                pen.color = appearance.text
                pen.alpha = if (isEnabled) 255 else 58
                canvas.drawRoundRect(-16f, -16f, 16f, 16f, 11f, 11f, pen)
                pen.color = if (isEnabled) appearance.background else appearance.text
            } else {
                pen.style = Paint.Style.FILL
                pen.color = appearance.text
                pen.alpha = if (isPressed) 32 else 13
                canvas.drawRoundRect(-16f, -16f, 16f, 16f, 12f, 12f, pen)
                pen.color = appearance.text
                pen.alpha = if (isPressed) 255 else 204
            }
            pen.style = Paint.Style.STROKE
            symbol.rewind()
            when (kind) {
                "close" -> {
                    symbol.moveTo(-4.6f, 1.8f)
                    symbol.quadTo(-2.1f, -1.1f, 0f, -2.5f)
                    symbol.quadTo(2.1f, -1.1f, 4.6f, 1.8f)
                }
                "open" -> {
                    symbol.moveTo(-4.4f, 4.4f)
                    symbol.lineTo(4.4f, -4.4f)
                    symbol.moveTo(-1.1f, -4.4f)
                    symbol.lineTo(4.4f, -4.4f)
                    symbol.lineTo(4.4f, 1.1f)
                }
                "stop" -> {
                    pen.style = Paint.Style.FILL
                    symbol.addRoundRect(-3.7f, -3.7f, 3.7f, 3.7f, 1.5f, 1.5f, Path.Direction.CW)
                }
                else -> {
                    symbol.moveTo(0f, 5.7f)
                    symbol.lineTo(0f, -5.7f)
                    symbol.moveTo(-4.5f, -1.1f)
                    symbol.quadTo(-2.3f, -3.8f, 0f, -5.7f)
                    symbol.quadTo(2.3f, -3.8f, 4.5f, -1.1f)
                }
            }
            canvas.drawPath(symbol, pen)
            canvas.restore()
        }
    }
}
