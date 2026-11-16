package app.cortex.assistant

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.roundToInt

internal class LiquidIslandView(
    context: Context,
    val conversation: IslandConversationPanel,
    private val onOpen: () -> Unit,
    private val onDismiss: () -> Unit,
    onOpenApp: () -> Unit,
    onStop: () -> Unit
) : FrameLayout(context) {
    private val density = resources.displayMetrics.density
    private val body = RectF()
    private val contentClip = Rect()
    private val expandedClip = android.graphics.Path()
    private val box = Rect()
    private val location = IntArray(2)
    private val laidOutAt = IntArray(2)
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG)
    private val wordmarkTypeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    // Keep the light in the same place while the shell morphs: rebuilding a shader
    // on every animation frame produces unnecessary allocations and flicker.
    private val sheen = LinearGradient(0f, 0f, 0f, 1f,
        intArrayOf(0x1FFFFFFF, 0x0BFFFFFF, 0x00FFFFFF),
        floatArrayOf(0f, .35f, 1f), Shader.TileMode.CLAMP)
    private val sheenMatrix = Matrix()
    private val signal = IslandSignal(density)
    private var placement: IslandPlacement? = null
    private var animator: ValueAnimator? = null
    private var expansion = 0f
    private var disappearance = 0f
    private var motion = true
    private var phase = "idle"
    private var statusText = ""
    private var style = IslandAppearance.parse()
    private var level = 0f
    private var levelAt = 0L
    private var reactionAt = SystemClock.uptimeMillis()
    private var audioFrameAt = 0L
    private var press = false
    private var activeStop = false
    private var powerDown = false
    var haptics = true

    private val stop = View(context).apply {
        visibility = INVISIBLE
        isFocusable = true
        isSoundEffectsEnabled = false
        contentDescription = "Остановить задачу CORTEX"
        setOnClickListener { onStop() }
    }

    init {
        setWillNotDraw(false)
        isSoundEffectsEnabled = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        clipChildren = false
        clipToPadding = false
        setOnClickListener { onOpen() }
        setOnLongClickListener { onOpenApp(); true }
        addView(conversation, LayoutParams(0, 0))
        addView(stop, LayoutParams(dp(39), dp(40)))
        setContents()
    }

    fun place(value: IslandPlacement, frame: Rect) {
        if (value === placement && frame == box) return
        placement = value
        box.set(frame)
        val panel = value.panel
        val old = conversation.layoutParams
        if (old.width != panel.width().roundToInt() || old.height != panel.height().roundToInt()) {
            conversation.layoutParams = LayoutParams(panel.width().roundToInt(), panel.height().roundToInt())
        }
        requestLayout()
        invalidate()
    }

    fun phase(value: String, message: String, canStop: Boolean) {
        if (phase != value) reactionAt = SystemClock.uptimeMillis()
        phase = value
        statusText = message
        activeStop = canStop
        val description = if (message.isBlank()) "Островок CORTEX. Ввести команду." else "CORTEX. $message"
        if (contentDescription != description) contentDescription = description
        setContents()
    }

    fun appearance(value: IslandAppearance) {
        if (style == value) return
        style = value
        signal.tint = value.text
        conversation.appearance(value)
        invalidate()
    }

    fun audioLevel(value: Float) {
        val now = SystemClock.uptimeMillis()
        level = mix(level * exp((levelAt - now) / 240f), value.coerceIn(0f, 1f), .48f)
        levelAt = now
        conversation.audioLevel(level)
        if (now - audioFrameAt > 32L) {
            audioFrameAt = now
            invalidate()
        }
    }

    fun windowContains(point: PointF): Boolean {
        if (!isAttachedToWindow) return false
        getLocationOnScreen(location)
        return point.x >= location[0] && point.x < location[0] + width &&
            point.y >= location[1] && point.y < location[1] + height
    }

    fun reduceMotion(reduced: Boolean) {
        val enabled = !reduced && ValueAnimator.areAnimatorsEnabled()
        if (motion == enabled) return
        motion = enabled
        conversation.animateSignal(motion)
        invalidate()
    }

    fun expand(open: Boolean, done: () -> Unit) {
        val start = expansion
        val faded = disappearance
        val end = if (open) 1f else 0f
        val duration = ((if (style.motion == "soft") 310 else if (open) 500 else 460) * abs(start - end))
            .toLong().coerceAtLeast(90L)
        powerDown = false
        animate(duration, if (open) OPEN_CURVE else CLOSE_CURVE, {
            expansion = mix(start, end, it)
            disappearance = mix(faded, 0f, it)
        }, done)
    }

    fun disappear(power: Boolean, done: () -> Unit) {
        val start = expansion
        val faded = disappearance
        powerDown = power
        animate(if (power) 560L else 330L, CLOSE_CURVE, { t ->
            expansion = start * (1f - ease(.04f, .76f, t))
            disappearance = mix(faded, 1f, t)
        }, done)
    }

    fun cancelAnimation() {
        animator?.removeAllListeners()
        animator?.removeAllUpdateListeners()
        animator?.cancel()
        animator = null
    }

    private fun animate(duration: Long, curve: PathInterpolator, step: (Float) -> Unit, done: () -> Unit) {
        cancelAnimation()
        if (!motion) {
            step(1f)
            setContents()
            done()
            return
        }
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            this.duration = duration
            interpolator = curve
            addUpdateListener {
                step(it.animatedValue as Float)
                setContents()
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    animator = null
                    done()
                }
            })
            start()
        }
    }

    private fun setContents() {
        // Fade controls before the shrinking shell can clip and drag them sideways.
        val appear = ease(.59f, .97f, expansion) * (1f - ease(0f, .29f, disappearance))
        conversation.alpha = appear
        conversation.reveal(appear)
        conversation.visibility = if (appear > .03f) VISIBLE else INVISIBLE
        val interactive = appear > .9f && disappearance == 0f
        conversation.clipBounds = if (interactive) null else clipConversation()
        conversation.importantForAccessibility =
            if (interactive) IMPORTANT_FOR_ACCESSIBILITY_AUTO else IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        stop.visibility = if (activeStop && expansion < .025f && disappearance == 0f) VISIBLE else INVISIBLE
        importantForAccessibility = if (interactive) IMPORTANT_FOR_ACCESSIBILITY_NO else IMPORTANT_FOR_ACCESSIBILITY_YES
        invalidate()
    }

    private fun clipConversation(): Rect? {
        val geometry = placement ?: return null
        val panel = geometry.panel
        val width = panel.width().roundToInt()
        val height = panel.height().roundToInt()
        contentClip.set(
            (mix(geometry.compact.left, panel.left, expansion) - panel.left).roundToInt().coerceIn(0, width),
            (mix(geometry.compact.top, panel.top, expansion) - panel.top).roundToInt().coerceIn(0, height),
            (mix(geometry.compact.right, panel.right, expansion) - panel.left).roundToInt().coerceIn(0, width),
            (mix(geometry.compact.bottom, panel.bottom, expansion) - panel.top).roundToInt().coerceIn(0, height)
        )
        return contentClip
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        val geometry = placement ?: return
        // WindowManager positions overlays asynchronously. Actual screen coordinates
        // are authoritative; the requested frame may already have changed while the
        // window itself is still at the old position.
        getLocationOnScreen(location)
        laidOutAt[0] = location[0]
        laidOutAt[1] = location[1]
        conversation.translationX = 0f
        conversation.translationY = 0f
        stop.translationX = 0f
        stop.translationY = 0f
        val panel = geometry.panel
        val x = (panel.left - location[0]).roundToInt()
        val y = (panel.top - location[1]).roundToInt()
        conversation.layout(x, y, x + panel.width().roundToInt(), y + panel.height().roundToInt())
        val compact = geometry.compact
        stop.layout((compact.right - location[0] - dp(39)).roundToInt(), (compact.top - location[1]).roundToInt(),
            (compact.right - location[0]).roundToInt(), (compact.bottom - location[1]).roundToInt())
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val geometry = placement ?: return
        val now = SystemClock.uptimeMillis()
        val elapsed = now - reactionAt
        val moving = motion && isShown && windowVisibility == VISIBLE
        val time = if (moving) (now % 240_000L) / 1000f else 0f
        val compact = geometry.compact
        val panel = geometry.panel
        val t = expansion
        val fade = 1f - ease(.25f, 1f, disappearance)
        val scale = 1f - (if (powerDown) .87f else .19f) * ease(.31f, 1f, disappearance)
        getLocationOnScreen(location)
        // A position-only WindowManager update does not always re-layout children.
        // Compensate in BOTH axes until it does, so they stay pinned on screen.
        val shiftX = (laidOutAt[0] - location[0]).toFloat()
        val shiftY = (laidOutAt[1] - location[1]).toFloat()
        if (conversation.translationX != shiftX || conversation.translationY != shiftY) {
            conversation.translationX = shiftX
            conversation.translationY = shiftY
            stop.translationX = shiftX
            stop.translationY = shiftY
        }
        val x = geometry.anchorX - location[0]
        val y = geometry.anchorY - location[1]
        body.set(
            x + (mix(compact.left, panel.left, t) - geometry.anchorX) * scale,
            y + (mix(compact.top, panel.top, t) - geometry.anchorY) * scale,
            x + (mix(compact.right, panel.right, t) - geometry.anchorX) * scale,
            y + (mix(compact.bottom, panel.bottom, t) - geometry.anchorY) * scale
        )
        val radius = minOf(style.corner * density * scale, body.height() / 2f)
        ink.style = Paint.Style.FILL
        ink.color = style.background
        ink.alpha = (255 * fade * style.opacity).roundToInt()
        canvas.drawRoundRect(body, radius, radius, ink)
        // A restrained, non-blue glass highlight gives the black surface depth.
        sheenMatrix.setScale(1f, body.height().coerceAtLeast(1f))
        sheenMatrix.postTranslate(0f, body.top)
        sheen.setLocalMatrix(sheenMatrix)
        ink.shader = sheen
        ink.alpha = (255 * fade * style.opacity).roundToInt()
        canvas.drawRoundRect(body, radius, radius, ink)
        ink.shader = null
        if (body.width() > dp(30) && fade > .01f) {
            ink.style = Paint.Style.STROKE
            ink.strokeWidth = density * .65f
            ink.color = Color.WHITE
            ink.alpha = (26 * fade).roundToInt()
            canvas.drawRoundRect(body.left + density, body.top + density,
                body.right - density, body.bottom - density,
                (radius - density).coerceAtLeast(0f), (radius - density).coerceAtLeast(0f), ink)
        }
        ink.style = Paint.Style.FILL
        if (press) {
            ink.color = Color.WHITE
            ink.alpha = (25 * fade).roundToInt()
            canvas.drawRoundRect(body, radius, radius, ink)
        }
        if (style.borderWidth > 0f) {
            ink.style = Paint.Style.STROKE
            ink.strokeWidth = style.borderWidth * density
            ink.color = style.border
            val pulse = if (moving && phase == "done" && elapsed in 0..550) (1f - elapsed / 550f) * 105 else 0f
            ink.alpha = ((mix(75f, 120f, t) + pulse) * fade).roundToInt().coerceIn(0, 255)
            canvas.drawRoundRect(body, radius, radius, ink)
        }
        val idleFace = moving && style.face && phase == "idle" && disappearance == 0f
        val idleTime = if (idleFace) elapsed % 10_800L else 0L
        if (style.face && t < .68f) drawFace(canvas, body.left + dp(21), body.centerY(),
            fade * scale * (1f - ease(.14f, .68f, t)), idleTime, if (moving) elapsed else -1)
        if (style.progress && phase in setOf("thinking", "executing")) {
            val width = body.width() * .28f
            val start = body.left + body.width() * if (moving) (.36f + .20f * kotlin.math.sin(time * 4f)) else .36f
            ink.style = Paint.Style.FILL
            ink.color = style.accent
            ink.alpha = (180 * fade).roundToInt()
            canvas.drawRoundRect(start, body.bottom - dp(4), start + width, body.bottom - dp(2), density, density, ink)
        }

        val compactAlpha = (1f - ease(.05f, .50f, t)) * (1f - ease(0f, .76f, disappearance))
        if (compactAlpha > .02f) {
            val cy = body.centerY()
            if (!style.face) signal.mark(canvas, body.left + body.width() * .23f, cy, compactAlpha)
            val sx = body.left + body.width() * .65f
            when (phase) {
                "done" -> signal.check(canvas, sx, cy, compactAlpha, if (moving) (elapsed / 250f).coerceIn(0f, 1f) else 1f)
                "listening", "thinking", "executing" -> signal.wave(canvas, if (activeStop) sx - dp(8) else sx, cy,
                    phase, time, level * exp((levelAt - now) / 240f), compactAlpha)
                else -> if (style.status && statusText.isNotBlank() && body.width() > dp(102)) {
                    ink.style = Paint.Style.FILL
                    ink.color = style.text
                    ink.alpha = (230 * compactAlpha).roundToInt()
                    ink.textSize = 10.5f * density
                    val caption = when (phase) {
                        "reminder" -> "Напоминание"
                        "error" -> "Ошибка"
                        "waiting" -> "Ваш шаг"
                        "stopped" -> "Остановлено"
                        else -> statusText.take(10)
                    }
                    canvas.drawText(caption, body.left + body.width() * .39f, cy - (ink.ascent() + ink.descent()) / 2, ink)
                } else {
                    if (!style.face && body.width() > dp(110)) {
                        ink.style = Paint.Style.FILL
                        ink.color = style.text
                        ink.alpha = (212 * compactAlpha).roundToInt()
                        ink.textSize = 10.5f * density
                        ink.typeface = wordmarkTypeface
                        canvas.drawText("CORTEX", body.left + body.width() * .385f,
                            cy - (ink.ascent() + ink.descent()) / 2f, ink)
                        ink.typeface = null
                    }
                    signal.dot(canvas, if (style.face) sx else body.left + body.width() * .86f, cy, compactAlpha)
                }
            }
            if (activeStop) {
                val stopX = body.right - dp(17)
                val r = 3.5f * density
                ink.style = Paint.Style.FILL
                ink.color = style.accent
                ink.alpha = (230 * compactAlpha).roundToInt()
                canvas.drawRoundRect(stopX - r, cy - r, stopX + r, cy + r, density, density, ink)
            }
        }
        if (moving && (phase in setOf("listening", "thinking", "executing") || phase == "done" && elapsed < 550L)) {
            postInvalidateDelayed(33L)
        } else if (idleFace) {
            val next = when {
                idleTime < 1750 -> 1750 - idleTime
                idleTime < 1980 -> 33L
                idleTime < 4710 -> 4710 - idleTime
                idleTime < 5530 -> 45L
                idleTime < 8250 -> 8250 - idleTime
                idleTime < 8490 -> 33L
                else -> 10_800L - idleTime + 1750
            }
            postInvalidateDelayed(next.coerceAtLeast(16L))
        }
    }

    private fun drawFace(canvas: Canvas, x: Float, y: Float, alpha: Float, idleTime: Long, elapsed: Long) {
        val unit = density * alpha.coerceAtLeast(.2f)
        val blink = maxOf(
            ease(1750f, 1850f, idleTime.toFloat()) * (1f - ease(1850f, 1980f, idleTime.toFloat())),
            ease(8250f, 8350f, idleTime.toFloat()) * (1f - ease(8350f, 8490f, idleTime.toFloat()))
        )
        val curiosity = ease(4710f, 4970f, idleTime.toFloat()) * (1f - ease(5200f, 5530f, idleTime.toFloat()))
        val glance = (curiosity * 1.3f - if (phase == "thinking") .6f else 0f) * unit
        val wink = if (phase == "done") ease(105f, 185f, elapsed.toFloat()) * (1f - ease(230f, 360f, elapsed.toFloat())) else 0f
        val eyeY = y - 1.9f * unit
        val eyeHeight = (if (phase == "listening") 1.36f else 1.04f) * (1f - .88f * blink) * unit
        ink.style = Paint.Style.FILL
        ink.color = style.faceColor
        ink.alpha = (230 * alpha).roundToInt()
        canvas.drawRoundRect(x - 8.8f * unit, y - 6.9f * unit, x + 8.8f * unit,
            y + 6.9f * unit, 5.8f * unit, 5.8f * unit, ink)
        ink.color = style.background
        ink.alpha = (255 * alpha).roundToInt()
        val left = x - 2.8f * unit + glance
        val right = x + 2.8f * unit + glance
        val rightEye = eyeHeight * (1f - .88f * wink)
        canvas.drawOval(left - unit, eyeY - eyeHeight, left + unit, eyeY + eyeHeight, ink)
        canvas.drawOval(right - unit, eyeY - rightEye, right + unit, eyeY + rightEye, ink)
        ink.style = Paint.Style.STROKE
        ink.strokeWidth = 1.1f * unit
        ink.strokeCap = Paint.Cap.ROUND
        when (phase) {
            "listening", "thinking" -> canvas.drawOval(x - 1.3f * unit, y + .6f * unit, x + 1.3f * unit, y + 3.5f * unit, ink)
            "error" -> canvas.drawArc(x - 3f * unit, y + 1.2f * unit, x + 3f * unit, y + 6f * unit, 207f, 126f, false, ink)
            "executing", "stopped", "waiting" -> canvas.drawLine(x - 2.2f * unit, y + 2.5f * unit, x + 2.2f * unit, y + 2.5f * unit, ink)
            else -> {
                val smile = (3.2f + curiosity * .8f + if (phase == "done") .8f else 0f) * unit
                canvas.drawArc(x - smile, y - unit, x + smile, y + 4.6f * unit, 20f, 140f, false, ink)
            }
        }
        ink.strokeCap = Paint.Cap.BUTT
    }

    override fun dispatchDraw(canvas: Canvas) {
        if (expansion < 1f || disappearance > 0f) {
            val radius = minOf(21 * density, body.height() / 2f)
            expandedClip.rewind()
            expandedClip.addRoundRect(body, radius, radius, android.graphics.Path.Direction.CW)
            val save = canvas.save()
            canvas.clipPath(expandedClip)
            super.dispatchDraw(canvas)
            canvas.restoreToCount(save)
        } else super.dispatchDraw(canvas)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_OUTSIDE -> {
                if (expansion > .20f) onDismiss()
                return true
            }
            MotionEvent.ACTION_DOWN -> {
                if (disappearance > 0f || expansion > .25f || !body.contains(event.x, event.y)) return false
                press = true
                if (haptics) performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                invalidate()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                press = false
                invalidate()
            }
        }
        return super.onTouchEvent(event)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (expansion > .8f && event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
            onDismiss()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onDetachedFromWindow() {
        cancelAnimation()
        super.onDetachedFromWindow()
    }

    private fun dp(value: Int) = (value * density).roundToInt()
    private fun mix(a: Float, b: Float, t: Float) = a + (b - a) * t
    private fun ease(from: Float, to: Float, value: Float): Float {
        val x = ((value - from) / (to - from)).coerceIn(0f, 1f)
        return x * x * (3f - 2f * x)
    }

    private companion object {
        val OPEN_CURVE = PathInterpolator(.12f, .78f, .22f, 1f)
        val CLOSE_CURVE = PathInterpolator(.24f, .02f, .22f, 1f)
    }
}
