package app.cortex.assistant

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.RectF
import androidx.core.graphics.ColorUtils
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

internal enum class IslandScene(val duration: Long) {
    WALK(3_800L), BOUNCE(2_700L), THINK(3_300L), KNOCK(2_900L), DRIVE(5_000L)
}

/** A decoration never keeps an idle island rendering frames. */
internal class IslandMascotClock(now: Long) {
    data class Frame(val scene: IslandScene, val progress: Float)
    var nextAt = now + INTERVAL_MS
        private set
    private var current: IslandScene? = null
    private var startedAt = 0L
    private var nextScene = 0

    fun frame(now: Long, eligible: Boolean): Frame? {
        if (!eligible) {
            if (current != null) end(now)
            return null
        }
        val active = current
        if (active != null) {
            if (now - startedAt < active.duration) return Frame(active, (now - startedAt) / active.duration.toFloat())
            end(startedAt + active.duration)
        }
        if (now < nextAt) return null
        val scene = IslandScene.entries[nextScene]
        nextScene = (nextScene + 1) % IslandScene.entries.size
        current = scene
        startedAt = now
        return Frame(scene, 0f)
    }

    private fun end(now: Long) {
        current = null
        nextAt = now + INTERVAL_MS
    }

    companion object { const val INTERVAL_MS = 180_000L }
}

internal class IslandMascot(private val density: Float) {
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val path = Path()
    private val perimeter = Path()
    private val contour = RectF()
    private val measure = PathMeasure()
    private val position = FloatArray(2)
    private val lastShape = RectF()
    private var foreground = Color.WHITE
    private var detail = Color.BLACK
    private var tint = Color.WHITE
    private var alpha = 1f

    fun draw(canvas: Canvas, bounds: RectF, radius: Float, frame: IslandMascotClock.Frame, style: IslandAppearance, opacity: Float) {
        foreground = style.faceColor
        detail = if (ColorUtils.calculateLuminance(foreground) > .42) 0xFF172331.toInt() else Color.WHITE
        tint = ColorUtils.blendARGB(style.accent, foreground, .30f)
        alpha = opacity
        val t = frame.progress
        val unit = minOf(density, bounds.height() / 32f)
        canvas.save()
        canvas.translate(bounds.centerX(), bounds.centerY())
        canvas.scale(unit, unit)
        val halfWidth = bounds.width() / (2f * unit)
        val halfHeight = bounds.height() / (2f * unit)
        when (frame.scene) {
            IslandScene.WALK -> walk(canvas, t, halfWidth, halfHeight, radius / unit)
            IslandScene.BOUNCE -> bounce(canvas, t)
            IslandScene.THINK -> think(canvas, t)
            IslandScene.KNOCK -> knock(canvas, t)
            IslandScene.DRIVE -> drive(canvas, t, halfWidth)
        }
        canvas.restore()
    }

    private fun walk(canvas: Canvas, t: Float, w: Float, h: Float, corner: Float) {
        val appearance = ramp(.03f, .20f, t) * (1f - ramp(.79f, .99f, t))
        if (appearance < 1f) face(canvas, 0f, 0f, 1f + .13f * wave(t * 2f), 1f - appearance)
        contour.set(-w + 10f, -h + 8f, w - 10f, h - 8f)
        if (lastShape != contour) {
            lastShape.set(contour)
            perimeter.rewind()
            val r = minOf(corner, contour.height() / 2f)
            perimeter.addRoundRect(contour, r, r, Path.Direction.CW)
            measure.setPath(perimeter, true)
        }
        val travel = ramp(.11f, .88f, t)
        if (!measure.getPosTan(travel * measure.length, position, null)) return
        val stride = wave(travel * 10f) * 3.1f
        val x = position[0]
        val y = position[1] - abs(stride) * .28f
        pen(foreground, appearance)
        canvas.drawCircle(x, y - 4.6f, 2.55f, ink)
        pen(foreground, appearance, 2.2f)
        canvas.drawLine(x, y - .7f, x, y + 4.1f, ink)
        canvas.drawLine(x, y + .5f, x + 3.8f, y + 2.4f - stride * .48f, ink)
        canvas.drawLine(x, y + .9f, x - 3.5f, y + 2.7f + stride * .42f, ink)
        canvas.drawLine(x, y + 3.8f, x - stride, y + 7f, ink)
        canvas.drawLine(x, y + 3.8f, x + stride, y + 7f, ink)
        sparkle(canvas, x - 5f, y + 1f, 1.5f, appearance * (1f - abs(stride) / 3.1f))
    }

    private fun bounce(canvas: Canvas, t: Float) {
        val activity = ramp(.03f, .18f, t) * (1f - ramp(.81f, 1f, t))
        val jump = abs(wave(t * 2.2f)) * activity
        val x = wave(t) * 8f * activity
        face(canvas, x, -6.2f * jump, 1f + .12f * activity - .16f * jump, 1f, happy = true)
        sparkle(canvas, x - 14f, -2f - jump * 4f, 2.8f, activity)
        sparkle(canvas, x + 14f, 2f - jump * 4f, 1.9f, activity * .8f)
    }

