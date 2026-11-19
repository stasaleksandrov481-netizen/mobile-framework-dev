package app.cortex.assistant

import java.util.Locale

/** Local script and strict selectors. No model, network, or expression evaluator. */
internal object FirstExperienceMath {
    data class Calculation(val keys: List<String>, val result: Int)

    val example = Calculation(listOf("8", "4", "×", "7", "="), 588)

    fun prediction(number: Int): List<Calculation> {
        require(number in 1..99)
        return listOf(
            Calculation(number.toString().map(Char::toString) + listOf("×", "2", "="), number * 2),
            Calculation(listOf("+", "1", "0", "="), number * 2 + 10),
            Calculation(listOf("÷", "2", "="), number + 5),
            Calculation(listOf("−") + number.toString().map(Char::toString) + "=", 5)
        )
    }

    suspend fun performPrediction(number: Int, calculate: suspend (Int, Calculation) -> Boolean): Boolean {
        for ((index, calculation) in prediction(number).withIndex()) {
            if (!calculate(index, calculation)) return false
        }
        return true
    }

    private fun normalized(value: String) = value.trim().lowercase(Locale.ROOT)
        .replace(Regex("\\s+"), " ")

    private val aliases = mapOf(
        "×" to setOf("×", "*", "x", "multiply", "times", "умножить", "умножение"),
        "÷" to setOf("÷", "/", "divide", "divided by", "разделить", "деление"),
        "+" to setOf("+", "plus", "add", "плюс", "сложение", "прибавить"),
        "−" to setOf("−", "-", "minus", "subtract", "минус", "вычитание", "вычесть"),
        "=" to setOf("=", "equals", "equal", "равно", "вычислить"),
        "clear" to setOf("ac", "c", "clear", "all clear", "clear all", "очистить", "очистить всё", "очистить все", "сброс")
    )
    private val resources = mapOf(
        "×" to setOf("op_mul", "op_mult", "op_multiply", "multiply", "mul", "bt_mul", "bt_multi", "bt_multiply", "btn_mul", "btn_multiply", "button_multiply"),
        "÷" to setOf("op_div", "op_divide", "divide", "div", "bt_div", "bt_divide", "btn_div", "btn_divide", "button_divide"),
        "+" to setOf("op_add", "add", "plus", "bt_add", "bt_plus", "btn_add", "btn_plus", "button_add"),
        "−" to setOf("op_sub", "op_subtract", "subtract", "minus", "bt_sub", "bt_minus", "btn_sub", "btn_minus", "button_subtract"),
        "=" to setOf("eq", "op_equal", "op_equals", "equal", "equals", "bt_equal", "bt_equals", "btn_equal", "btn_equals", "button_equal"),
        "clear" to setOf("clr", "clear", "all_clear", "clear_all", "bt_clear", "btn_clear", "button_clear")
    )
    val keys = (0..9).map(Int::toString) + listOf("×", "÷", "+", "−", "=", "clear")

    fun key(label: String, description: String, resource: String): String? {
        val texts = setOf(normalized(label), normalized(description)) - ""
        val id = resource.substringAfterLast('/').lowercase(Locale.ROOT)
        val matches = keys.filter { key ->
            if (key.length == 1 && key[0].isDigit()) {
                key in texts || id in setOf("digit_$key", "digit$key", "btn_$key", "btn$key", "button$key", "bt_0$key")
            } else texts.any { it in aliases.getValue(key) } || id in resources.getValue(key)
        }
        // Conflicting IDs/labels and ambiguous controls must never become taps.
        return matches.singleOrNull()
    }

    private val displays = setOf("formula", "result", "result_final", "display", "display_result", "calculator_edit_text",
        "calc_edt_formula", "calc_tv_result", "expression", "tv_result", "txt_result", "result_text", "expression_view",
        "current_formula", "result_field", "calculator_result", "resultdisplay", "formuladisplay", "tv_expression")

    fun isDisplay(resource: String) = resource.substringAfterLast('/').lowercase(Locale.ROOT) in displays

    fun displayedInteger(text: String): Int? {
        val value = text.replace(Regex("[\\s\\u00a0\\u202f\\u200e\\u200f]"), "")
            .removePrefix("=").replace('−', '-').replace(',', '.')
        if (!Regex("[+-]?[0-9]+(?:\\.0+)?").matches(value)) return null
        return runCatching { value.toBigDecimal().intValueExact() }.getOrNull()
    }

    /** Use the actual slider range, never a guessed screen coordinate or OEM scale. */
    fun brightnessTarget(fraction: Float): Float {
        require(fraction.isFinite() && fraction in 0f..1f)
        return if (fraction < .65f) (fraction + .22f).coerceIn(.35f, .85f)
        else (fraction - .22f).coerceIn(.35f, .85f)
    }
}
