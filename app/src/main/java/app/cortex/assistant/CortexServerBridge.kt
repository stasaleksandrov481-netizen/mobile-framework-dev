package app.cortex.assistant

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.webkit.JavaScriptReplyProxy
import org.json.JSONObject
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.security.KeyStore
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ArrayBlockingQueue
import java.util.UUID
import java.util.concurrent.FutureTask
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Bridge to the CORTEX Supabase Edge Function. No API provider keys in the APK. */
internal class CortexServerBridge(private val context: Context) : AutoCloseable {
    private val store = SecureSession(context)
    // A stalled upstream must not turn repeated UI requests into an unbounded
    // queue of JSON payloads, Futures and retained callbacks.
    private val executor = ThreadPoolExecutor(3, 3, 0L, TimeUnit.MILLISECONDS,
        ArrayBlockingQueue<Runnable>(16))
    private val jobs = ConcurrentHashMap<String, FutureTask<Unit>>()
    private val main = Handler(Looper.getMainLooper())
    private val connections = ConcurrentHashMap<String, HttpURLConnection>()
    private val lifecycle = Any()
    @Volatile private var revocationAttemptedAt = 0L
    private val installId = installToken(context)
    private val deviceId = runCatching {
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
    }.getOrNull()?.takeIf { it.matches(Regex("^[a-f0-9]{16}$")) }
    private val endpoint = "https://jjcqrjztxohnifmziksy.supabase.co/functions/v1/cortex/v1/"
    private val cortexPackage = runCatching { context.packageManager.getPackageInfo(context.packageName,0) }.getOrNull()

    fun handle(raw: String, reply: JavaScriptReplyProxy) {
        if (raw.length > 270_000) {
            val id = Regex("\\\"id\\\"\\s*:\\s*\\\"(request-[0-9]{10,16}-[0-9]{1,9})\\\"")
                .find(raw.take(256))?.groupValues?.getOrNull(1)
            if (id != null) runCatching { reply.postMessage(JSONObject().put("id", id).put("error", "too_large").toString()) }
            return
        }
        val request = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val id = request.optString("id")
        if (!Regex("^request-[0-9]{10,16}-[0-9]{1,9}$").matches(id)) return
        if (request.optString("operation") == "cancel") {
            cancel(id)
            return
        }
        fun publish(value: JSONObject) {
            runCatching { reply.postMessage(value.put("id", id).toString()) }
        }
        enqueue(id, request, ::publish, ::publish)
    }

    fun chat(payload: JSONObject, onEvent: (JSONObject) -> Unit, done: (JSONObject) -> Unit): String {
        val id = UUID.randomUUID().toString()
        val request = JSONObject().put("operation", "chat").put("payload", payload)
        enqueue(id, request, onEvent, done)
        return id
    }

    fun speech(text: String, done: (JSONObject) -> Unit): String {
        val id = UUID.randomUUID().toString()
        enqueue(id, JSONObject().put("operation", "speech").put("text", text.take(550)), {}, done)
        return id
    }

    fun inbox(done: (JSONObject) -> Unit) {
        enqueue(UUID.randomUUID().toString(), JSONObject().put("operation", "support-inbox"), {}, done)
    }

    private fun enqueue(id: String, request: JSONObject, onEvent: (JSONObject) -> Unit, done: (JSONObject) -> Unit) {
        val task = FutureTask<Unit> {
            val outcome = JSONObject()
            try {
                if (request.optString("operation") != "logout") retryPendingRevocation(id)
                outcome.put("result", perform(request, id) { event ->
                    main.post { if (jobs.containsKey(id)) onEvent(event) }
                })
            } catch (error: GatewayFailure) {
                outcome.put("error", error.code)
                if (error.retryAfter > 0) outcome.put("retry_after", error.retryAfter)
                error.quota?.let { outcome.put("quota", it) }
            } catch (_: SocketTimeoutException) {
                outcome.put("error", "timeout")
            } catch (_: Exception) {
                outcome.put("error", "offline")
            }
            main.post { if (jobs.remove(id) != null) done(outcome) }
        }
        val accepted = synchronized(lifecycle) {
            if (executor.isShutdown || jobs.size >= 19 || jobs.putIfAbsent(id, task) != null) false
            else try {
                executor.execute(task)
                true
            } catch (_: RejectedExecutionException) {
                jobs.remove(id, task)
                false
            }
        }
        if (!accepted) main.post { done(JSONObject().put("error", "busy")) }
    }

