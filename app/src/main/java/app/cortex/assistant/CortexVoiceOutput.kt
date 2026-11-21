package app.cortex.assistant

import android.content.Context
import android.content.SharedPreferences
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/** Plays ephemeral server speech and falls back to Android speech on provider errors. */
internal class CortexVoiceOutput(context: Context) : AutoCloseable {
    private val applicationContext = context.applicationContext
    private val bridge = CortexServerBridge(applicationContext)
    private val options = applicationContext.getSharedPreferences("cortex-display", Context.MODE_PRIVATE)
    private val speechSetting = SharedPreferences.OnSharedPreferenceChangeListener { prefs, name ->
        if (name == "voiceReplies" && !prefs.getBoolean(name, true)) stop()
    }
    private val handler = Handler(Looper.getMainLooper())
    private val audio = applicationContext.getSystemService(AudioManager::class.java)
    // Duck music and podcasts while CORTEX speaks, like other voice assistants;
    // without focus a reply played at full volume on top of the user's media.
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setOnAudioFocusChangeListener({ }, handler)
        .build()
    private var request: String? = null
    private var track: AudioTrack? = null
    private var localTts: TextToSpeech? = null
    private var localTurn: Int? = null
    private var generation = 0
    private var session = -1L
    private var streamedFrames = 0
    private var streamStarted = false

    init { options.registerOnSharedPreferenceChangeListener(speechSetting) }

    @Synchronized fun speak(text: String, started: () -> Unit = {}, revision: Long = CortexServerBridge.sessionRevision(),
                            done: (Boolean) -> Unit) {
        if (revision != CortexServerBridge.sessionRevision()) { handler.post { done(false) }; return }
        stop()
        if (!options.getBoolean("voiceReplies", true)) { handler.post { done(false) }; return }
        val turn = generation
        session = revision
        val normalized = text.replace(Regex("""[*_#\[\]<>]"""), "").trim().take(550)
        if (normalized.isBlank()) { handler.post { done(false) }; return }
        // Speaking without focus is still better than staying silent, so the result is ignored.
        CortexRuntime.setVoicePlaying(this, true)
        runCatching { audio?.requestAudioFocus(focus) }
        val complete: (Boolean) -> Unit = { ok ->
            if (synchronized(this) { current(turn) }) {
                releaseFocus()
                done(ok)
            }
        }
        val notifyStarted = {
            handler.post { if (synchronized(this) { current(turn) }) started() }
            Unit
        }
        if (BuildConfig.DEBUG) {
            useAndroidVoice(turn, normalized, notifyStarted, complete)
            return
        }
        streamedFrames = 0
        streamStarted = false
        request = bridge.speechPcmStream(normalized, { bytes, count ->
            if (writeStreamChunk(turn, bytes, count)) notifyStarted()
        }, session = revision) { ok ->
            synchronized(this) {
                if (!current(turn) || request == null) return@speechPcmStream
                request = null
            }
            val started = synchronized(this) { streamStarted }
            if (ok && started) waitForPlayback(turn, complete)
            else if (!started) {
                releaseStreamPlayer(turn)
                useAndroidVoice(turn, normalized, notifyStarted, complete)
            } else {
                // A partial cloud sentence already played. Do not repeat it via local TTS.
                releaseStreamPlayer(turn)
                complete(false)
            }
        }
        // Only fall back when no first chunk arrives; never cut off live streaming audio.
        handler.postDelayed({
            val stale = synchronized(this) {
                if (!current(turn) || streamStarted) null else request.also { request = null }
            }
            if (stale != null) {
                bridge.cancel(stale)
                releaseStreamPlayer(turn)
                useAndroidVoice(turn, normalized, notifyStarted, complete)
            }
        }, 10_000L)
    }

