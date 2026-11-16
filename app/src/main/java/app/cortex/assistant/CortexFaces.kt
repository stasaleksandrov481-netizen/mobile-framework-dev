package app.cortex.assistant

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ReplacementSpan
import kotlin.math.ceil

/** Native drawing of the same faces used in the WebView SVG set. */
internal object CortexFaces {
    private val possibleSymbols = Regex(
        """(?::face\[([a-z]{3,8})\]:|[#*0-9]\uFE0F?\u20E3|[\x{1F1E6}-\x{1F1FF}]{1,2}|(?:[\x{1F300}-\x{1FAFF}⌛⏳⚡⚠✔✖❌✅☑☹☺❤♥❗](?:[\uFE0E\uFE0F\x{1F3FB}-\x{1F3FF}\x{E0020}-\x{E007F}])*)(?:\u200D[\x{1F300}-\x{1FAFF}⚕♀♂✈][\uFE0E\uFE0F\x{1F3FB}-\x{1F3FF}]*)*)"""
    )
    private val labels = mapOf(
        "joy" to "Радость", "wait" to "Ожидание", "think" to "Размышление", "error" to "Ошибка",
        "surprise" to "Удивление", "work" to "Выполнение", "done" to "Готово", "listen" to "Слушаю", "neutral" to "Реакция"
    )
    private val shortcode = Regex(""":(?:face|icon)\[[a-z]{2,16}\]:""")
    private val joy = setOf(0x263A, 0x2764, 0x2665, 0x1F44D, 0x1F389, 0x1F970, 0x1F973, 0x2728, 0x1F642)
    private val error = setOf(0x26A0, 0x274C, 0x2639, 0x1F61E, 0x1F622, 0x1F62D)
    private val surprise = setOf(0x2757, 0x1F62E, 0x1F62F, 0x1F632, 0x1F633, 0x1F92F)

    fun speechText(text: String): String = possibleSymbols.replace(shortcode.replace(text, ""), "").trim()

    fun applyTo(text: SpannableStringBuilder) {
        for (match in possibleSymbols.findAll(text.toString()).toList().asReversed()) {
            val named = match.groupValues[1]
            val kind = when {
                named.isEmpty() -> classify(match.value.codePointAt(0))
                named in labels -> named
                else -> continue
            }
            val start = match.range.first
            text.replace(start, match.range.last + 1, "\uFFFC")
            val span = FaceSpan(kind)
            if (Build.VERSION.SDK_INT >= 30) span.contentDescription = labels.getValue(kind)
            text.setSpan(span, start, start + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }

    private fun classify(code: Int) = when (code) {
        in 0x1F600..0x1F609, 0x1F60A, in joy -> "joy"
        0x2705, 0x2714, 0x2611, 0x1F44C -> "done"
        in error -> "error"
        in surprise -> "surprise"
        0x1F914, 0x1F4AD, 0x1F4A1 -> "think"
        0x231B, 0x23F3 -> "wait"
        0x26A1, 0x1F525, 0x1F680 -> "work"
        0x1F399, 0x1F3A4, 0x1F442 -> "listen"
        else -> "neutral"
    }

    private class FaceSpan(private val kind: String) : ReplacementSpan() {
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG)
        private val path = Path()

        override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int =
            ceil(paint.textSize * 1.18f).toInt()

        override fun draw(canvas: Canvas, text: CharSequence, start: Int, end: Int,
                          x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
            val size = paint.textSize
            val saved = canvas.save()
            canvas.translate(x + size * .09f, y + paint.ascent() * .95f)
            canvas.scale(size / 24, size / 24)
            stroke.color = paint.color
            stroke.style = Paint.Style.STROKE
            stroke.strokeWidth = 1.65f
            stroke.strokeCap = Paint.Cap.ROUND
            stroke.strokeJoin = Paint.Join.ROUND

            fun line(vararg points: Float) {
                path.rewind()
                path.moveTo(points[0], points[1])
                for (i in 2 until points.size step 2) path.lineTo(points[i], points[i + 1])
                canvas.drawPath(path, stroke)
            }
            fun eyes(height: Float = 2f) {
                line(8f, 10f, 8f, 10f + height)
                line(16f, 10f, 16f, 10f + height)
            }

            canvas.drawRoundRect(2.75f, 4.75f, 21.25f, 19.25f, 6f, 6f, stroke)
            line(10.5f, 3f, 13.5f, 3f)
            when (kind) {
                "joy" -> {
                    line(6f, 11f, 8f, 9f, 10f, 11f)
                    line(14f, 11f, 16f, 9f, 18f, 11f)
                    canvas.drawArc(8.5f, 10f, 15.5f, 16.5f, 26f, 128f, false, stroke)
                }
                "error" -> {
                    for (left in listOf(6.5f, 14.5f)) {
                        line(left, 9f, left + 3f, 12f)
                        line(left + 3f, 9f, left, 12f)
                    }
                    line(10f, 16f, 14f, 16f)
                }
                "think" -> { line(7f, 10f, 9f, 10f); line(15f, 12f, 17f, 12f); line(10f, 16f, 13f, 16f) }
                "wait" -> { line(7f, 11f, 9f, 11f); line(15f, 11f, 17f, 11f); line(9.5f, 15f, 14.5f, 15f) }
                "surprise" -> { eyes(3f); canvas.drawCircle(12f, 15.5f, 1.5f, stroke) }
                "work" -> { line(13f, 7f, 10f, 12f, 14f, 12f, 11f, 17f); line(6.5f, 12f, 6.6f, 12f); line(17.5f, 12f, 17.6f, 12f) }
                "done" -> line(7.5f, 12.2f, 10.5f, 15.2f, 16.5f, 9.2f)
                "listen" -> { line(7f, 12f, 7f, 13f); line(10f, 10f, 10f, 15f); line(14f, 8f, 14f, 17f); line(17f, 11f, 17f, 14f) }
                else -> { eyes(); line(10f, 15f, 14f, 15f) }
            }
            canvas.restoreToCount(saved)
        }
    }
}
