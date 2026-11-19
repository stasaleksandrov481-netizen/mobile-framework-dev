package qa.cortex.calculator

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Separate test-only app window for CORTEX accessibility/search regressions.
 * No network, contacts or real messaging account. Never packaged in CORTEX.
 */
class SearchActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var column: LinearLayout
    private var mode = "chat"
    private var generation = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        mode = intent.getStringExtra("mode") ?: "chat"
        column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(22))
            setBackgroundColor(Color.WHITE)
        }
        setContentView(column)
        if (mode == "search-slow" || mode == "chat-slow") {
            text("Загрузка приложения…", 18f)
            handler.postDelayed({ if (!isFinishing) renderLanding() }, 1_400L)
        } else if (mode == "chat-search") renderSearch()
        else renderLanding()
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()

    private fun text(value: String, size: Float): TextView = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(Color.BLACK)
        column.addView(this, LinearLayout.LayoutParams(-1, dp(42)))
    }

    private fun button(value: String, onClick: () -> Unit): Button = Button(this).apply {
        text = value
        isAllCaps = false
        setOnClickListener { onClick() }
        column.addView(this, LinearLayout.LayoutParams(-1, dp(56)))
    }

    private fun renderLanding() {
        column.removeAllViews()
        text(if (mode == "chat" || mode == "chat-slow") "Telegram QA · не настоящий аккаунт" else "YouTube QA · только тест", 16f)
        button("Поиск") { renderSearch() }
        if (mode == "chat" || mode == "chat-slow") {
            text("Недавние", 15f)
            button("Рыбка") { renderChat("Рыбка") }
            button("Рыбка Новости") { renderChat("Рыбка Новости") }
            button("Медиа") { renderChat("Медиа") }
            text("Рыбка — это текст сообщения, не имя контакта", 12f)
        }
    }

    private fun renderSearch() {
        column.removeAllViews()
        val field = EditText(this).apply {
            hint = "Поиск"
            contentDescription = "Поиск"
            isSingleLine = true
        }
        column.addView(field, LinearLayout.LayoutParams(-1, dp(58)))
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(results)
        field.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(value: Editable?) {
                val query = value?.toString().orEmpty().trim()
                val ticket = ++generation
                results.removeAllViews()
                if (query.isEmpty()) return
                handler.postDelayed({
                    if (ticket != generation || isFinishing) return@postDelayed
                    if (mode == "chat" || mode == "chat-search" || mode == "chat-slow") {
                        for (name in listOf("Рыбка", "Рыбка Новости")) {
                            val button = Button(this@SearchActivity).apply {
                                text = name
                                isAllCaps = false
                                setOnClickListener { renderChat(name) }
                            }
                            results.addView(button, LinearLayout.LayoutParams(-1, dp(56)))
                        }
                    } else {
                        val result = TextView(this@SearchActivity).apply {
                            text = "$query — официальный трейлер, обзор и видео"
                            textSize = 19f
                            gravity = Gravity.CENTER_VERTICAL
                            setTextColor(Color.BLACK)
                        }
                        results.addView(result, LinearLayout.LayoutParams(-1, dp(78)))
                    }
                }, 450L)
            }
        })
    }

    private fun renderChat(title: String) {
        column.removeAllViews()
        text(title, 23f)
        text("Чат QA, сообщения никуда не отправляются", 13f)
        val space = TextView(this)
        column.addView(space, LinearLayout.LayoutParams(-1, 0, 1f))
        val composer = EditText(this).apply {
            hint = "Сообщение"
            contentDescription = "Сообщение"
            isSingleLine = false
        }
        column.addView(composer, LinearLayout.LayoutParams(-1, dp(58)))
        button("Отправить") {
            text("Отправлено только внутри тестового экрана", 12f)
            composer.setText("")
        }
    }
}
