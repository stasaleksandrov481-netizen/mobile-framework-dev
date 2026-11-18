package app.cortex.assistant

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import androidx.core.graphics.ColorUtils

/** Translucent tint with static highlights in view coordinates. No screen capture or GPU-wide blur. */
internal class IslandGlass(private val density: Float) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val inner = RectF()
    private val compact = Material()
    private val expanded = Material()

    fun draw(canvas: Canvas, shape: RectF, radius: Float, alpha: Float, style: IslandAppearance, panel: Boolean) {
        if (alpha <= .01f || shape.isEmpty) return
        val material = if (panel) expanded else compact
        material.update(shape, style.background)
        paint.style = Paint.Style.FILL
        paint.color = Color.WHITE
        val opacity = (255 * alpha * style.opacity).toInt()
        paint.alpha = opacity
        paint.shader = material.tint
        canvas.drawRoundRect(shape, radius, radius, paint)
        paint.shader = material.light
        paint.alpha = (opacity * .78f).toInt()
        canvas.drawRoundRect(shape, radius, radius, paint)
        if (style.borderWidth <= 0f) {
            paint.shader = null
            return
        }
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = density * (.55f + style.borderWidth * .57f)
        paint.shader = material.edge
        paint.alpha = (255 * alpha * .89f).toInt()
        canvas.drawRoundRect(shape, radius, radius, paint)
        inner.set(shape)
        inner.inset(density * 1.65f, density * 1.65f)
        paint.shader = null
        paint.color = style.border
        paint.alpha = (23 * alpha).toInt()
        paint.strokeWidth = density * .55f
        val insetRadius = (radius - density * 1.65f).coerceAtLeast(0f)
        canvas.drawRoundRect(inner, insetRadius, insetRadius, paint)
    }

    private class Material {
        private val bounds = RectF()
        private var color = Color.TRANSPARENT
        var tint: Shader? = null
            private set
        var light: Shader? = null
            private set
        var edge: Shader? = null
            private set

        fun update(shape: RectF, tintColor: Int) {
            if (bounds == shape && color == tintColor && tint != null) return
            bounds.set(shape)
            color = tintColor
            fun tone(target: Int, ratio: Float, alpha: Int) =
                ColorUtils.setAlphaComponent(ColorUtils.blendARGB(tintColor, target, ratio), alpha)
            tint = LinearGradient(shape.left, shape.top, shape.right, shape.bottom, intArrayOf(
                tone(Color.WHITE, .24f, 226), tone(Color.BLACK, .42f, 239),
                tone(Color.BLACK, .68f, 232), tone(Color.WHITE, .09f, 218)
            ), floatArrayOf(0f, .32f, .75f, 1f), Shader.TileMode.CLAMP)
            light = LinearGradient(shape.left, shape.top, shape.right, shape.centerY(), intArrayOf(
                0x56FFFFFF.toInt(), 0x13FFFFFF, 0x04FFFFFF, 0x19C2DCFF
            ), floatArrayOf(0f, .22f, .57f, 1f), Shader.TileMode.CLAMP)
            edge = LinearGradient(shape.left, shape.top, shape.right, shape.bottom, intArrayOf(
                0xD3FFFFFF.toInt(), 0x4DFFFFFF, 0x25BAE1FF, 0x9BFFFFFF.toInt()
            ), floatArrayOf(0f, .32f, .68f, 1f), Shader.TileMode.CLAMP)
        }
    }
}