    fun cancel(id: String) {
        jobs.remove(id)?.cancel(true)
        connections.remove(id)?.let { socket -> Thread(socket::disconnect, "cortex-cancel").start() }
    }

    private fun perform(request: JSONObject, id: String, onEvent: (JSONObject) -> Unit): JSONObject {
        return when (request.optString("operation")) {
            "status" -> call("GET", "status", null, id)
            "subscription" -> call("GET", "subscription", null, id)
            "subscription-payment" -> call("POST", "subscription/payment", request.optJSONObject("payload") ?: throw GatewayFailure("invalid"), id)
            "presence" -> call("POST", "presence", request.optJSONObject("payload") ?: throw GatewayFailure("invalid"), id)
            "support-inbox" -> call("GET", "support/inbox", null, id)
            "support-ai" -> call("POST", "support/ai", request.optJSONObject("payload") ?: throw GatewayFailure("invalid"), id)
            "chat" -> call("POST", "chat", request.optJSONObject("payload") ?: throw GatewayFailure("invalid"), id, onEvent)
            "speech" -> speechBytes(request.optString("text"), id)
            "support" -> call("POST", "support", request.optJSONObject("payload") ?: throw GatewayFailure("invalid"), id)
            "auth-start" -> synchronized(loginLock) {
                call("POST", "auth/start?return=android&scheme=${BuildConfig.APPLICATION_ID}", JSONObject(), id).also {
                    val code = it.optString("poll")
                    val seconds = it.optInt("expires_in", 300).coerceIn(1, 300)
                    if (!LOGIN_CODE.matches(code)) throw GatewayFailure("auth_denied")
                    store.put("${System.currentTimeMillis() + seconds * 1000L}:$code", "login")
                    it.remove("poll")
                }
            }
            "auth-resume" -> JSONObject().apply {
                val expiry = store.get("login")?.substringBefore(':')?.toLongOrNull() ?: 0L
                put("expires_at", expiry)
            }
            "auth-poll" -> synchronized(loginLock) {
                val pending = store.get("login").orEmpty()
                val code = pending.substringAfter(':', "")
                if ((pending.substringBefore(':').toLongOrNull() ?: 0L) <= System.currentTimeMillis() ||
                    !LOGIN_CODE.matches(code)) throw GatewayFailure("auth_expired")
                call("POST", "auth/poll", JSONObject().put("code", code), id).also {
                    adoptSession(it)
                }
            }
            "auth-signup", "auth-password", "auth-verify", "auth-recover", "auth-reset", "auth-resend" -> synchronized(loginLock) {
                val route = request.optString("operation").removePrefix("auth-")
                val payload = request.optJSONObject("payload") ?: throw GatewayFailure("invalid")
                val result = call("POST", "auth/$route", payload, id)
                adoptSession(result)
                if (route == "reset") {
                    store.clear()
                    CortexScenarios.selectAccount(context, null)
                }
                result
            }
            "auth-cancel" -> synchronized(loginLock) { store.clear("login"); JSONObject().put("cancelled", true) }
            "logout" -> synchronized(loginLock) {
                // A local logout must be immediate even without connectivity,
                // but the remotely valid bearer must not be forgotten forever.
                val active = store.get()
                if (active != null) store.put(active, "pending-revoke")
                val revoked = runCatching { call("DELETE", "session", null, id) }.isSuccess
                if (revoked && active != null && store.get("pending-revoke") == active) store.clear("pending-revoke")
                store.clear("login")
                store.clear()
                CortexScenarios.selectAccount(context, null)
                JSONObject().put("ok", true).put("revocation_pending", active != null && !revoked)
            }
            else -> throw GatewayFailure("endpoint_missing")
        }
    }

