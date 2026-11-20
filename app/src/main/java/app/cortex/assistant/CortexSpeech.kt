package app.cortex.assistant

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import org.json.JSONObject

/** Voice input while the app is foregrounded. */
class CortexSpeech(private val activity: Activity, private val emit: (JSONObject) -> Unit) {
    private class Session(val id: String, val language: String, val dictation: Boolean) {
        var ready = false
        var heardSpeech = false
        var finishing = false
        var partial = ""
        var lastLevelAt = 0L
    }

    private val ui = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var active: Session? = null

    private fun voice(session: Session, phase: String, text: String? = null, level: Double? = null) {
        val event = JSONObject().put("type", "voice").put("id", session.id).put("phase", phase)
        if (text != null) event.put("text", text)
        if (level != null) event.put("level", level)
        emit(event)
    }

    fun listen(id: String, language: String, dictation: Boolean) {
        stop()
        val session = Session(id, if (language == "en-US") language else "ru-RU", dictation)
        active = session
        CortexRuntime.recording = true
        val offline = !dictation && Build.VERSION.SDK_INT >= 31 &&
            runCatching { SpeechRecognizer.isOnDeviceRecognitionAvailable(activity) }.getOrDefault(false)
        // The wake service releases its AudioRecord synchronously. Give the system
        // recognizer a short handover on phones that still report a held microphone.
        if (CortexRuntime.wakeHook != null) ui.postDelayed({ begin(session, offline) }, 100L)
        else begin(session, offline)
    }

    private fun begin(session: Session, offline: Boolean) {
        if (active !== session) return
        session.ready = false
        try {
            if (!offline && !SpeechRecognizer.isRecognitionAvailable(activity)) {
                fail(session, "На устройстве нет доступного распознавания речи.")
                return
            }
            val instance = if (offline && Build.VERSION.SDK_INT >= 31)
                SpeechRecognizer.createOnDeviceSpeechRecognizer(activity) else SpeechRecognizer.createSpeechRecognizer(activity)
            recognizer = instance
            instance.setRecognitionListener(object : RecognitionListener {
                private fun current() = active === session && recognizer === instance

                override fun onReadyForSpeech(params: Bundle?) {
                    if (!current() || session.heardSpeech || session.finishing) return
                    session.ready = true
                    voice(session, "ready")
                }

                override fun onBeginningOfSpeech() {
                    if (!current() || session.finishing) return
                    session.heardSpeech = true
                    voice(session, "hearing")
                }

                override fun onRmsChanged(rmsdB: Float) {
                    if (!current() || !session.ready || session.finishing || !rmsdB.isFinite()) return
                    val now = SystemClock.uptimeMillis()
                    if (now - session.lastLevelAt < 50L) return
                    session.lastLevelAt = now
                    voice(session, "level", level = ((rmsdB + 2) / 16).coerceIn(0f, 1f).toDouble())
                }

                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() { if (current()) finishing(session) }

                override fun onError(error: Int) {
                    if (!current()) return
                    if (offline && !session.heardSpeech && !session.finishing && error in OFFLINE_UNAVAILABLE) {
                        fallback(session)
                        return
                    }
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        finishWithoutFinal(session)
                    } else {
                        fail(session, if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS)
                            "Разрешите микрофон CORTEX в Android."
                        else "Распознавание речи не завершилось. Попробуйте снова.")
                    }
                }

                override fun onResults(results: Bundle?) {
                    if (!current()) return
                    val text = hypothesis(results)
                    if (text.isEmpty()) finishWithoutFinal(session) else result(session, text)
                }

                override fun onPartialResults(partialResults: Bundle?) {
                    if (!current()) return
                    val text = hypothesis(partialResults)
                    if (text.isEmpty() || text == session.partial) return
                    if (!session.ready && !session.heardSpeech && !session.finishing) voice(session, "hearing")
                    session.heardSpeech = true
                    session.partial = text
                    voice(session, "partial", text)
                }

                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            instance.startListening(recognitionIntent(session, offline))
            ui.postDelayed({
                if (active === session && recognizer === instance && !session.ready &&
                    !session.heardSpeech && !session.finishing) {
                    if (offline) fallback(session) else fail(session, "Не удалось подключить микрофон.")
                }
            }, if (offline) 3_000L else 6_000L)
        } catch (_: Exception) {
            if (offline) fallback(session) else fail(session, "Android не разрешил запустить микрофон.")
        }
    }

    private fun recognitionIntent(session: Session, offline: Boolean) =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, session.language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
                if (session.dictation) 1_600L else 900L)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, offline)
            if (Build.VERSION.SDK_INT >= 33) {
                putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_LATENCY)
                putExtra(RecognizerIntent.EXTRA_HIDE_PARTIAL_TRAILING_PUNCTUATION, true)
                if (!session.dictation) putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS,
                    arrayListOf(if (session.language == "en-US") "Cortex" else "Кортекс"))
            }
        }

    private fun hypothesis(bundle: Bundle?): String =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
            .firstOrNull { it.isNotBlank() }?.trim()?.take(6_000).orEmpty()

    private fun fallback(session: Session) {
        disposeRecognizer()
        ui.post { begin(session, false) }
    }

    private fun finishing(session: Session) {
        if (session.finishing) return
        session.finishing = true
        voice(session, "finishing")
        ui.postDelayed({ if (active === session) finishWithoutFinal(session) }, 5_000L)
    }

    private fun finishWithoutFinal(session: Session) {
        // A partial can remain as editable dictation. Conversation and Android
        // actions only accept a final recognizer result.
        if (session.dictation && session.partial.isNotBlank()) result(session, session.partial)
        else fail(session, "Речь не распознана. Попробуйте ещё раз.")
    }

    private fun result(session: Session, text: String) {
        stop()
        voice(session, "result", text)
    }

    private fun fail(session: Session, message: String) {
        stop()
        voice(session, "error", message)
    }

    fun finish(id: String) {
        val session = active?.takeIf { it.id == id && !it.finishing } ?: return
        finishing(session)
        runCatching { recognizer?.stopListening() }.onFailure { finishWithoutFinal(session) }
    }

    fun cancel(id: String?) { if (id == null || active?.id == id) stop() }

    private fun disposeRecognizer() {
        val previous = recognizer
        recognizer = null
        runCatching { previous?.cancel() }
        runCatching { previous?.destroy() }
    }

    fun stop() {
        active = null
        ui.removeCallbacksAndMessages(null)
        disposeRecognizer()
        CortexRuntime.recording = false
    }

    private companion object {
        val OFFLINE_UNAVAILABLE = setOf(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
            SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_CLIENT, SpeechRecognizer.ERROR_RECOGNIZER_BUSY)
    }

    fun close() = stop()
}