    private fun writeStreamChunk(turn: Int, pcm: ByteArray, count: Int): Boolean {
        val player = synchronized(this) {
            if (!current(turn) || request == null) return false
            track ?: AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(24_000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(maxOf(8192, AudioTrack.getMinBufferSize(24_000,
                    AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT) * 2))
                .setTransferMode(AudioTrack.MODE_STREAM).build().also {
                    track = it
                    if (Build.VERSION.SDK_INT >= 31) runCatching {
                        it.setStartThresholdInFrames(minOf(it.bufferSizeInFrames, 1_920))
                    }
                    it.play()
                }
        }
        var written = 0
        var first = false
        while (written < count) {
            synchronized(this) { if (!current(turn) || track !== player) return false }
            val next = player.write(pcm, written, count - written)
            if (next <= 0) throw IllegalStateException("AudioTrack stream rejected samples")
            written += next
            synchronized(this) {
                if (!current(turn) || track !== player) return false
                streamedFrames += next / 2
                if (!streamStarted) {
                    streamStarted = true
                    first = true
                }
            }
        }
        return first
    }

    private fun waitForPlayback(turn: Int, complete: (Boolean) -> Unit) {
        val player = synchronized(this) { if (current(turn)) track else null }
        if (player == null) { complete(false); return }
        val frameCount = synchronized(this) { streamedFrames }
        if (Build.VERSION.SDK_INT >= 31 && frameCount in 1 until 1_920) runCatching {
            player.setStartThresholdInFrames(minOf(frameCount, player.bufferSizeInFrames))
        }
        val deadline = SystemClock.elapsedRealtime() + frameCount * 1000L / 24_000L + 2500L
        fun poll() {
            synchronized(this) { if (!current(turn)) return }
            if (player.playbackHeadPosition >= frameCount) {
                synchronized(this) { if (track === player) track = null }
                runCatching { player.stop() }
                runCatching { player.release() }
                complete(true)
            } else if (SystemClock.elapsedRealtime() >= deadline) {
                // Part of the sentence has played; do not repeat it via Android TTS.
                releaseStreamPlayer(turn)
                complete(false)
            } else {
                handler.postDelayed({ poll() }, 45L)
            }
        }
        poll()
    }

    private fun releaseStreamPlayer(turn: Int) {
        val old = synchronized(this) {
            if (!current(turn)) return
            track.also { track = null }
        }
        runCatching { old?.pause() }
        runCatching { old?.flush() }
        runCatching { old?.release() }
    }

    private fun useAndroidVoice(turn: Int, text: String, started: () -> Unit, complete: (Boolean) -> Unit) {
        handler.post {
            synchronized(this) {
                if (!current(turn) || localTurn == turn) return@post
                localTurn = turn
            }
            try {
                val engine = TextToSpeech(applicationContext) { status ->
                    handler.post {
                        val voice = synchronized(this) {
                            if (current(turn) && localTurn == turn) localTts else null
                        } ?: return@post
                        if (status != TextToSpeech.SUCCESS) {
                            finishAndroidVoice(turn, false, complete)
                            return@post
                        }
                        val russian = runCatching { voice.setLanguage(Locale.forLanguageTag("ru-RU")) }
                            .getOrDefault(TextToSpeech.LANG_NOT_SUPPORTED)
                        if (russian == TextToSpeech.LANG_MISSING_DATA || russian == TextToSpeech.LANG_NOT_SUPPORTED) {
                            val fallback = runCatching { voice.setLanguage(Locale.getDefault()) }
                                .getOrDefault(TextToSpeech.LANG_NOT_SUPPORTED)
                            if (fallback == TextToSpeech.LANG_NOT_SUPPORTED || fallback == TextToSpeech.LANG_MISSING_DATA) {
                                finishAndroidVoice(turn, false, complete)
                                return@post
                            }
                        }
                        // Stay close to the cloud voice (male): pick a male Russian system voice when the engine names one.
                        runCatching {
                            val voices = voice.voices.orEmpty()
                            val online = applicationContext.getSystemService(android.net.ConnectivityManager::class.java)?.activeNetwork != null
                            CortexVoicePick.choose(voices.map {
                                CortexVoicePick.Candidate(it.name, it.locale,
                                    TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features, it.isNetworkConnectionRequired)
                            }, online)?.let { chosen -> voices.firstOrNull { it.name == chosen.name }?.let { voice.voice = it } }
                        }
                        voice.setAudioAttributes(AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANT)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                        voice.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                            override fun onStart(utteranceId: String) {
                                if (utteranceId == "cortex-$turn") started()
                            }
                            override fun onDone(utteranceId: String) {
                                if (utteranceId == "cortex-$turn") finishAndroidVoice(turn, true, complete)
                            }
                            override fun onError(utteranceId: String) {
                                if (utteranceId == "cortex-$turn") finishAndroidVoice(turn, false, complete)
                            }
                            override fun onError(utteranceId: String, errorCode: Int) = onError(utteranceId)
                        })
                        val queued = voice.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), "cortex-$turn")
                        if (queued == TextToSpeech.ERROR) finishAndroidVoice(turn, false, complete)
                    }
                }
                synchronized(this) {
                    if (current(turn) && localTurn == turn) localTts = engine
                    else runCatching { engine.shutdown() }
                }
                handler.postDelayed({ finishAndroidVoice(turn, false, complete) }, 75_000L)
            } catch (_: Exception) {
                finishAndroidVoice(turn, false, complete)
            }
        }
    }

    private fun finishAndroidVoice(turn: Int, ok: Boolean, complete: (Boolean) -> Unit) {
        handler.post {
            val engine = synchronized(this) {
                if (!current(turn) || localTurn != turn) return@post
                localTurn = null
                localTts.also { localTts = null }
            }
            runCatching { engine?.stop() }
            runCatching { engine?.shutdown() }
            complete(ok)
        }
    }

    private fun releaseFocus() {
        CortexRuntime.setVoicePlaying(this, false)
        runCatching { audio?.abandonAudioFocusRequest(focus) }
    }

    private fun current(turn: Int) = turn == generation && session == CortexServerBridge.sessionRevision()

    @Synchronized fun stop() {
        ++generation
        session = -1L
        handler.removeCallbacksAndMessages(null)
        releaseFocus()
        request?.let(bridge::cancel)
        request = null
        val previous = track
        track = null
        streamedFrames = 0
        streamStarted = false
        runCatching { previous?.pause() }
        runCatching { previous?.flush() }
        runCatching { previous?.release() }
        val voice = localTts
        localTts = null
        localTurn = null
        runCatching { voice?.stop() }
        runCatching { voice?.shutdown() }
    }

    override fun close() {
        options.unregisterOnSharedPreferenceChangeListener(speechSetting)
        stop()
        bridge.close()
    }
}
