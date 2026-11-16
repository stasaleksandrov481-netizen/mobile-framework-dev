package app.cortex.assistant

import java.net.URI

/** Parses external links before handing them to a browser from the WebView bridge. */
internal object CortexSafeUrl {
    fun parse(value: String): URI? = runCatching {
        if (value.length !in 9..2048 || value.any { Character.isISOControl(it) || it == '\\' }) return@runCatching null
        val url = URI(value)
        if (!url.isAbsolute || url.scheme?.lowercase() != "https" || url.host.isNullOrBlank() ||
            url.rawUserInfo != null || url.port > 65535 || url.port == 0) return@runCatching null
        val host = url.host.lowercase()
        // A model-supplied URL must not make the browser send a request to a
        // router, loopback endpoint or an intranet service on the user's phone.
        if (!host.contains('.') || host.endsWith(".local") || host.endsWith(".localhost") ||
            host.endsWith(".internal") || host.contains(':') ||
            Regex("""(?:\d{1,3}\.){3}\d{1,3}""").matches(host)) return@runCatching null
        url
    }.getOrNull()
}