    private fun think(canvas: Canvas, t: Float) {
        val thought = ramp(.07f, .25f, t) * (1f - ramp(.78f, 1f, t))
        face(canvas, -6f * thought, 0f, 1f, 1f, thoughtful = thought)
        for (i in 0..2) {
            val look = .45f + .55f * abs(wave(t * 1.4f - i * .16f))
            pen(tint, look * thought)
            canvas.drawCircle(5.5f + i * 4.6f, -7.4f - i * 1.8f, 1.05f + i * .18f, ink)
        }
    }

    private fun knock(canvas: Canvas, t: Float) {
        val reach = ramp(.12f, .31f, t) * (1f - ramp(.72f, .98f, t))
        face(canvas, -5f * reach, 0f, 1f, 1f)
        val strike = abs(wave((t - .32f) * 3.5f))
        val x = 7f + 5f * reach
        pen(foreground, reach, 2.25f)
        canvas.drawLine(0f, 3f, x - 2f, .1f - 3.7f * strike, ink)
        pen(foreground, reach)
        canvas.drawRoundRect(x - 2.2f, -4.5f - 3f * strike, x + 2.2f, -.1f - 3f * strike, 1.7f, 1.7f, ink)
        for (i in 0..1) {
            val ring = (t - .40f - i * .18f) / .22f
            if (ring in 0f..1f) {
                pen(tint, (1f - ring) * .65f, .9f)
                canvas.drawCircle(x + 1f, -3f, 2.4f + ring * 6.7f, ink)
            }
        }
    }

    private fun drive(canvas: Canvas, t: Float, halfWidth: Float) {
        val morph = ramp(.01f, .21f, t)
        val returnFace = ramp(.86f, 1f, t)
        val leaving = ramp(.21f, .58f, t)
        if (t < .21f || t > .86f) face(canvas, 0f, 0f, 1f, maxOf(1f - morph, returnFace))
        if (leaving >= 1f) return
        val x = leaving * (halfWidth + 15f)
        pen(tint, morph * leaving * .7f, 1.1f)
        canvas.drawLine(x - 19f, 1.6f, x - 11f, 1.6f, ink)
        canvas.drawLine(x - 16f, -2.1f, x - 12f, -2.1f, ink)
        canvas.save()
        canvas.translate(x, 1f)
        canvas.scale(.58f + .42f * morph, .58f + .42f * morph)
        pen(foreground, morph)
        canvas.drawRoundRect(-10f, -2.4f, 10f, 4.5f, 2.9f, 2.9f, ink)
        path.rewind()
        path.moveTo(-6.5f, -1.7f)
        path.quadTo(-5.8f, -7f, -1.7f, -7f)
        path.lineTo(2.2f, -7f)
        path.quadTo(5.1f, -6.3f, 6.5f, -1.7f)
        path.close()
        canvas.drawPath(path, ink)
        pen(detail, morph * .78f)
        canvas.drawRoundRect(-3.7f, -5.5f, 3.5f, -2.4f, .8f, .8f, ink)
        for (wheel in floatArrayOf(-6.3f, 6.3f)) {
            pen(detail, morph)
            canvas.drawCircle(wheel, 4.4f, 2.3f, ink)
            pen(tint, morph, .95f)
            val spin = wave(t * 21f)
            canvas.drawLine(wheel - spin * 1.4f, 3.6f, wheel + spin * 1.4f, 5.2f, ink)
        }
        pen(0xFFFFDEA4.toInt(), morph)
        canvas.drawRoundRect(7.7f, -.9f, 9.5f, .45f, .55f, .55f, ink)
        canvas.restore()
    }

    private fun face(canvas: Canvas, x: Float, y: Float, size: Float, opacity: Float, happy: Boolean = false, thoughtful: Float = 0f) {
        if (opacity <= .01f) return
        canvas.save()
        canvas.translate(x, y)
        canvas.scale(size, size)
        pen(foreground, opacity)
        canvas.drawRoundRect(-7.7f, -7.4f, 7.7f, 7.4f, 5.5f, 5.5f, ink)
        pen(detail, opacity, 1.2f)
        for (eye in floatArrayOf(-2.65f, 2.65f)) {
            if (happy) canvas.drawArc(eye - 1.1f, -3.1f, eye + 1.1f, -.3f, 195f, 150f, false, ink)
            else canvas.drawLine(eye + thoughtful * .85f, -2.5f, eye + thoughtful * .85f, -1.2f, ink)
        }
        if (thoughtful > .6f) canvas.drawLine(-.8f, 2.4f, 1.4f, 2.6f, ink)
        else canvas.drawArc(-2.4f, -.3f, 2.4f, 4.3f, 16f, 148f, false, ink)
        canvas.restore()
    }

    private fun sparkle(canvas: Canvas, x: Float, y: Float, size: Float, opacity: Float) {
        pen(tint, opacity, 1.2f)
        canvas.drawLine(x - size, y, x + size, y, ink)
        canvas.drawLine(x, y - size, x, y + size, ink)
    }

    private fun pen(color: Int, opacity: Float, stroke: Float = 0f) {
        ink.color = color
        ink.alpha = (alpha * opacity * 255).toInt().coerceIn(0, 255)
        ink.style = if (stroke == 0f) Paint.Style.FILL else Paint.Style.STROKE
        ink.strokeWidth = stroke
    }

    private fun wave(cycles: Float): Float = sin(cycles * 2f * PI.toFloat())
    private fun ramp(from: Float, to: Float, value: Float): Float {
        val t = ((value - from) / (to - from)).coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }
}