    private fun adoptSession(result: JSONObject) {
        val token = result.remove("token") as? String
        if (result.optString("state") != "signed_in") return
        if (token == null || !LOGIN_CODE.matches(token)) throw GatewayFailure("auth_denied")
        store.put(token)
        store.clear("login")
        CortexScenarios.selectAccount(context, result.optJSONObject("account")?.optString("id"))
    }

    private fun retryPendingRevocation(id: String) {
        val pending = store.get("pending-revoke") ?: return
        val now = android.os.SystemClock.elapsedRealtime()
        if (revocationAttemptedAt > 0L && now - revocationAttemptedAt < 60_000L) return
        revocationAttemptedAt = now
        // Best-effort short retry: never block regular assistance for a long
        // network timeout. The token is stored encrypted with Android Keystore.
        if (runCatching { call("DELETE", "session", null, id, bearerOverride = pending, timeoutMs = 2500) }.isSuccess) {
            synchronized(loginLock) {
                if (store.get("pending-revoke") == pending) store.clear("pending-revoke")
            }
        }
    }

    private fun call(method: String, route: String, payload: JSONObject?, id: String,
                     onEvent: ((JSONObject) -> Unit)? = null, bearerOverride: String? = null,
                     timeoutMs: Int? = null): JSONObject {
        val connection = (URL(endpoint + route).openConnection() as HttpURLConnection)
        connections[id] = connection
        try {
            if (!jobs.containsKey(id)) throw InterruptedException()
            connection.instanceFollowRedirects = false
            connection.connectTimeout = timeoutMs ?: 12_000
            connection.readTimeout = timeoutMs ?: if (route.startsWith("auth/")) 20_000 else 92_000
            connection.requestMethod = method
            connection.setRequestProperty("Accept", if (onEvent == null) "application/json" else "text/event-stream")
            connection.setRequestProperty("X-Cortex-Install", installId)
            if (route == "presence") deviceId?.let { connection.setRequestProperty("X-Cortex-Device", it) }
            connection.setRequestProperty("X-Cortex-Version-Code", cortexPackage?.versionCode?.toString() ?: BuildConfig.VERSION_CODE.toString())
            connection.setRequestProperty("X-Cortex-Version-Name", cortexPackage?.versionName ?: BuildConfig.VERSION_NAME)
            connection.setRequestProperty("Cache-Control", "no-store")
            val token = bearerOverride ?: store.get()
            if (!token.isNullOrEmpty()) connection.setRequestProperty("Authorization", "Bearer $token")
            if (payload != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { out -> out.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (status !in 200..299) {
                val body = connection.errorStream?.let { readBounded(it, 2_000) }.orEmpty()
                val error = runCatching { JSONObject(body) }.getOrNull()
                val code = error?.optString("error").orEmpty().ifBlank { if (status == 429) "rate_limit" else "server" }
                if (code == "sign_in" && !token.isNullOrEmpty()) synchronized(loginLock) {
                    if (store.get() == token) {
                        store.clear()
                        CortexScenarios.selectAccount(context, null)
                    }
                }
                throw GatewayFailure(code, error?.optInt("retry_after") ?: 0, error?.optJSONObject("quota"))
            }
            return if (onEvent != null && connection.contentType.orEmpty().contains("event-stream")) {
                val quota = connection.getHeaderField("X-Cortex-Quota")?.takeIf { it.length <= 1024 }
                    ?.let { runCatching { JSONObject(it) }.getOrNull() }
                quota?.let { onEvent(JSONObject().put("quota", it).put("status", "quota")) }
                connection.inputStream.bufferedReader().use { sse(it, onEvent) }
            } else {
                val text = readBounded(connection.inputStream, 1_000_000)
                if (!jobs.containsKey(id)) throw InterruptedException()
                JSONObject(text).also {
                    if (route == "status" && it.optString("fault").isEmpty() && it.has("account")) synchronized(loginLock) {
                        if (store.get() != token) throw GatewayFailure("auth_busy")
                        val account = it.optJSONObject("account")
                        if (account == null && !token.isNullOrEmpty()) store.clear()
                        CortexScenarios.selectAccount(context, account?.optString("id"))
                    }
                }
            }
        } finally {
            connections.remove(id, connection)
            connection.disconnect()
        }
    }

    private fun speechBytes(text: String, id: String): JSONObject {
        if (text.isBlank() || text.length > 550) throw GatewayFailure("invalid")
        val connection = (URL(endpoint + "speech").openConnection() as HttpURLConnection)
        connections[id] = connection
        try {
            if (!jobs.containsKey(id)) throw InterruptedException()
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8_000
            connection.readTimeout = 32_000
            connection.requestMethod = "POST"
            connection.setRequestProperty("Accept", "application/octet-stream")
            connection.setRequestProperty("X-Cortex-Audio-Accept", CortexAudioCodec.ADPCM_FORMAT)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("X-Cortex-Install", installId)
            connection.setRequestProperty("X-Cortex-Version-Code", BuildConfig.VERSION_CODE.toString())
            store.get()?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            connection.doOutput = true
            connection.outputStream.use { it.write(JSONObject().put("text", text).toString().toByteArray(Charsets.UTF_8)) }
            if (connection.responseCode !in 200..299) {
                val json = runCatching { JSONObject(connection.errorStream?.let { readBounded(it, 300) }.orEmpty()) }.getOrNull()
                throw GatewayFailure(json?.optString("error", "speech_unavailable") ?: "speech_unavailable")
            }
            val format = connection.getHeaderField("X-Cortex-Audio-Format")
            if (format != CortexAudioCodec.PCM_FORMAT && format != CortexAudioCodec.ADPCM_FORMAT ||
                !connection.contentType.orEmpty().startsWith("application/octet-stream")) throw GatewayFailure("speech_unavailable")
            val transferLimit = if (format == CortexAudioCodec.ADPCM_FORMAT) 600_012 else 2_400_000
            val buffer = ByteArray(8192)
            val output = ByteArrayOutputStream()
            connection.inputStream.use { source ->
                while (true) {
                    if (Thread.currentThread().isInterrupted) throw InterruptedException()
                    val count = source.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > transferLimit) throw GatewayFailure("speech_unavailable")
                    output.write(buffer, 0, count)
                }
            }
            val audio = output.toByteArray()
            if (audio.isEmpty() || format == CortexAudioCodec.PCM_FORMAT && audio.size % 2 != 0)
                throw GatewayFailure("speech_unavailable")
            val result = JSONObject().put("audio", Base64.encodeToString(audio, Base64.NO_WRAP)).put("audio_format", format)
            connection.getHeaderField("X-Cortex-Quota")?.takeIf { it.length <= 1024 }?.let { raw ->
                runCatching { JSONObject(raw) }.getOrNull()?.let { result.put("quota", it) }
            }
            return result
        } finally {
            connections.remove(id, connection)
            connection.disconnect()
        }
    }

    private fun readBounded(stream: InputStream, maxChars: Int): String = try {
        CortexBoundedText.read(InputStreamReader(stream, Charsets.UTF_8), maxChars)
    } catch (_: IllegalArgumentException) {
        throw GatewayFailure("response_too_large")
    }

    private fun sse(reader: BufferedReader, onEvent: (JSONObject) -> Unit): JSONObject {
        val text = StringBuilder()
        val result = JSONObject()
        var completed = false
        var events = 0
        var receivedChars = 0
        while (true) {
            val line = boundedLine(reader, 65_536) ?: break
            receivedChars += line.length
            if (++events > 5_000 || receivedChars > 1_000_000) throw GatewayFailure("response_too_large")
            if (Thread.currentThread().isInterrupted) throw GatewayFailure("timeout")
            if (!line.startsWith("data:")) continue
            val value = line.substring(5).trim()
            if (value == "[DONE]") { completed = true; break }
            val event = runCatching { JSONObject(value) }.getOrNull() ?: continue
            event.optJSONObject("quota")?.let { onEvent(JSONObject().put("quota", it).put("status", "quota")) }
            if (event.has("error")) throw GatewayFailure(event.optString("error", "provider"), event.optInt("retry_after"))
            if (event.optString("status") == "fallback") onEvent(JSONObject().put("status", "fallback"))
            if (event.optString("status") == "web_search") onEvent(JSONObject().put("status", "web_search"))
            if (event.optString("status") == "web_ready") onEvent(JSONObject().put("status", "web_ready"))
            if (event.has("delta")) {
                val delta = event.optString("delta")
                if (delta.isNotEmpty() && text.length < 20_000) {
                    val part = delta.take(20_000 - text.length)
                    text.append(part)
                    onEvent(JSONObject().put("delta", part))
                }
            }
            for (key in arrayOf("tool", "tools", "tool_error")) if (event.has(key)) result.put(key, event.get(key))
        }
        // A network disconnect cannot authorize execution of a partial plan.
        if (!completed) throw GatewayFailure("stream_interrupted")
        if (text.isNotEmpty()) result.put("text", text.toString())
        if (result.length() == 0) throw GatewayFailure("empty")
        return result
    }

    // BufferedReader.readLine() can otherwise accumulate an unlimited SSE line
    // before the caller has any chance to check its length.
    private fun boundedLine(reader: BufferedReader, limit: Int): String? {
        val line = StringBuilder()
        while (true) {
            val char = reader.read()
            if (char < 0) return if (line.isEmpty()) null else line.toString()
            if (char == '\n'.code) return line.toString().trimEnd('\r')
            if (line.length >= limit) throw GatewayFailure("response_too_large")
            line.append(char.toChar())
        }
    }
    override fun close() = synchronized(lifecycle) {
        jobs.keys.toList().forEach(::cancel)
        executor.shutdownNow()
        Unit
    }
    private class GatewayFailure(val code: String, val retryAfter: Int = 0, val quota: JSONObject? = null) : Exception(code)
    companion object {
        private val installLock = Any()
        private val loginLock = Any()
        private val LOGIN_CODE = Regex("^[A-Za-z0-9_-]{43}$")
        private const val ENCODING = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING

        private fun installToken(context: Context) = synchronized(installLock) {
            val state = context.getSharedPreferences("cortex-backend", Context.MODE_PRIVATE)
            state.getString("install", null) ?: Base64.encodeToString(
                ByteArray(32).also(SecureRandom()::nextBytes), ENCODING
            ).also { state.edit().putString("install", it).commit() }
        }

    }
}

/** AES-GCM encrypted bearer token in the Android Keystore. */
private class SecureSession(context: Context) {
    private val prefs = context.getSharedPreferences("cortex-token", Context.MODE_PRIVATE)
    private fun key(): SecretKey = synchronized(keyLock) {
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keystore.getKey("cortex-session-key", null) as? SecretKey)?.let { return@synchronized it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder("cortex-session-key", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        generator.generateKey()
    }
    @Synchronized fun put(token: String, name: String = "session") {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val combined = cipher.iv + cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString(name, Base64.encodeToString(combined, Base64.NO_WRAP)).commit()) {
            "Could not persist encrypted session"
        }
    }
    @Synchronized fun get(name: String = "session"): String? {
        val raw = prefs.getString(name, null) ?: return null
        return runCatching {
            val bytes = Base64.decode(raw, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
        }.getOrNull()
    }
    @Synchronized fun clear(name: String = "session") {
        check(prefs.edit().remove(name).commit()) { "Could not clear encrypted session" }
    }
    private companion object { val keyLock = Any() }
}
