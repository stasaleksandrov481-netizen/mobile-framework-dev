package app.cortex.assistant

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Region
import android.os.Build
import android.os.SystemClock
import android.text.TextPaint
import android.text.TextUtils
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewTreeObserver
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.roundToInt
import kotlin.math.sin

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
    private val compactBody = RectF()
    private val box = Rect()
    private val touchBox = Rect()
    private val appliedTouchRegion = Rect()
    private val touchRegion = Region()
    private val location = IntArray(2)
    private val laidOutAt = IntArray(2)
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG)
    private val traceOutline = Path()
    private val traceSegment = Path()
    private val traceMeasure = PathMeasure()
    private val traceBounds = RectF()
    private val measuredTraceBounds = RectF()
    private var measuredTraceRadius = -1f
    private val statusPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private var fittedStatus = ""
    private var fittedLabel = ""
    private var fittedWidth = -1f
    private val signal = IslandSignal(density)
    private val glass = IslandGlass(density)
    private val mascot = IslandMascot(density)
    private val power by lazy { context.getSystemService(android.os.PowerManager::class.java) }
    private val mascotClock = IslandMascotClock(SystemClock.uptimeMillis())
    private val mascotClip = Path()
    private var mascotWakeAt = 0L
    private val wakeMascot = Runnable { mascotWakeAt = 0L; invalidate() }
    private var placement: IslandPlacement? = null
    private var animator: ValueAnimator? = null
    private var expansion = 0f
    private var disappearance = 0f
    private var motion = true
    private var phase = "idle"
    private var phaseStartedAt = SystemClock.uptimeMillis()
    private var style = IslandAppearance.parse()
    private var level = 0f
    private var levelAt = 0L
    private var audioFrameAt = 0L
    private var press = false
    private var activeStop = false
    private var demonstration = false
    private var statusLabel = ""
    private var experiencePulseAt = 0L
    private var pendingPlacementListener: ViewTreeObserver.OnPreDrawListener? = null
    private var pendingPlacementTimeout: Runnable? = null
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
        addView(stop, LayoutParams(dp(26), dp(36)))
        setContents()
    }

    fun place(value: IslandPlacement, frame: Rect, touchFrame: Rect) {
        if (touchFrame != touchBox) {
            touchBox.set(touchFrame)
            updateTouchRegion()
        }
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

    fun phase(value: String, message: String, canStop: Boolean, demo: Boolean = false) {
        if (phase != value) phaseStartedAt = SystemClock.uptimeMillis()
        phase = value
        activeStop = canStop
        demonstration = demo
        statusLabel = message
        val description = if (message.isBlank()) "Островок CORTEX. Ввести команду." else "CORTEX. $message"
        if (contentDescription != description) contentDescription = description
        setContents()
    }

    fun experiencePulse() {
        experiencePulseAt = SystemClock.uptimeMillis()
        invalidate()
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
        return point.x >= touchBox.left && point.x < touchBox.right &&
            point.y >= touchBox.top && point.y < touchBox.bottom
    }

    fun reduceMotion(reduced: Boolean) {
        val enabled = !reduced && ValueAnimator.areAnimatorsEnabled()
        if (motion == enabled) return
        motion = enabled
        conversation.animateSignal(motion)
        invalidate()
    }

    /** Starts the morph after WindowManager has applied the new overlay frame.
     *
     * A one-frame post alone is racy on some devices: the view is still measured
     * with its previous (compact) dimensions. This wait is cancelable when the
     * user reverses the gesture. A short fallback prevents getting stuck if an
     * OEM fails to dispatch a pre-draw after updateViewLayout.
     */
    fun whenWindowReady(expected: Rect, ready: () -> Unit) {
        cancelPlacementWait()
        fun matches(): Boolean {
            if (!isAttachedToWindow || width != expected.width() || height != expected.height()) return false
            getLocationOnScreen(location)
            return kotlin.math.abs(location[0] - expected.left) <= 1 &&
                kotlin.math.abs(location[1] - expected.top) <= 1
        }
        if (matches()) {
            postOnAnimation { ready() }
            return
        }
        val listener = object : ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                if (matches()) {
                    cancelPlacementWait()
                    postOnAnimation { ready() }
                }
                return true
            }
        }
        pendingPlacementListener = listener
        viewTreeObserver.addOnPreDrawListener(listener)
        pendingPlacementTimeout = Runnable {
            cancelPlacementWait()
            ready()
        }.also { postDelayed(it, 260L) }
    }

    fun cancelPlacementWait() {
        pendingPlacementListener?.let {
            if (viewTreeObserver.isAlive) viewTreeObserver.removeOnPreDrawListener(it)
        }
        pendingPlacementListener = null
        pendingPlacementTimeout?.let(::removeCallbacks)
        pendingPlacementTimeout = null
    }

    fun expand(open: Boolean, done: () -> Unit) {
        val start = expansion
        val faded = disappearance
        val end = if (open) 1f else 0f
        val duration = ((if (style.motion == "soft") 280 else if (open) 360 else 320) * abs(start - end))
            .toLong().coerceAtLeast(42L)
        animate(duration, if (open) OPEN_CURVE else CLOSE_CURVE, {
            expansion = mix(start, end, it)
            disappearance = mix(faded, 0f, it)
        }, done)
    }

    fun disappear(power: Boolean, done: () -> Unit) {
        val start = expansion
        val faded = disappearance
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
        val appear = ease(.34f, .96f, expansion) * (1f - ease(0f, .65f, disappearance))
        conversation.alpha = appear
        conversation.visibility = if (appear > .03f) VISIBLE else INVISIBLE
        val interactive = appear > .9f && disappearance == 0f
        conversation.importantForAccessibility =
            if (interactive) IMPORTANT_FOR_ACCESSIBILITY_AUTO else IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        stop.visibility = if (activeStop && expansion < .025f && disappearance == 0f) VISIBLE else INVISIBLE
        importantForAccessibility = if (interactive) IMPORTANT_FOR_ACCESSIBILITY_NO else IMPORTANT_FOR_ACCESSIBILITY_YES
        invalidate()
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        val geometry = placement ?: return
        // WindowManager positions overlays asynchronously. Actual screen coordinates
        // are authoritative; the requested frame may already have changed while the
        // window itself is still at the old position.
        readOrigin()
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
        stop.layout((compact.right - location[0] - dp(26)).roundToInt(), (compact.top - location[1]).roundToInt(),
            (compact.right - location[0]).roundToInt(), (compact.bottom - location[1]).roundToInt())
    }

    // Keep the surface size and position stable while the capsule morphs.
    // Only the part of the surface that contains the island handles touch.
    private fun updateTouchRegion() {
        if (Build.VERSION.SDK_INT < 33 || !isAttachedToWindow || touchBox.isEmpty) return
        val surface = rootSurfaceControl ?: return
        getLocationOnScreen(location)
        val left = touchBox.left - location[0]
        val top = touchBox.top - location[1]
        val right = touchBox.right - location[0]
        val bottom = touchBox.bottom - location[1]
        if (appliedTouchRegion.left == left && appliedTouchRegion.top == top &&
            appliedTouchRegion.right == right && appliedTouchRegion.bottom == bottom) return
        appliedTouchRegion.set(left, top, right, bottom)
        touchRegion.set(appliedTouchRegion)
        surface.setTouchableRegion(touchRegion)
    }

    private fun readOrigin() {
        if (Build.VERSION.SDK_INT >= 33) {
            // Keep drawing and child layout in one stable local coordinate system.
            location[0] = box.left
            location[1] = box.top
        } else getLocationOnScreen(location)
    }

    private fun drawShell(canvas: Canvas, shape: RectF, visibility: Float, radius: Float, panel: Boolean) {
        if (visibility <= .01f) return
        if (style.glass) {
            glass.draw(canvas, shape, radius, visibility, style, panel)
            return
        }
        ink.style = Paint.Style.FILL
        ink.color = style.background
        ink.alpha = (255 * visibility * style.opacity).roundToInt()
        canvas.drawRoundRect(shape, radius, radius, ink)
        if (style.borderWidth > 0f) {
            ink.style = Paint.Style.STROKE
            ink.strokeWidth = style.borderWidth * density
            ink.color = style.border
            ink.alpha = (48 * visibility).roundToInt()
            canvas.drawRoundRect(shape, radius, radius, ink)
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        updateTouchRegion()
        val geometry = placement ?: return
        val now = SystemClock.uptimeMillis()
        val moving = motion && isShown && windowVisibility == VISIBLE
        val time = if (moving) (now % 240_000L) / 1000f else 0f
        val compact = geometry.compact
        val panel = geometry.panel
        val fade = 1f - ease(0f, 1f, disappearance)
        val panelAlpha = ease(.18f, .89f, expansion) * fade
        val compactAlpha = (1f - ease(.09f, .66f, expansion)) * fade
        readOrigin()
        if (Build.VERSION.SDK_INT < 33) {
            val shiftX = (laidOutAt[0] - location[0]).toFloat()
            val shiftY = (laidOutAt[1] - location[1]).toFloat()
            if (conversation.translationX != shiftX || conversation.translationY != shiftY) {
                conversation.translationX = shiftX
                conversation.translationY = shiftY
                stop.translationX = shiftX
                stop.translationY = shiftY
            }
        }
        body.set(panel)
        body.offset(-location[0].toFloat(), -location[1].toFloat())
        compactBody.set(compact)
        compactBody.offset(-location[0].toFloat(), -location[1].toFloat())
        drawShell(canvas, body, panelAlpha, minOf(style.corner * density, body.height() / 2f), panel = true)
        val radius = minOf(style.corner * density, compactBody.height() / 2f)
        drawShell(canvas, compactBody, compactAlpha, radius, panel = false)
        val elapsed = now - experiencePulseAt
        if (demonstration && motion && experiencePulseAt > 0 && elapsed in 0..720) {
            ink.style = Paint.Style.STROKE
            ink.strokeWidth = 1.4f * density
            ink.color = Color.WHITE
            ink.alpha = (100 * (1f - elapsed / 720f)).roundToInt()
            canvas.drawRoundRect(compactBody, radius, radius, ink)
            postInvalidateOnAnimation()
        }
        if (press && compactAlpha > .01f) {
            ink.style = Paint.Style.FILL
            ink.color = Color.WHITE
            ink.alpha = (20 * compactAlpha).roundToInt()
            canvas.drawRoundRect(compactBody, radius, radius, ink)
        }
        if (style.progress && compactAlpha > .02f && disappearance == 0f) drawTrace(canvas, now, radius, compactAlpha)
        val decoration = mascotFrame(now, moving)
        if (demonstration && compactAlpha > .02f) {
            ink.style = Paint.Style.FILL
            ink.color = Color.WHITE
            ink.alpha = (240 * compactAlpha).roundToInt()
            ink.textSize = 12f * density
            val available = (compactBody.width() - dp(48)).coerceAtLeast(1f)
            if (fittedLabel != statusLabel || fittedWidth != available) {
                fittedLabel = statusLabel
                fittedWidth = available
                statusPaint.set(ink)
                fittedStatus = TextUtils.ellipsize(statusLabel, statusPaint, available, TextUtils.TruncateAt.END).toString()
            }
            canvas.drawText(fittedStatus, compactBody.left + dp(15), compactBody.centerY() - (ink.ascent() + ink.descent()) / 2f, ink)
            if (activeStop) {
                val x = compactBody.right - dp(14)
                val y = compactBody.centerY()
                canvas.drawRoundRect(x - dp(3), y - dp(3), x + dp(3), y + dp(3), density, density, ink)
            }
        } else if (decoration != null && compactAlpha > .02f) {
            mascotClip.rewind()
            mascotClip.addRoundRect(compactBody, radius, radius, Path.Direction.CW)
            val save = canvas.save()
            canvas.clipPath(mascotClip)
            mascot.draw(canvas, compactBody, radius, decoration, style, compactAlpha)
            canvas.restoreToCount(save)
            postInvalidateDelayed(32L)
        } else if (compactAlpha > .02f) {
            val showStatus = style.status && phase == "executing"
            val cy = compactBody.centerY() - if (showStatus) 5f * density else 0f
            val active = style.progress && isActivePhase()
            val pulse = if (moving) (sin(time * if (active) 5f else 1.75f) + 1f) * .5f else .5f
            val logoX = compactBody.centerX() - if (activeStop) dp(7).toFloat() else 0f
            val voice = if (phase == "listening") level * exp((levelAt - now) / 240f) else 0f
            val logoScale = .95f + .10f * pulse + .14f * voice
            canvas.save()
            canvas.scale(logoScale, logoScale, logoX, cy)
            if (style.face) drawCompactFace(canvas, logoX, cy, compactAlpha)
            else signal.mark(canvas, logoX, cy, compactAlpha * (.77f + pulse * .23f))
            canvas.restore()
            if (showStatus) {
                ink.style = Paint.Style.FILL
                ink.color = style.text
                ink.alpha = (232 * compactAlpha).roundToInt()
                ink.textSize = 8.5f * density
                ink.textAlign = Paint.Align.CENTER
                canvas.drawText("Выполняю", compactBody.centerX(), compactBody.bottom - 4 * density, ink)
                ink.textAlign = Paint.Align.LEFT
            }
            if (activeStop) {
                // A real stop control remains available during a long action.
                val stopX = compactBody.right - dp(13)
                val r = 2.7f * density
                ink.style = Paint.Style.FILL
                ink.color = style.accent
                ink.alpha = (170 * compactAlpha).roundToInt()
                canvas.drawRoundRect(stopX - r, cy - r, stopX + r, cy + r, density, density, ink)
            }
        }
        if (moving && compactAlpha > .02f && disappearance == 0f && isActivePhase()) {
            // Follow the display's frame clock instead of imposing a visibly choppy ~20 Hz timer.
            postInvalidateOnAnimation()
        }
    }

    private fun mascotFrame(now: Long, visible: Boolean): IslandMascotClock.Frame? {
        val eligible = visible && style.mascot && phase == "idle" && !press && !activeStop &&
            expansion == 0f && disappearance == 0f && animator == null && power.isInteractive
        val frame = mascotClock.frame(now, eligible)
        val wakeAt = if (eligible && frame == null) mascotClock.nextAt else 0L
        if (wakeAt != mascotWakeAt) {
            removeCallbacks(wakeMascot)
            mascotWakeAt = wakeAt
            if (wakeAt > now) postDelayed(wakeMascot, wakeAt - now)
        }
        return frame
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == VISIBLE) invalidate()
        else {
            removeCallbacks(wakeMascot)
            mascotWakeAt = 0L
            mascotClock.frame(SystemClock.uptimeMillis(), false)
        }
    }

    private fun drawCompactFace(canvas: Canvas, x: Float, y: Float, alpha: Float) {
        ink.style = Paint.Style.FILL
        ink.color = style.faceColor
        ink.alpha = (255 * alpha).roundToInt()
        canvas.drawRoundRect(x - 7.7f * density, y - 7.4f * density, x + 7.7f * density, y + 7.4f * density,
            5.5f * density, 5.5f * density, ink)
        ink.color = if (androidx.core.graphics.ColorUtils.calculateLuminance(style.faceColor) > .42)
            0xFF172331.toInt() else Color.WHITE
        ink.alpha = (255 * alpha).roundToInt()
        canvas.drawCircle(x - 2.25f * density, y - 1.3f * density, density, ink)
        canvas.drawCircle(x + 2.25f * density, y - 1.3f * density, density, ink)
        ink.style = Paint.Style.STROKE
        ink.strokeWidth = density
        canvas.drawArc(x - 2.5f * density, y - .3f * density, x + 2.5f * density,
            y + 3.5f * density, 18f, 144f, false, ink)
    }

    /** One quiet light trace follows the compact capsule perimeter.
     * Unlike a spinner, it disappears in idle and uses the chosen island accent.
     * Reduce Motion disables it entirely, including when Voice is active.
     */
    private fun drawTrace(canvas: Canvas, now: Long, radius: Float, alpha: Float) {
        if (!motion || !style.progress || !isActivePhase() || compactBody.width() < 18f * density) return
        val inset = 1.8f * density
        traceBounds.set(compactBody.left + inset, compactBody.top + inset, compactBody.right - inset, compactBody.bottom - inset)
        val arc = (radius - inset).coerceAtLeast(0f)
        if (measuredTraceBounds != traceBounds || measuredTraceRadius != arc) {
            measuredTraceBounds.set(traceBounds)
            measuredTraceRadius = arc
            traceOutline.rewind()
            traceOutline.addRoundRect(traceBounds, arc, arc, Path.Direction.CW)
            traceMeasure.setPath(traceOutline, true)
        }
        val total = traceMeasure.length
        if (total <= 0f) return
        val elapsed = ((now - phaseStartedAt).coerceAtLeast(0L) % 200_000L) / 1000f
        val speed = when (phase) { "listening" -> .19f; "thinking" -> .13f; else -> .16f }
        val span = when (phase) { "listening" -> .14f; "thinking" -> .19f; else -> .25f }
        val start = total * ((elapsed * speed) % 1f)
        val end = start + total * span
        traceSegment.rewind()
        traceMeasure.getSegment(start, minOf(end, total), traceSegment, true)
        if (end > total) traceMeasure.getSegment(0f, end - total, traceSegment, true)
        val voice = if (phase == "listening") level * exp((levelAt - now) / 240f) else 0f
        val strength = (1f + voice * .42f).coerceIn(1f, 1.42f)
        ink.style = Paint.Style.STROKE
        ink.strokeCap = Paint.Cap.ROUND
        ink.color = style.accent
        ink.strokeWidth = 3.4f * density
        ink.alpha = (28f * alpha * strength).roundToInt().coerceIn(0, 255)
        canvas.drawPath(traceSegment, ink)
        ink.strokeWidth = 1.25f * density
        ink.alpha = (165f * alpha * strength).roundToInt().coerceIn(0, 255)
        canvas.drawPath(traceSegment, ink)
        ink.strokeCap = Paint.Cap.BUTT
    }

    private fun isActivePhase() = phase == "listening" || phase == "thinking" || phase == "executing"

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_OUTSIDE -> {
                if (expansion > .20f) onDismiss()
                return true
            }
            MotionEvent.ACTION_DOWN -> {
                if (disappearance > 0f || expansion > .25f || !compactBody.contains(event.x, event.y)) return false
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
        cancelPlacementWait()
        cancelAnimation()
        appliedTouchRegion.setEmpty()
        removeCallbacks(wakeMascot)
        mascotWakeAt = 0L
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
