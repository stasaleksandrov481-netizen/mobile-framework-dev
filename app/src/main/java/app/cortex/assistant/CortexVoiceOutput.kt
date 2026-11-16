package app.cortex.assistant

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import java.util.Locale

/** Plays ephemeral server speech and falls back to Android speech on provider errors. */
internal class CortexVoiceOutput(context: Context) : AutoCloseable {
    private val applicationContext = context.applicationContext
    private val bridge = CortexServerBridge(applicationContext)
    private val handler = Handler(Looper.getMainLooper())
    private var request: String? = null
    private var track: AudioTrack? = null
    private var localTts: TextToSpeech? = null
    private var localTurn: Int? = null
    private var generation = 0

    @Synchronized fun speak(text: String, offlineOnly: Boolean = false, complete: (Boolean) -> Unit) {
        stop()
        val turn = generation
        val normalized = CortexFaces.speechText(text).replace(Regex("""[*_#\[\]<>]"""), "").trim().take(550)
        if (normalized.isBlank()) { handler.post { complete(false) }; return }
        if (offlineOnly) {
            useAndroidVoice(turn, normalized, complete, offlineOnly = true)
            return
        }
        request = bridge.speech(normalized) { response ->
            synchronized(this) {
                if (turn != generation || request == null) return@speech
                request = null
            }
            val encoded = response.optJSONObject("result")?.optString("audio").orEmpty()
            val format = response.optJSONObject("result")?.optString("audio_format")
                ?.takeIf { it.isNotBlank() } ?: CortexAudioCodec.PCM_FORMAT
            val wire = runCatching { Base64.decode(encoded, Base64.NO_WRAP) }.getOrNull()
            val pcm = when (format) {
                CortexAudioCodec.PCM_FORMAT -> wire
                CortexAudioCodec.ADPCM_FORMAT -> wire?.let { packed ->
                    CortexAudioCodec.decode(packed).also { packed.fill(0.toByte()) }
                }
                else -> null
            }
            if (pcm == null || pcm.isEmpty() || pcm.size % 2 != 0) {
                wire?.fill(0.toByte())
                pcm?.fill(0.toByte())
                useAndroidVoice(turn, normalized, complete)
                return@speech
            }
            Thread({ play(turn, pcm, normalized, complete) }, "cortex-voice-playback").start()
        }
        // A slow TTS provider must never leave a voice answer silent for 30+ seconds.
        handler.postDelayed({
            val stale = synchronized(this) {
                if (turn != generation) null else request.also { request = null }
            }
            if (stale != null) {
                bridge.cancel(stale)
                useAndroidVoice(turn, normalized, complete)
            }
        }, 4_500L)
    }

    private fun play(turn: Int, pcm: ByteArray, text: String, complete: (Boolean) -> Unit) {
        var current: AudioTrack? = null
        var success = false
        try {
            current = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(24_000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(pcm.size)
                .setTransferMode(AudioTrack.MODE_STATIC).build()
            synchronized(this) {
                if (turn != generation) return
                track = current
            }
            val player = current ?: return
            if (player.write(pcm, 0, pcm.size) != pcm.size) return
            player.play()
            val frames = pcm.size / 2
            val deadline = System.currentTimeMillis() + frames * 1000L / 24_000L + 2500L
            while (System.currentTimeMillis() < deadline) {
                synchronized(this) { if (turn != generation) return }
                if (player.playbackHeadPosition >= frames) { success = true; break }
                Thread.sleep(45)
            }
        } catch (_: Exception) {
            // Untrusted audio bytes should not crash the assistant.
        } finally {
            synchronized(this) { if (track === current) track = null }
            runCatching { current?.stop() }
            runCatching { current?.release() }
            // Previous spoken responses must not remain readable in retained memory.
            pcm.fill(0.toByte())
            handler.post {
                synchronized(this) {
                    if (turn != generation) return@post
                }
                if (success) complete(true) else useAndroidVoice(turn, text, complete)
            }
        }
    }

    private fun useAndroidVoice(turn: Int, text: String, complete: (Boolean) -> Unit, offlineOnly: Boolean = false) {
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
                        val language = if (text.any { it in 'А'..'я' || it == 'ё' || it == 'Ё' }) Locale.forLanguageTag("ru-RU") else Locale.ENGLISH
                        if (offlineOnly) {
                            val localVoice = runCatching { voice.voices?.firstOrNull {
                                !it.isNetworkConnectionRequired && it.locale.language == language.language && "notInstalled" !in it.features
                            } }.getOrNull()
                            if (localVoice == null || voice.setVoice(localVoice) != TextToSpeech.SUCCESS) {
                                finishAndroidVoice(turn, false, complete)
                                return@post
                            }
                        } else {
                            val preferred = runCatching { voice.setLanguage(language) }
                                .getOrDefault(TextToSpeech.LANG_NOT_SUPPORTED)
                            if (preferred == TextToSpeech.LANG_MISSING_DATA || preferred == TextToSpeech.LANG_NOT_SUPPORTED) {
                                val fallback = runCatching { voice.setLanguage(Locale.getDefault()) }
                                    .getOrDefault(TextToSpeech.LANG_NOT_SUPPORTED)
                                if (fallback == TextToSpeech.LANG_NOT_SUPPORTED || fallback == TextToSpeech.LANG_MISSING_DATA) {
                                    finishAndroidVoice(turn, false, complete)
                                    return@post
                                }
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
        stop()
        bridge.close()
    }
}
