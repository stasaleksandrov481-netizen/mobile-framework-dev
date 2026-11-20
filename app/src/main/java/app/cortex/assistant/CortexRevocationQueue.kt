package app.cortex.assistant

import org.json.JSONArray

internal object CortexRevocationQueue {
    private const val LIMIT = 16

    fun decode(saved: String?): List<String> {
        if (saved.isNullOrBlank()) return emptyList()
        // Earlier APKs encrypted a single token using the same storage key.
        if (!saved.startsWith('[')) return listOf(saved)
        return runCatching {
            val items = JSONArray(saved)
            (0 until minOf(items.length(), LIMIT)).mapNotNull { (items.opt(it) as? String)?.takeIf(String::isNotBlank) }
        }.getOrDefault(emptyList())
    }

    fun append(pending: List<String>, token: String): List<String> =
        (pending + token).distinct().takeLast(LIMIT)

    fun encode(tokens: List<String>): String = JSONArray(tokens).toString()
}
