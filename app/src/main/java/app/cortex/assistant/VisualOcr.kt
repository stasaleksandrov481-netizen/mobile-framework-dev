package app.cortex.assistant

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.view.Display
import androidx.annotation.RequiresApi
import com.googlecode.tesseract.android.TessBaseAPI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume

internal data class OcrResult(val nodes: List<VisualNode> = emptyList(), val protected: Boolean = false)

@RequiresApi(30)
internal class VisualOcr(private val service: CortexScreenService) {
    private val mutex = Mutex()

    /** Local numeric readback of an already identified display. No model request or full-screen text export. */
    suspend fun readIntegerRegion(frame: VisualFrame, display: Rect, region: Rect): String? {
        val area = Rect(region)
        if (!area.intersect(frame.bounds) || !area.intersect(display)) return null
        val capture = screenshot(frame)
        val bitmap = capture.bitmap ?: return null
        return try {
            withContext(Dispatchers.Default) { mutex.withLock {
                val origin = if (capture.window) frame.bounds else display
                val left = ((area.left - origin.left).toLong() * bitmap.width / origin.width()).toInt().coerceIn(0, bitmap.width)
                val top = ((area.top - origin.top).toLong() * bitmap.height / origin.height()).toInt().coerceIn(0, bitmap.height)
                val right = ((area.right - origin.left).toLong() * bitmap.width / origin.width()).toInt().coerceIn(left, bitmap.width)
                val bottom = ((area.bottom - origin.top).toLong() * bitmap.height / origin.height()).toInt().coerceIn(top, bitmap.height)
                if (right <= left || bottom <= top) return@withLock null
                val crop = Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top)
                val input = numericInput(crop)
                if (input == null) { if (crop !== bitmap) crop.recycle(); return@withLock null }
                val engine = TessBaseAPI()
                try {
                    val base = File(service.filesDir, "ocr")
                    val data = File(base, "tessdata").apply { mkdirs() }
                    val model = File(data, "eng.traineddata")
                    if (model.length() == 0L) {
                        val temp = File.createTempFile("eng", ".tmp", data)
                        try {
                            service.assets.open("ocr/eng.traineddata").use { source ->
                                temp.outputStream().use { source.copyTo(it) }
                            }
                            check(temp.renameTo(model))
                        } finally { temp.delete() }
                    }
                    if (!engine.init(base.absolutePath, "eng", TessBaseAPI.OEM_LSTM_ONLY)) return@withLock null
                    engine.setPageSegMode(TessBaseAPI.PageSegMode.PSM_SINGLE_LINE)
                    engine.setVariable("tessedit_char_whitelist", "0123456789+-=., ")
                    engine.setImage(input)
                    val text = engine.utF8Text?.trim().orEmpty()
                    val iterator = engine.resultIterator ?: return@withLock null
                    try {
                        iterator.begin()
                        val confidence = iterator.confidence(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE)
                        if (BuildConfig.DEBUG) android.util.Log.d("CortexNumericOcr",
                            "crop=${crop.width}x${crop.height}; input=${input.width}x${input.height}; value=${FirstExperienceReadback.integer(text)}; confidence=$confidence")
                        text.takeIf { it.isNotEmpty() && confidence >= 70f }
                    } finally { iterator.delete() }
                } finally {
                    engine.recycle()
                    if (input !== crop && input !== bitmap) input.recycle()
                    if (crop !== bitmap) crop.recycle()
                }
            } }
        } finally { bitmap.recycle() }
    }

    /** Tight ink bounds and a white background prevent a right-aligned 5 becoming 0 in a large dark field. */
    private fun numericInput(source: Bitmap): Bitmap? {
        val width = source.width
        val height = source.height
        val pixels = IntArray(width * height)
        source.getPixels(pixels, 0, width, 0, 0, width, height)
        fun luminance(color: Int) = (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000
        val corners = intArrayOf(luminance(pixels[0]), luminance(pixels[width - 1]),
            luminance(pixels[(height - 1) * width]), luminance(pixels.last())).sorted()
        val background = (corners[1] + corners[2]) / 2
        val dark = background < 128
        var left = width; var top = height; var right = -1; var bottom = -1
        for (y in 0 until height) for (x in 0 until width) {
            val light = luminance(pixels[y * width + x])
            if (if (dark) light - background >= 40 else background - light >= 40) {
                left = minOf(left, x); top = minOf(top, y); right = maxOf(right, x); bottom = maxOf(bottom, y)
            }
        }
        if (right < left || bottom < top) return null
        val inkWidth = right - left + 1
        val inkHeight = bottom - top + 1
        val padding = (inkHeight / 6).coerceAtLeast(8)
        val scale = minOf((80f / inkHeight).coerceIn(1f, 3f), 1600f / (inkWidth + padding * 2))
        val output = Bitmap.createBitmap(((inkWidth + padding * 2) * scale).toInt().coerceAtLeast(1),
            ((inkHeight + padding * 2) * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        canvas.drawColor(Color.WHITE)
        val sign = if (dark) -1f else 1f
        val offset = if (dark) 255f else 0f
        val transform = ColorMatrix(floatArrayOf(
            .299f * sign, .587f * sign, .114f * sign, 0f, offset,
            .299f * sign, .587f * sign, .114f * sign, 0f, offset,
            .299f * sign, .587f * sign, .114f * sign, 0f, offset,
            0f, 0f, 0f, 1f, 0f))
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { colorFilter = ColorMatrixColorFilter(transform) }
        canvas.drawBitmap(source, Rect(left, top, right + 1, bottom + 1), RectF(padding * scale, padding * scale,
            (padding + inkWidth) * scale, (padding + inkHeight) * scale), paint)
        return output
    }

    suspend fun read(frame: VisualFrame, display: Rect): OcrResult {
        val capture = screenshot(frame)
        val bitmap = capture.bitmap ?: return OcrResult(protected = capture.protected)
        return try {
            withContext(Dispatchers.Default) { mutex.withLock { recognize(bitmap, frame, display, capture.window) } }
        } finally {
            bitmap.recycle()
        }
    }

    private fun recognize(bitmap: Bitmap, frame: VisualFrame, display: Rect, window: Boolean): OcrResult {
        val screen = Rect(frame.bounds)
        if (!screen.intersect(display)) return OcrResult()
        val source = if (window || screen == display) bitmap else {
            val left = (screen.left - display.left) * bitmap.width / display.width()
            val top = (screen.top - display.top) * bitmap.height / display.height()
            val right = (screen.right - display.left) * bitmap.width / display.width()
            val bottom = (screen.bottom - display.top) * bitmap.height / display.height()
            if (right <= left || bottom <= top) return OcrResult()
            Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top)
        }
        val scale = (1440f / maxOf(source.width, source.height)).coerceAtMost(1f)
        val input = Bitmap.createScaledBitmap(source, (source.width * scale).toInt().coerceAtLeast(1),
            (source.height * scale).toInt().coerceAtLeast(1), true)
        if (source !== bitmap && source !== input) source.recycle()
        val base = File(service.filesDir, "ocr")
        val data = File(base, "tessdata").apply { mkdirs() }
        val engine = TessBaseAPI()
        return try {
            for (language in listOf("rus", "eng")) {
                val model = File(data, "$language.traineddata")
                if (model.length() == 0L) {
                    val temp = File.createTempFile(language, ".tmp", data)
                    try {
                        service.assets.open("ocr/${model.name}").use { source ->
                            temp.outputStream().use { destination -> source.copyTo(destination) }
                        }
                        check(temp.renameTo(model))
                    } finally {
                        temp.delete()
                    }
                }
            }
            if (!engine.init(base.absolutePath, "rus+eng", TessBaseAPI.OEM_LSTM_ONLY)) return OcrResult()
            engine.setPageSegMode(TessBaseAPI.PageSegMode.PSM_SPARSE_TEXT)
            engine.setImage(input)
            if (engine.utF8Text.isNullOrBlank()) return OcrResult()
            val iterator = engine.resultIterator ?: return OcrResult()
            val items = mutableListOf<VisualNode>()
            try {
                val level = TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE
                iterator.begin()
                do {
                    val label = VisualLabels.clean(iterator.getUTF8Text(level))
                    if (label.isBlank() || iterator.confidence(level) < 45f) continue
                    val rect = iterator.getBoundingRect(level) ?: continue
                    val bounds = Rect(screen.left + rect.left * screen.width() / input.width,
                        screen.top + rect.top * screen.height() / input.height,
                        screen.left + rect.right * screen.width() / input.width,
                        screen.top + rect.bottom * screen.height() / input.height)
                    if (!bounds.intersect(frame.bounds) || frame.tree.any {
                            Rect.intersects(it.bounds, bounds) && VisualLabels.score(it.label, label) >= 82
                        }) continue
                    items += VisualNode("ocr${items.size + 1}", emptyList(), label, "", "OCR", bounds, ocr = true)
                } while (items.size < 80 && iterator.next(level))
            } finally {
                iterator.delete()
            }
            OcrResult(items)
        } finally {
            engine.recycle()
            if (input !== bitmap) input.recycle()
        }
    }

    private suspend fun screenshot(frame: VisualFrame): Capture = suspendCancellableCoroutine { pending ->
        val useWindow = Build.VERSION.SDK_INT >= 34
        val callback = object : AccessibilityService.TakeScreenshotCallback {
            override fun onSuccess(result: AccessibilityService.ScreenshotResult) {
                val buffer = result.hardwareBuffer
                val bitmap = try {
                    val hardware = Bitmap.wrapHardwareBuffer(buffer, result.colorSpace)
                    try { if (pending.isActive) hardware?.copy(Bitmap.Config.ARGB_8888, false) else null }
                    finally { hardware?.recycle() }
                } finally {
                    buffer.close()
                }
                if (pending.isActive) pending.resume(Capture(bitmap, useWindow)) { _, result, _ -> result.bitmap?.recycle() }
                else bitmap?.recycle()
            }
            override fun onFailure(errorCode: Int) {
                if (pending.isActive) pending.resume(Capture(protected = errorCode == AccessibilityService.ERROR_TAKE_SCREENSHOT_SECURE_WINDOW))
            }
        }
        try {
            if (Build.VERSION.SDK_INT >= 34) service.takeScreenshotOfWindow(frame.window, service.mainExecutor, callback)
            else service.takeScreenshot(Display.DEFAULT_DISPLAY, service.mainExecutor, callback)
        } catch (_: RuntimeException) {
            if (pending.isActive) pending.resume(Capture())
        }
    }

    private data class Capture(val bitmap: Bitmap? = null, val window: Boolean = false, val protected: Boolean = false)
}
