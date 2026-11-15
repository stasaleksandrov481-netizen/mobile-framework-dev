package app.cortex.assistant

import android.content.SharedPreferences
import android.graphics.Color
import org.json.JSONObject

internal data class IslandAppearance(
    val background: Int, val text: Int, val border: Int, val accent: Int, val faceColor: Int,
    val opacity: Float, val size: Float, val offsetX: Float, val offsetY: Float, val corner: Float,
    val borderWidth: Float, val motion: String, val face: Boolean, val status: Boolean,
    val progress: Boolean, val quick: Boolean, val results: Boolean
) {
    companion object {
        fun read(preferences: SharedPreferences) = parse(
            runCatching { JSONObject(preferences.getString("island-style", "{}").orEmpty()) }.getOrDefault(JSONObject())
        )

        fun parse(settings: JSONObject = JSONObject()): IslandAppearance {
            fun color(key: String, fallback: String): Int {
                val value = settings.optString(key).takeIf { it.matches(Regex("#[A-Fa-f0-9]{6}")) } ?: fallback
                return Color.parseColor(value)
            }
            fun number(key: String, fallback: Double, min: Double, max: Double): Float =
                settings.optDouble(key, fallback).takeIf(Double::isFinite)?.coerceIn(min, max)?.toFloat() ?: fallback.toFloat()
            return IslandAppearance(
                color("background", "#080808"), color("text", "#FFFFFF"), color("border", "#AFAFAF"),
                color("accent", "#FFFFFF"), color("faceColor", "#E5E5E5"),
                number("opacity", 100.0, 40.0, 100.0) / 100,
                number("size", 100.0, 80.0, 125.0) / 100, number("offsetX", 0.0, -75.0, 75.0),
                number("offsetY", 0.0, 0.0, 80.0), number("corner", 22.0, 12.0, 32.0),
                number("borderWidth", .9, 0.0, 3.0),
                settings.optString("motion").takeIf { it in setOf("liquid", "soft", "none") } ?: "liquid",
                settings.optBoolean("face", true), settings.optBoolean("status", true),
                settings.optBoolean("progress", true), settings.optBoolean("quick", true),
                settings.optBoolean("results", true)
            )
        }
    }
}
