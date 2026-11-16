package app.cortex.assistant

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.util.Base64

/** Opt-in reply playback. Gemini PCM is fetched from the authenticated CORTEX backend. */
internal class CortexVoiceOutput(context: Context) : AutoCloseable {
    private val bridge = CortexServerBridge(context.applicationContext)
    private val handler = Handler(Looper.getMainLooper())
    private var request: String? = null
    private var track: AudioTrack? = null
    private var generation = 0

    @Synchronized fun speak(text: String, complete: (Boolean) -> Unit) {
        stop()
        val turn = generation
        val normalized = text.replace(Regex("""[*_#\[\]<>]"""), "").trim().take(550)
        if (normalized.isBlank()) { handler.post { complete(false) }; return }
        request = bridge.speech(normalized) { response ->
            synchronized(this) {
                if (turn != generation) return@speech
                request = null
            }
            val encoded = response.optJSONObject("result")?.optString("audio").orEmpty()
            if (encoded.isEmpty()) { complete(false); return@speech }
            val pcm = runCatching { Base64.decode(encoded, Base64.NO_WRAP) }.getOrNull()
            if (pcm == null || pcm.isEmpty() || pcm.size % 2 != 0) { complete(false); return@speech }
            Thread({ play(turn, pcm, complete) }, "cortex-voice-playback").start()
        }
    }

    private fun play(turn: Int, pcm: ByteArray, complete: (Boolean) -> Unit) {
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
            val written = player.write(pcm, 0, pcm.size)
            if (written != pcm.size) return
            player.play()
            val frames = pcm.size / 2
            val deadline = System.currentTimeMillis() + frames * 1000L / 24_000L + 2500L
            while (System.currentTimeMillis() < deadline) {
                synchronized(this) { if (turn != generation) return }
                if (player.playbackHeadPosition >= frames) { success = true; break }
                Thread.sleep(45)
            }
        } catch (_: Exception) {
            // No untrusted audio data or provider messages are shown to the user.
        } finally {
            synchronized(this) { if (track === current) track = null }
            runCatching { current?.stop() }
            runCatching { current?.release() }
            handler.post { synchronized(this) { if (turn == generation) complete(success) } }
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
    }

    override fun close() {
        stop()
        bridge.close()
    }
}
