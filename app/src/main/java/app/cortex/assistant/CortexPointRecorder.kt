package app.cortex.assistant

import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONObject
import kotlin.math.roundToInt

internal class CortexPointRecorder(private val screen: CortexScreenService) {
    private val ui = Handler(Looper.getMainLooper())
    private val manager = screen.getSystemService(WindowManager::class.java)
    private var view: FrameLayout? = null
    private var callback: ((JSONObject?) -> Unit)? = null
    private val timeout = Runnable { finish(null) }

    fun start(done: (JSONObject?) -> Unit) {
        if (callback != null || screen.locked()) { done(null); return }
        callback = done
        ui.postDelayed({
            if (callback == null) return@postDelayed
            val frame = screen.frame()?.takeUnless { it.pkg == screen.packageName || it.secure || it.hasPrivateFields }
            if (frame == null) { finish(null); return@postDelayed }
            val layer = FrameLayout(screen).apply {
                setBackgroundColor(0x4C000000)
                addView(TextView(screen).apply {
                    text = "Коснитесь точки для записи\nКасание не будет передано приложению"
                    setTextColor(Color.WHITE)
                    setBackgroundColor(0xEE141414.toInt())
                    gravity = Gravity.CENTER
                    val padding = (16 * resources.displayMetrics.density).roundToInt()
                    setPadding(padding, padding, padding, padding)
                }, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
                setOnTouchListener { _, event ->
                    if (event.actionMasked == MotionEvent.ACTION_UP) {
                        val x = event.rawX.roundToInt()
                        val y = event.rawY.roundToInt()
                        val point = if (!screen.locked() && frame.bounds.contains(x, y)) {
                            val label = frame.tree.filter { it.enabled && it.clickable && it.bounds.contains(x, y) }
                                .minByOrNull { it.bounds.width().toLong() * it.bounds.height() }
                                ?.let { it.label.ifBlank { it.description }.take(180) }.orEmpty()
                            JSONObject().put("package", frame.pkg)
                                .put("x", (event.rawX - frame.bounds.left) / frame.bounds.width().toDouble())
                                .put("y", (event.rawY - frame.bounds.top) / frame.bounds.height().toDouble())
                                .put("target", label)
                        } else null
                        finish(point)
                    }
                    true
                }
            }
            val params = WindowManager.LayoutParams(-1, -1, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT)
            if (runCatching { manager.addView(layer, params) }.isSuccess) {
                view = layer
                ui.postDelayed(timeout, 20_000)
            } else finish(null)
        }, 350)
    }

    fun cancel() = finish(null)

    private fun finish(value: JSONObject?) {
        ui.removeCallbacksAndMessages(null)
        view?.let { runCatching { manager.removeViewImmediate(it) } }
        view = null
        val done = callback
        callback = null
        done?.invoke(value)
    }
}
