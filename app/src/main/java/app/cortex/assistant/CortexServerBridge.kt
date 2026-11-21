package app.cortex.assistant

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
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
    private var revocationAttemptedAt = 0L
    private val installId = installToken(context)
    private val deviceId = runCatching {
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
    }.getOrNull()?.takeIf { it.matches(Regex("^[a-f0-9]{16}$")) }
    private val endpoint = "https://jjcqrjztxohnifmziksy.supabase.co/functions/v1/cortex/v1/"
    private val cortexPackage = runCatching { context.packageManager.getPackageInfo(context.packageName,0) }.getOrNull()
    private val approvedApkSignature = CortexApkIntegrity.releaseSignerMatches(context)

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

    fun chat(payload: JSONObject, onEvent: (JSONObject) -> Unit, session: Long = sessionRevision(), done: (JSONObject) -> Unit): String {
        val id = UUID.randomUUID().toString()
        val request = JSONObject().put("operation", "chat").put("payload", payload)
        enqueue(id, request, onEvent, done, session)
        return id
    }

    fun speech(text: String, done: (JSONObject) -> Unit): String {
        val id = UUID.randomUUID().toString()
        enqueue(id, JSONObject().put("operation", "speech").put("text", text.take(550)), {}, done)
        return id
    }

    /** Streams signed 24 kHz mono PCM on the worker thread; no full-audio buffering. */
    fun speechPcmStream(text: String, onChunk: (ByteArray, Int) -> Unit, session: Long, done: (Boolean) -> Unit): String {
        val id = UUID.randomUUID().toString()
        val task = FutureTask<Unit> {
            var success = false
            try { success = streamSpeechBytes(text, id, session, onChunk) }
            catch (_: Exception) { /* Caller chooses the Android TTS fallback. */ }
            main.post { if (jobs.remove(id) != null) done(success && sessionScope.accepts(session)) }
        }
        val accepted = synchronized(lifecycle) {
            if (executor.isShutdown || jobs.size >= 19 || jobs.putIfAbsent(id, task) != null) false
            else try { executor.execute(task); true }
            catch (_: RejectedExecutionException) { jobs.remove(id, task); false }
        }
        if (!accepted) main.post { done(false) }
        return id
    }

    private fun streamSpeechBytes(text: String, id: String, session: Long, onChunk: (ByteArray, Int) -> Unit): Boolean {
        if (text.isBlank() || text.length > 550) return false
        val manager = context.getSystemService(ConnectivityManager::class.java)
        if (manager.getNetworkCapabilities(manager.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) != true) return false
        val connection = URL(endpoint + "speech").openConnection() as HttpURLConnection
        val buffer = ByteArray(4096)
        connections[id] = connection
        try {
            if (!jobs.containsKey(id)) return false
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8_000
            connection.readTimeout = 48_000
            connection.requestMethod = "POST"
            connection.setRequestProperty("Accept", "application/octet-stream")
            connection.setRequestProperty("X-Cortex-Audio-Stream", CortexAudioCodec.PCM_FORMAT)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("X-Cortex-Install", installId)
            if (approvedApkSignature) deviceId?.let { connection.setRequestProperty("X-Cortex-Device", it) }
            connection.setRequestProperty("X-Cortex-Version-Code", BuildConfig.VERSION_CODE.toString())
            bearer(session)?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            connection.doOutput = true
            val payload = JSONObject().put("text", text).toString().toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(payload.size)
            if (!sessionScope.accepts(session)) return false
            connection.outputStream.use { it.write(payload) }
            if (connection.responseCode !in 200..299 ||
                connection.getHeaderField("X-Cortex-Audio-Format") != CortexAudioCodec.PCM_FORMAT ||
                !connection.contentType.orEmpty().startsWith("application/octet-stream")) return false
            var size = 0
            var carry = 0
            connection.inputStream.use { input ->
                while (true) {
                    if (Thread.currentThread().isInterrupted || !jobs.containsKey(id) || !sessionScope.accepts(session)) return false
                    val read = input.read(buffer, carry, buffer.size - carry)
                    if (read < 0) break
                    if (!sessionScope.accepts(session)) return false
                    size += read
                    if (size > 2_400_000) return false
                    val available = read + carry
                    val even = available and -2
                    if (even > 0) onChunk(buffer, even)
                    carry = available - even
                    if (carry != 0) buffer[0] = buffer[even]
                }
            }
            return size > 0 && carry == 0
        } finally {
            buffer.fill(0.toByte())
            connections.remove(id, connection)
            connection.disconnect()
        }
    }

    fun status() {
        enqueue(UUID.randomUUID().toString(), JSONObject().put("operation", "status"), {}, {})
    }

    fun inbox(done: (JSONObject) -> Unit) {
        enqueue(UUID.randomUUID().toString(), JSONObject().put("operation", "support-inbox"), {}, done)
    }

    private fun enqueue(id: String, request: JSONObject, onEvent: (JSONObject) -> Unit, done: (JSONObject) -> Unit,
                        expectedSession: Long = sessionRevision()) {
        val operation = request.optString("operation")
        val session = expectedSession.takeUnless { operation.startsWith("auth-") }
        val updates = ChatUpdates(id, session, onEvent)
        val task = FutureTask<Unit> {
            val outcome = JSONObject()
            try {
                if (!sessionScope.accepts(session)) throw CortexSessionScope.Changed()
                if (operation != "logout") retryPendingRevocation(id)
                outcome.put("result", perform(request, id, session, updates::add))
            } catch (_: CortexSessionScope.Changed) {
                outcome.put("error", "session_changed")
            } catch (error: GatewayFailure) {
                outcome.put("error", error.code)
                if (error.retryAfter > 0) outcome.put("retry_after", error.retryAfter)
                error.quota?.let { outcome.put("quota", it) }
            } catch (_: SocketTimeoutException) {
                outcome.put("error", "timeout")
            } catch (_: Exception) {
                outcome.put("error", "offline")
            }
            main.post {
                if (jobs.remove(id) != null) done(if (operation == "logout" || sessionScope.accepts(session)) outcome
                    else JSONObject().put("error", "session_changed"))
            }
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

    private inner class ChatUpdates(val id: String, val session: Long?, val publish: (JSONObject) -> Unit) {
        private var pending = ArrayList<Any>()

        @Synchronized fun add(event: JSONObject) {
            if (!sessionScope.accepts(session)) throw CortexSessionScope.Changed()
            val wasEmpty = pending.isEmpty()
            val delta = event.opt("delta") as? String
            val tail = pending.lastOrNull()
            if (delta == null) pending.add(event)
            else if (tail is StringBuilder) tail.append(delta)
            else pending.add(StringBuilder(delta))
            if (wasEmpty) main.post { drain() }
        }

        private fun drain() {
            val batch = synchronized(this) { pending.also { pending = ArrayList() } }
            for (update in batch) {
                if (!jobs.containsKey(id) || !sessionScope.accepts(session)) return
                publish(if (update is JSONObject) update else JSONObject().put("delta", update.toString()))
            }
        }
    }

    fun cancel(id: String) {
        jobs.remove(id)?.let { task ->
            task.cancel(true)
            executor.remove(task)
        }
        connections.remove(id)?.let { socket -> Thread(socket::disconnect, "cortex-cancel").start() }
    }

    private fun perform(request: JSONObject, id: String, session: Long?, onEvent: (JSONObject) -> Unit): JSONObject {
        fun post(route: String) = call("POST", route, request.optJSONObject("payload") ?: throw GatewayFailure("invalid"), id, session = session)
        return when (request.optString("operation")) {
            "status" -> call("GET", "status", null, id, timeoutMs = 8_000, session = session)
            "subscription" -> call("GET", "subscription", null, id, session = session)
            "subscription-payment" -> post("subscription/payment")
            "presence" -> post("presence")
            "support-inbox" -> call("GET", "support/inbox", null, id, session = session)
            "support-ai" -> post("support/ai")
            "chat" -> call("POST", "chat", request.optJSONObject("payload") ?: throw GatewayFailure("invalid"), id, onEvent, session = session)
            "speech" -> speechBytes(request.optString("text"), id, session)
            "support" -> post("support")
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
                if (route == "reset") clearSession()
                result
            }
            "auth-cancel" -> synchronized(loginLock) { store.clear("login"); JSONObject().put("cancelled", true) }
            "logout" -> {
                val active = synchronized(loginLock) {
                    changeSession(session) {
                        store.detachForLogout().also { CortexScenarios.selectAccount(context, null) }
                    }
                }
                // Revoke only the bearer detached by this operation. A sign-in
                // that starts during the call must not be signed out.
                val revoked = active != null && runCatching {
                    call("DELETE", "session", null, id, bearerOverride = active, timeoutMs = 2500)
                }.isSuccess
                if (revoked) runCatching { store.removePendingRevocation(requireNotNull(active)) }
                JSONObject().put("ok", true).put("revocation_pending", active != null && !revoked)
            }
            else -> throw GatewayFailure("endpoint_missing")
        }
    }

    private fun adoptSession(result: JSONObject) {
        val token = result.remove("token") as? String
        if (result.optString("state") != "signed_in") return
        if (token == null || !LOGIN_CODE.matches(token)) throw GatewayFailure("auth_denied")
        changeSession {
            store.put(token)
            CortexScenarios.selectAccount(context, result.optJSONObject("account")?.optString("id"))
        }
        store.clear("login")
    }

    private fun bearer(session: Long?): String? = sessionScope.read(session) { store.get() }

    private fun <T> changeSession(expected: Long? = null, write: () -> T): T {
        val previous = sessionRevision()
        try {
            return sessionScope.advance(expected, write)
        } finally {
            if (previous != sessionRevision()) main.post { CortexRuntime.publishSessionChange() }
        }
    }

    private fun clearSession() = changeSession {
        store.clear()
        CortexScenarios.selectAccount(context, null)
    }

    private fun retryPendingRevocation(id: String) {
        val pending = synchronized(loginLock) {
            val now = android.os.SystemClock.elapsedRealtime()
            if (revocationAttemptedAt > 0L && now - revocationAttemptedAt < 60_000L) return
            val token = store.pendingRevocation() ?: return
            revocationAttemptedAt = now
            token
        }
        // This retry uses only the queued bearer and leaves a newly logged-in
        // account intact.
        if (runCatching { call("DELETE", "session", null, id, bearerOverride = pending, timeoutMs = 2500) }.isSuccess) {
            runCatching { store.removePendingRevocation(pending) }
        }
    }

    private fun call(method: String, route: String, payload: JSONObject?, id: String,
                     onEvent: ((JSONObject) -> Unit)? = null, bearerOverride: String? = null,
                     timeoutMs: Int? = null, session: Long? = null): JSONObject {
        val network = context.getSystemService(ConnectivityManager::class.java)
        val capabilities = network.getNetworkCapabilities(network.activeNetwork)
        if (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) != true) throw GatewayFailure("offline")
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
            // Detect accidental re-signing or tampering in an unmodified release.
            // A patched client can bypass this: server-side attestation is required.
            if (approvedApkSignature) deviceId?.let { connection.setRequestProperty("X-Cortex-Device", it) }
            connection.setRequestProperty("X-Cortex-Version-Code", cortexPackage?.versionCode?.toString() ?: BuildConfig.VERSION_CODE.toString())
            connection.setRequestProperty("X-Cortex-Version-Name", cortexPackage?.versionName ?: BuildConfig.VERSION_NAME)
            connection.setRequestProperty("Cache-Control", "no-store")
            val token = bearerOverride ?: bearer(session)
            if (!token.isNullOrEmpty()) connection.setRequestProperty("Authorization", "Bearer $token")
            if (!sessionScope.accepts(session)) throw CortexSessionScope.Changed()
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
                if (code == "sign_in" && bearerOverride == null && !token.isNullOrEmpty()) synchronized(loginLock) {
                    if (sessionScope.accepts(session) && store.get() == token) clearSession()
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
                        if (!sessionScope.accepts(session) || store.get() != token) throw CortexSessionScope.Changed()
                        val owner = it.optJSONObject("account")?.optString("id").orEmpty()
                        if (owner.isEmpty() && !token.isNullOrEmpty()) clearSession()
                        else if (CortexScenarios.currentOwner(context) != owner) changeSession {
                            CortexScenarios.selectAccount(context, owner)
                        }
                        it.optJSONObject("gate")?.let { gate ->
                            val verifiedSession = sessionRevision()
                            main.post {
                                if (jobs.containsKey(id) && sessionScope.accepts(verifiedSession)) CortexActionState.saveGate(context, gate)
                            }
                        }
                    }
                }
            }
        } finally {
            connections.remove(id, connection)
            connection.disconnect()
        }
    }

    private fun speechBytes(text: String, id: String, session: Long?): JSONObject {
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
            if (approvedApkSignature) deviceId?.let { connection.setRequestProperty("X-Cortex-Device", it) }
            connection.setRequestProperty("X-Cortex-Version-Code", BuildConfig.VERSION_CODE.toString())
            bearer(session)?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            connection.doOutput = true
            if (!sessionScope.accepts(session)) throw CortexSessionScope.Changed()
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
            when (val status = event.optString("status")) {
                "fallback", "web_search", "web_ready", "text_ready" -> onEvent(JSONObject().put("status", status))
            }
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
        private val sessionScope = CortexSessionScope()
        fun sessionRevision(): Long = sessionScope.revision
        fun <T> forSession(revision: Long, action: () -> T): T = sessionScope.read(revision, action)
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
    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val combined = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }
    @Synchronized fun put(token: String, name: String = "session") {
        check(prefs.edit().putString(name, encrypt(token)).commit()) {
            "Could not persist encrypted session"
        }
    }
    @Synchronized fun detachForLogout(): String? {
        val session = get()
        val editor = prefs.edit().remove("session").remove("login")
        if (session != null) {
            val pending = CortexRevocationQueue.append(pendingRevocations(), session)
            editor.putString("pending-revoke", encrypt(CortexRevocationQueue.encode(pending)))
        }
        check(editor.commit()) { "Could not detach encrypted session" }
        return session
    }
    @Synchronized fun pendingRevocation(): String? = pendingRevocations().firstOrNull()
    @Synchronized fun removePendingRevocation(token: String) {
        val pending = pendingRevocations()
        if (token !in pending) return
        val remaining = pending - token
        if (remaining.isEmpty()) clear("pending-revoke")
        else put(CortexRevocationQueue.encode(remaining), "pending-revoke")
    }
    private fun pendingRevocations(): List<String> = CortexRevocationQueue.decode(get("pending-revoke"))

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
