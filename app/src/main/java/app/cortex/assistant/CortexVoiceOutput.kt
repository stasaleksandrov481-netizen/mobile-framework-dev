package app.cortex.assistant

import android.content.Context
import android.content.SharedPreferences
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
    private var request: String? = null
    private var track: AudioTrack? = null
    private var localTts: TextToSpeech? = null
    private var localTurn: Int? = null
    private var generation = 0
    private var streamedFrames = 0
    private var streamStarted = false

    init { options.registerOnSharedPreferenceChangeListener(speechSetting) }

    @Synchronized fun speak(text: String, complete: (Boolean) -> Unit) {
        stop()
        if (!options.getBoolean("voiceReplies", true)) { handler.post { complete(false) }; return }
        val turn = generation
        val normalized = text.replace(Regex("""[*_#\[\]<>]"""), "").trim().take(550)
        if (normalized.isBlank()) { handler.post { complete(false) }; return }
        if (BuildConfig.DEBUG) {
            useAndroidVoice(turn, normalized, complete)
            return
        }
        streamedFrames = 0
        streamStarted = false
        request = bridge.speechPcmStream(normalized, { bytes, count ->
            writeStreamChunk(turn, bytes, count)
        }) { ok ->
            synchronized(this) {
                if (turn != generation || request == null) return@speechPcmStream
                request = null
            }
            val started = synchronized(this) { streamStarted }
            if (ok && started) waitForPlayback(turn, complete)
            else if (!started) {
                releaseStreamPlayer(turn)
                useAndroidVoice(turn, normalized, complete)
            } else {
                // A partial cloud sentence already played. Do not repeat it via local TTS.
                releaseStreamPlayer(turn)
                complete(false)
            }
        }
        // Only fall back when no first chunk arrives; never cut off live streaming audio.
        handler.postDelayed({
            val stale = synchronized(this) {
                if (turn != generation || streamStarted) null else request.also { request = null }
            }
            if (stale != null) {
                bridge.cancel(stale)
                useAndroidVoice(turn, normalized, complete)
            }
        }, 10_000L)
    }

    private fun writeStreamChunk(turn: Int, pcm: ByteArray, count: Int) {
        try {
            val player = synchronized(this) {
                if (turn != generation) return
                track ?: AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(24_000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setBufferSizeInBytes(maxOf(8192, AudioTrack.getMinBufferSize(24_000,
                        AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT) * 2))
                    .setTransferMode(AudioTrack.MODE_STREAM).build().also {
                        track = it
                        it.play()
                        streamStarted = true
                    }
            }
            var written = 0
            while (written < count) {
                synchronized(this) { if (turn != generation || track !== player) return }
                val next = player.write(pcm, written, count - written)
                if (next <= 0) throw IllegalStateException("AudioTrack stream rejected samples")
                written += next
            }
            synchronized(this) { if (turn == generation) streamedFrames += written / 2 }
        } finally {
            pcm.fill(0.toByte())
        }
    }

    private fun waitForPlayback(turn: Int, complete: (Boolean) -> Unit) {
        val player = synchronized(this) { if (turn == generation) track else null }
        if (player == null) { complete(false); return }
        val frameCount = synchronized(this) { streamedFrames }
        val deadline = System.currentTimeMillis() + frameCount * 1000L / 24_000L + 2500L
        fun poll() {
            synchronized(this) { if (turn != generation) return }
            if (player.playbackHeadPosition >= frameCount) {
                synchronized(this) { if (track === player) track = null }
                runCatching { player.stop() }
                runCatching { player.release() }
                complete(true)
            } else if (System.currentTimeMillis() >= deadline) {
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
            if (turn != generation) return
            track.also { track = null }
        }
        runCatching { old?.pause() }
        runCatching { old?.flush() }
        runCatching { old?.release() }
    }

    private fun useAndroidVoice(turn: Int, text: String, complete: (Boolean) -> Unit) {
        handler.post {
            synchronized(this) {
                if (turn != generation || localTurn == turn) return@post
                localTurn = turn
            }
            try {
                val engine = TextToSpeech(applicationContext) { status ->
                    handler.post {
                        val voice = synchronized(this) {
                            if (turn == generation && localTurn == turn) localTts else null
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
                        voice.setAudioAttributes(AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANT)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                        voice.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                            override fun onStart(utteranceId: String) = Unit
                            override fun onDone(utteranceId: String) {
                                if (utteranceId == "cortex-$turn") finishAndroidVoice(turn, true, complete)
                            }
                            override fun onError(utteranceId: String) {
                                if (utteranceId == "cortex-$turn") finishAndroidVoice(turn, false, complete)
                            }
                            override fun onError(utteranceId: String, errorCode: Int) = onError(utteranceId)
                        })
                        val started = voice.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), "cortex-$turn")
                        if (started == TextToSpeech.ERROR) finishAndroidVoice(turn, false, complete)
                    }
                }
                synchronized(this) {
                    if (turn == generation && localTurn == turn) localTts = engine
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
                if (turn != generation || localTurn != turn) return@post
                localTurn = null
                localTts.also { localTts = null }
            }
            runCatching { engine?.stop() }
            runCatching { engine?.shutdown() }
            complete(ok)
        }
    }

    @Synchronized fun stop() {
        ++generation
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
