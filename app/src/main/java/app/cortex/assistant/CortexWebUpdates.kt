package app.cortex.assistant

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URI
import java.net.URL
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.UUID
import java.util.zip.ZipInputStream
import javax.net.ssl.HttpsURLConnection

/**
 * Signed, optional updates for the HTML/CSS/JS WebView shell only.
 * Kotlin, permissions, services and libraries still require a signed APK update.
 * Existing sessions keep a fixed asset snapshot so updates never mix versions.
 */
internal class CortexWebUpdates(context: Context) {
    private val app = context.applicationContext
    private val preferences = app.getSharedPreferences("cortex-web-updates", Context.MODE_PRIVATE)
    private val storage = File(app.filesDir, "cortex-web-updates")

    private val endpoint = BuildConfig.CORTEX_WEB_UPDATE_ROOT.trim().trimEnd('/').takeIf { value ->
        runCatching {
            val uri = URI(value)
            uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null &&
                uri.query == null && uri.fragment == null && uri.port == -1 &&
                !uri.path.orEmpty().split('/').contains("..")
        }.getOrDefault(false)
    }
    private val key = runCatching {
        val value = Base64.getDecoder().decode(BuildConfig.CORTEX_WEB_UPDATE_PUBLIC_KEY.trim())
        KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(value))
    }.getOrNull()

    fun snapshot(): Long {
        val active = preferences.getLong("active", 0L)
        return active.takeIf(::compatible) ?: 0L
    }

    private fun compatible(version: Long): Boolean = version > 0 &&
        preferences.getInt("native-v$version", 0) in WEB_CONTRACT_NATIVE..BuildConfig.VERSION_CODE &&
        File(storage, "v$version").isDirectory

    fun handler(version: Long): WebViewAssetLoader.PathHandler = WebViewAssetLoader.PathHandler { path ->
        val safe = safePath(path)
        if (!safe) return@PathHandler missing()
        val input = runCatching {
            if (version > 0) File(storage, "v$version/$path").inputStream()
            else app.assets.open("web/$path")
        }.getOrNull() ?: return@PathHandler missing()
        WebResourceResponse(mime(path), if (path.substringAfterLast('.') in BINARY_TYPES) null else "UTF-8", input)
            .apply { responseHeaders = mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff") }
    }

    @Synchronized fun rollback(version: Long): Boolean {
        if (version <= 0 || preferences.getLong("active", 0L) != version) return false
        val old = preferences.getLong("previous", 0L).takeIf(::compatible) ?: 0L
        return preferences.edit().putLong("active", old).putLong("blocked", version)
            .putLong("previous", 0L).commit()
    }

    fun checkAsync() {
        val base = endpoint ?: return
        val trustedKey = key ?: return
        val now = System.currentTimeMillis()
        val previousCheck = preferences.getLong("last_check", 0L)
        val cooldown = if (preferences.getBoolean("last_failed", false)) 10 * 60_000L else 60 * 60_000L
        if (now >= previousCheck && now - previousCheck < cooldown) return
        preferences.edit().putLong("last_check", now).apply()
        Thread({
            runCatching { install(base, trustedKey) }.onSuccess {
                preferences.edit().putBoolean("last_failed", false).apply()
            }.onFailure {
                preferences.edit().putBoolean("last_failed", true).apply()
                android.util.Log.w("CortexWebUpdates", "Update unavailable: ${it.javaClass.simpleName}")
            }
        }, "CortexWebUpdates").start()
    }

    private fun install(base: String, trustedKey: java.security.PublicKey) {
        val manifestBytes = download("$base/manifest.json", 16_384)
        val signatureBytes = Base64.getDecoder().decode(download("$base/manifest.sig", 2048)
            .toString(Charsets.US_ASCII).trim())
        val verifier = Signature.getInstance("SHA256withRSA")
        verifier.initVerify(trustedKey)
        verifier.update(manifestBytes)
        require(verifier.verify(signatureBytes)) { "Invalid update signature" }

        val manifest = JSONObject(manifestBytes.toString(Charsets.UTF_8))
        require(manifest.optInt("schema") == 1)
        val version = manifest.getLong("version")
        require(version > 0 && version < 10_000_000_000_000L)
        if (version <= snapshot() || version == preferences.getLong("blocked", 0L)) return
        val minNative = manifest.optInt("min_native")
        if (minNative < WEB_CONTRACT_NATIVE) return
        require(minNative <= BuildConfig.VERSION_CODE)
        val name = "web-v$version.zip"
        require(manifest.getString("archive") == name)
        val size = manifest.getLong("size")
        require(size in 1L..6_000_000L)
        val expected = manifest.getString("sha256")
        require(expected.matches(Regex("[a-f0-9]{64}")))
        val archive = download("$base/$name", 6_000_000)
        require(archive.size.toLong() == size && sha256(archive) == expected)

        storage.mkdirs()
        val stage = File(storage, "staging-${UUID.randomUUID()}")
        require(stage.mkdir())
        try {
            unpack(archive, stage)
            synchronized(this) {
                // A rollback may have happened while the download was in flight.
                require(version > snapshot() && version != preferences.getLong("blocked", 0L))
                val destination = File(storage, "v$version")
                // A cached package from the old contract can share this web version number.
                if (destination.exists() && !compatible(version)) {
                    require(destination.deleteRecursively())
                }
                require(!destination.exists() && stage.renameTo(destination))
                val previous = snapshot()
                if (!preferences.edit().putLong("previous", previous).putLong("active", version)
                        .putInt("native-v$version", minNative).commit()) {
                    throw IllegalStateException("Could not activate update")
                }
            }
            // Keep older immutable bundles while a running WebView may still read them.
            // Cleanup belongs to cold startup, after no old asset snapshot is active.
        } finally {
            if (stage.exists()) stage.deleteRecursively()
        }
    }

    private fun unpack(bytes: ByteArray, destination: File) {
        var total = 0L
        val files = hashSetOf<String>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val path = entry.name
                require(safePath(path) && !entry.isDirectory && files.add(path) && files.size <= 80)
                val file = File(destination, path)
                require(file.canonicalPath.startsWith(destination.canonicalPath + File.separator))
                require(file.parentFile?.mkdirs() == true || file.parentFile?.isDirectory == true)
                file.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = zip.read(buffer)
                        if (count < 0) break
                        total += count
                        require(total <= 8_000_000)
                        output.write(buffer, 0, count)
                    }
                }
                zip.closeEntry()
            }
        }
        require(files.containsAll(REQUIRED)) { "Incomplete WebView bundle" }
    }

    private fun download(value: String, limit: Int): ByteArray {
        val connection = URL(value).openConnection() as HttpsURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 6000
        connection.readTimeout = 15_000
        try {
            require(connection.responseCode == 200 && connection.contentLengthLong <= limit)
            val result = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(result.size() + count <= limit)
                    result.write(buffer, 0, count)
                }
            }
            return result.toByteArray()
        } finally {
            connection.disconnect()
        }
    }

    private fun sha256(value: ByteArray) = MessageDigest.getInstance("SHA-256").digest(value)
        .joinToString("") { "%02x".format(it) }

    private fun safePath(path: String): Boolean = path.isNotBlank() && path.length <= 150 &&
        path.matches(Regex("[A-Za-z0-9_./-]+")) && path.split('/').none { it.isBlank() || it == "." || it == ".." } &&
        path.substringAfterLast('.') in setOf("html", "js", "css", "svg", "png", "webp", "jpg", "jpeg",
            "woff", "woff2", "ttf", "json", "txt")

    private fun mime(path: String) = when (path.substringAfterLast('.')) {
        "html" -> "text/html"
        "js" -> "application/javascript"
        "css" -> "text/css"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "webp" -> "image/webp"
        "jpg", "jpeg" -> "image/jpeg"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        "ttf" -> "font/ttf"
        "json" -> "application/json"
        else -> "text/plain"
    }

    private fun missing() = WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
        mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

    private companion object {
        // The settings shell uses the visual consent and local token fields introduced in 1.0.14.
        const val WEB_CONTRACT_NATIVE = 114
        val BINARY_TYPES = setOf("svg", "png", "webp", "jpg", "jpeg", "woff", "woff2", "ttf")
        val REQUIRED = setOf("index.html", "app.js", "model.js", "gateway.js", "setup.js", "screens.js",
            "icons.js", "style.css", "planner.js", "planner.css", "cortex-control-client.js",
            "cortex-control.css", "subscription.js", "subscription.css", "transitions.js", "markdown.js")
    }
}
