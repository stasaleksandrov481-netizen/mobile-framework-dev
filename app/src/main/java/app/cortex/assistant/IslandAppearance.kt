package app.cortex.assistant

import android.content.SharedPreferences
import android.graphics.Color
import org.json.JSONObject

internal data class IslandAppearance(
    val background: Int, val text: Int, val border: Int, val accent: Int, val faceColor: Int,
    val opacity: Float, val size: Float, val widthScale: Float, val heightScale: Float, val offsetX: Float, val offsetY: Float, val corner: Float,
    val borderWidth: Float, val motion: String, val face: Boolean, val status: Boolean,
    val progress: Boolean, val results: Boolean, val glass: Boolean, val mascot: Boolean
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
            // Previous releases stored the default as translucent charcoal. It
            // was a preset, not a deliberate user-selected transparency level.
            val legacyDefault = settings.optString("background").equals("#080808", true)
            val legacyOpacity = settings.optDouble("opacity", 96.0)
            return IslandAppearance(
                if (legacyDefault) Color.parseColor("#34465A") else color("background", "#34465A"), color("text", "#FFFFFF"), color("border", "#FFFFFF"),
                color("accent", "#FFFFFF"), color("faceColor", "#E5E5E5"),
                if (legacyDefault && legacyOpacity in 96.0..100.0) 1f
                    else number("opacity", 100.0, 40.0, 100.0) / 100,
                number("size", 100.0, 80.0, 125.0) / 100,
                number("widthScale", 100.0, 80.0, 125.0) / 100, number("heightScale", 100.0, 90.0, 125.0) / 100,
                number("offsetX", 0.0, -75.0, 75.0),
                number("offsetY", 0.0, 0.0, 80.0), number("corner", 22.0, 12.0, 32.0),
                number("borderWidth", .45, 0.0, 3.0),
                settings.optString("motion").takeIf { it in setOf("liquid", "soft", "none") } ?: "liquid",
                settings.optBoolean("face", true), settings.optBoolean("status", true),
                settings.optBoolean("progress", true), settings.optBoolean("results", true),
                settings.optBoolean("glass", true), settings.optBoolean("mascot", true)
            )
        }
    }
}
