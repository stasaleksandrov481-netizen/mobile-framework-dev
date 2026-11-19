package qa.cortex.calculator

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** A separate Android test fixture, not a production calculator or an OEM compatibility claim. */
class CalculatorActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var mode = "normal"
    private var formula = ""
    private var generation = 0
    private lateinit var display: Display
    private lateinit var preview: TextView
    private lateinit var trace: TextView
    private val buttons = mutableListOf<Button>()

    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); configure(intent) }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); if (intent.hasExtra("mode")) configure(intent) }

    private fun configure(intent: Intent) {
        val store = getSharedPreferences("qa", MODE_PRIVATE)
        intent.getStringExtra("mode")?.let { store.edit().putString("mode", it).apply() }
        mode = store.getString("mode", "normal") ?: "normal"
        formula = ""; generation++; buttons.clear()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            setPadding(dp(16), dp(20), dp(16), dp(36))
        }
        fun text(value: String, size: Float, id: Int = 0) = TextView(this).apply {
            this.id = id; text = value; textSize = size; setTextColor(Color.WHITE)
        }
        root.addView(text("QA CALCULATOR · $mode · NOT AN OEM DEVICE", 11f))
        root.addView(text("5", 12f, R.id.history_result))
        trace = text("trace:", 10f, R.id.fixture_trace)
        root.addView(trace)
        display = Display(this).apply {
            id = R.id.calc_edt_formula; text = "0"; textSize = 56f; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            setTextColor(Color.WHITE); isEnabled = false; setPadding(dp(8), dp(10), dp(8), dp(10))
        }
        root.addView(display, LinearLayout.LayoutParams(-1, dp(118)))
        preview = text("", 24f, R.id.calc_tv_result).apply { gravity = Gravity.RIGHT }
        root.addView(preview, LinearLayout.LayoutParams(-1, dp(40)))
        val grid = listOf(listOf("7", "8", "9", "÷"), listOf("4", "5", "6", "×"),
            listOf("1", "2", "3", "−"), listOf("C", "0", "=", "+"))
        val ids = mapOf("0" to R.id.digit_0, "1" to R.id.digit_1, "2" to R.id.digit_2,
            "3" to R.id.digit_3, "4" to R.id.digit_4, "5" to R.id.digit_5, "6" to R.id.digit_6,
            "7" to R.id.digit_7, "8" to R.id.digit_8, "9" to R.id.digit_9, "×" to R.id.op_mul,
            "÷" to R.id.op_div, "+" to R.id.op_add, "−" to R.id.op_sub, "=" to R.id.eq, "C" to R.id.clr)
        for (keys in grid) {
            val row = LinearLayout(this)
            for (key in keys) {
                val button = Button(this).apply {
                    id = ids.getValue(key); text = key; textSize = 22f; setOnClickListener { press(key) }
                }
                buttons += button
                row.addView(button, LinearLayout.LayoutParams(0, -1, 1f))
            }
            root.addView(row, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        setContentView(root)
        display.visibilityMode = mode
    }

    private fun answer(): Int? {
        val match = Regex("([0-9]+)([×÷+−])([0-9]+)").matchEntire(formula) ?: return null
        val a = match.groupValues[1].toInt()
        val b = match.groupValues[3].toInt()
        return when (match.groupValues[2]) { "×" -> a * b; "÷" -> if (b == 0) null else a / b; "+" -> a + b; else -> a - b }
    }

    private fun press(key: String) {
        trace.text = (trace.text.toString() + key).takeLast(160)
        if (key == "C") {
            generation++; formula = ""; display.text = "0"; display.finalValue = false; preview.text = ""
            buttons.forEach { it.isEnabled = true }; return
        }
        if (key == "=") {
            val actual = answer() ?: return
            val ownGeneration = generation
            val result = if (mode == "wrong") actual + 1 else actual
            preview.text = actual.toString() // A correct preview must not hide an incorrect final result.
            val update = Runnable {
                if (generation == ownGeneration) { display.finalValue = true; display.text = result.toString() }
            }
            if (mode == "delayed") handler.postDelayed(update, 900L) else update.run()
            formula = "" // Continuation must explicitly re-enter the verified result.
            return
        }
        display.finalValue = false
        formula += key
        display.text = if (mode == "opaque") formula else formula.replace("×", " ⨯ ").replace("÷", " : ")
        preview.text = answer()?.toString().orEmpty()
        if (mode == "missing" && key == "×") buttons.filter { it.text.toString().all(Char::isDigit) }.forEach { it.isEnabled = false }
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()

    private class Display(context: Context) : TextView(context) {
        var visibilityMode = "normal"
        var finalValue = false
        override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
            super.onInitializeAccessibilityNodeInfo(info)
            info.isEnabled = false
            if (visibilityMode == "opaque") { info.text = null; info.contentDescription = "Calculator display" }
            else if (visibilityMode == "description" && finalValue) { info.text = null; info.contentDescription = "Результат: $text" }
            else info.contentDescription = "Changing display description: $text"
        }
    }
}
