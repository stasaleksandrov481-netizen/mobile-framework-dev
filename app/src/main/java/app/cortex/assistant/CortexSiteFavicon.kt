package app.cortex.assistant

import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Safely resolves public website favicons for the offline WebView.
 * The WebView itself has network access disabled. This handler contacts only
 * one fixed HTTPS favicon service, never the untrusted page or IP in a URL.
 */
internal class CortexSiteFavicon : WebViewAssetLoader.PathHandler {
    private val domain = Regex("(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}")
    private val cache = object : LinkedHashMap<String, ByteArray>(40, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?): Boolean = size > 40
    }

    override fun handle(path: String): WebResourceResponse {
        val host = path.substringBefore('/').lowercase()
        val bytes = if (host.length <= 253 && domain.matches(host)) {
            synchronized(cache) { cache[host] } ?: retrieve(host)?.also { synchronized(cache) { cache[host] = it } }
        } else null
        return if (bytes == null) WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))
        else WebResourceResponse("image/png", null, 200, "OK",
            mapOf("Cache-Control" to "private, max-age=86400", "X-Content-Type-Options" to "nosniff"), ByteArrayInputStream(bytes))
    }

    private fun retrieve(host: String): ByteArray? = runCatching {
        val connection = URL("https://www.google.com/s2/favicons?domain=$host&sz=32").openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 2200
            connection.readTimeout = 2200
            connection.setRequestProperty("Accept", "image/png")
            if (connection.responseCode != 200 || !connection.contentType.orEmpty().startsWith("image/png")) return null
            val data = connection.inputStream.use { stream ->
                val output = ByteArrayOutputStream(4096)
                val buffer = ByteArray(1024)
                while (output.size() <= 8192) {
                    val read = stream.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                }
                output.toByteArray()
            }
            if (data.size > 8192 || data.size < 8 || !data.copyOfRange(0, 8).contentEquals(
                    byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10))) return null
            data
        } finally { connection.disconnect() }
    }.getOrNull()
}
