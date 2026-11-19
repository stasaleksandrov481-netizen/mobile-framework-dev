package app.cortex.assistant

import android.content.Context
import android.content.Intent
import android.provider.Settings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Process-owned local session. Activity recreation cannot duplicate or abandon its cleanup. */
internal object CortexFirstExperience {
    private const val STORE = "cortex-first-experience"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null
    private var number: CompletableDeferred<Int>? = null
    private var phase = "idle"
    private var session = UUID.randomUUID().toString()
    private var message = ""
    private var manualOffer = false
    private var recoveryAcknowledged = false
    private var stopReason = "Знакомство остановлено."
    private var exampleDone = false
    private var brightnessDone = false
    private var predictionDone = false
    private val notices = mutableListOf<String>()
    var listener: ((JSONObject) -> Unit)? = null

    private fun reason(context: Context): String? = when {
        FirstExperienceBrightness.hasPending(context) -> "Сначала нужно восстановить настройки яркости."
        CortexActionState.gate != "open" -> CortexActionState.gateMessage()
        CortexScreenService.connected == null -> "Служба управления экраном не подключена. Если доступ уже включён, дождитесь подключения или перезапустите CORTEX."
        !Settings.canDrawOverlays(context) -> "Разрешите показ островка поверх других приложений."
        !CortexIslandService.allowedInOrientation(context) -> "Поверните телефон вертикально для знакомства с CORTEX."
        CortexScreenService.connected?.locked() != false -> "Разблокируйте телефон для знакомства с CORTEX."
        CortexRuntime.recording -> "Сначала завершите голосовой ввод."
        CortexActionState.busy && !CortexRuntime.firstExperienceActive -> "Сначала завершите текущую задачу CORTEX."
        else -> null
    }

    fun snapshot(context: Context, manual: Boolean = false): JSONObject {
        val store = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val why = if (CortexRuntime.firstExperienceActive) null else reason(context)
        val recovery = FirstExperienceBrightness.hasPending(context) && !CortexRuntime.firstExperienceActive && !recoveryAcknowledged
        val offer = phase == "idle" && (manual || manualOffer || store.getBoolean("configured", false) && !store.getBoolean("handled", false) && why == null)
        return JSONObject().put("type", "first-experience").put("phase", if (recovery) "stopped" else if (offer) "offer" else phase)
            .put("session", session).put("active", CortexRuntime.firstExperienceActive)
            .put("ready", why == null).put("message", if (recovery) "Нужно восстановить исходную яркость после прерванного знакомства."
                else if (offer) why.orEmpty() else message)
            .put("accessibility", CortexScreenService.connected != null).put("overlay", Settings.canDrawOverlays(context))
            .put("brightnessPermission", Settings.System.canWrite(context))
            .put("recoveryNeeded", FirstExperienceBrightness.hasPending(context))
            .put("exampleDone", exampleDone).put("brightnessDone", brightnessDone).put("predictionDone", predictionDone)
            .put("notices", JSONArray(notices))
    }

    fun handle(context: Context, body: JSONObject) {
        val app = context.applicationContext
        when (body.optString("operation")) {
            "first-experience-state" -> emit(app)
            "first-experience-configured" -> {
                app.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putBoolean("configured", true).apply()
                emit(app)
            }
            "first-experience-offer" -> {
                if (!CortexRuntime.firstExperienceActive) manualOffer = true
                listener?.invoke(snapshot(app, manual = true))
            }
            "first-experience-later" -> if (!CortexRuntime.firstExperienceActive) {
                app.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putBoolean("handled", true).apply()
                manualOffer = false; phase = "idle"; message = ""; emit(app)
            }
            "first-experience-start" -> start(app)
            "first-experience-number" -> if (validSession(body) && phase == "number" && CortexRuntime.appVisible) {
                val raw = body.optString("number")
                if (Regex("[1-9][0-9]?").matches(raw)) number?.complete(raw.toInt())
            }
            "first-experience-stop" -> if (validSession(body)) stop("Знакомство остановлено.")
            "first-experience-finish" -> if (validSession(body) && !CortexRuntime.firstExperienceActive) {
                recoveryAcknowledged = true
                phase = if (phase == "reveal") "finish" else "idle"
                message = ""; emit(app)
            }
            "first-experience-recover" -> if (!CortexRuntime.firstExperienceActive) {
                message = if (FirstExperienceBrightness.restorePending(app)) "Исходные настройки яркости восстановлены."
                    else "Android не разрешил восстановить яркость. Разрешите изменение системных настроек или откройте настройки дисплея."
                emit(app)
            }
        }
    }

    private fun validSession(body: JSONObject) = session.isNotBlank() && body.optString("session") == session
    private fun emit(context: Context) { listener?.invoke(snapshot(context)) }
    fun availabilityChanged(context: Context) { emit(context.applicationContext) }
    private fun report(context: Context, text: String) {
        message = text
        CortexActionState.report(context, "executing", text)
        emit(context)
    }
    private fun state(context: Context, next: String, text: String) {
        phase = next
        report(context, text)
    }
    private fun skip(context: Context, text: String) { notices += text; report(context, text) }

    fun stop(text: String = "Знакомство остановлено.") {
        stopReason = text
        job?.cancel()
    }

    private fun start(context: Context) {
        if (CortexRuntime.firstExperienceActive) { emit(context); return }
        val why = reason(context)
        if (why != null) { manualOffer = true; listener?.invoke(snapshot(context, manual = true).put("message", why)); return }
        if (!CortexActionState.acquire { stop() }) {
            listener?.invoke(snapshot(context, manual = true).put("message", "Сначала завершите текущую задачу CORTEX.")); return
        }
        val handled = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putBoolean("handled", true).commit()
        if (!handled) {
            CortexActionState.report(context, "stopped", "Не удалось сохранить состояние знакомства.")
            listener?.invoke(snapshot(context, manual = true).put("message", "Не удалось сохранить состояние знакомства.")); return
        }
        session = UUID.randomUUID().toString()
        manualOffer = false
        recoveryAcknowledged = false
        exampleDone = false; brightnessDone = false; predictionDone = false; notices.clear()
        stopReason = "Знакомство остановлено."
        CortexRuntime.firstExperienceActive = true
        phase = "running"
        number = CompletableDeferred()
        job = scope.launch(start = CoroutineStart.LAZY) {
            var monitor: Job? = null
            try {
                report(context, "Передаю управление CORTEX")
                if (!CortexIslandService.beginFirstExperience(context, session) || withTimeoutOrNull(4_500L) {
                        while (!CortexIslandService.firstExperienceReady(session)) delay(60L)
                        true
                    } != true) throw IllegalStateException("Android не показал островок с кнопкой остановки.")
                monitor = launch {
                    while (isActive) {
                        delay(180L)
                        val screen = CortexScreenService.connected
                        val failure = FirstExperienceHealth.failure(connected = screen != null,
                            unlocked = screen?.locked() == false, overlay = Settings.canDrawOverlays(context),
                            orientation = CortexIslandService.allowedInOrientation(context),
                            islandAvailable = CortexIslandService.firstExperienceAvailable(session))
                        if (failure != null) {
                            CortexActionState.log(context, failure.message)
                            stop(failure.message)
                        }
                    }
                }
                withTimeout(300_000L) { demonstrate(context) }
            } catch (_: TimeoutCancellationException) {
                phase = "stopped"; message = "Время знакомства истекло. Его можно повторить в настройках."
            } catch (_: CancellationException) {
                phase = "stopped"; message = stopReason
            } catch (error: FirstExperienceBrightness.RestoreFailed) {
                phase = "stopped"; message = error.message.orEmpty()
            } catch (_: Exception) {
                phase = "stopped"; message = "Действие недоступно на этом телефоне. Знакомство остановлено."
            } finally {
                monitor?.cancel()
                withContext(NonCancellable) {
                    val restored = FirstExperienceBrightness.restorePending(context)
                    if (!restored) { phase = "stopped"; message = "Нужно восстановить яркость. Разрешите изменение системных настроек или откройте настройки дисплея." }
                    CortexScreenService.connected?.stopTouch()
                    number?.cancel(); number = null
                    // Keep the task slot until ALL restoration has completed.
                    CortexActionState.report(context, if (phase == "stopped") "stopped" else "done", message)
                    CortexRuntime.firstExperienceActive = false
                    CortexIslandService.endFirstExperience(session)
                    if (phase == "stopped" && CortexScreenService.connected?.locked() == false) returnToApp(context)
                    emit(context)
                }
            }
        }
        job?.start()
    }

    private suspend fun demonstrate(context: Context) {
        val service = CortexScreenService.connected ?: throw IllegalStateException()
        val calculator = FirstExperienceCalculator(context, service) { report(context, it) }
        delay(FirstExperienceTempo.BEFORE_ACTION)
        if (calculator.open() && calculator.clear()) {
            report(context, "Вычисляю")
            exampleDone = calculator.calculate(FirstExperienceMath.example)
        }
        if (exampleDone) {
            report(context, "Готово"); delay(900L)
            report(context, "Это сделал не ты."); delay(2_200L)
        } else {
            skip(context, "Не удалось подтвердить результат в калькуляторе. Пропускаю этот фокус.")
            delay(FirstExperienceTempo.BEFORE_ACTION)
        }
        report(context, "А теперь немного магии с экраном."); delay(FirstExperienceTempo.BEFORE_ACTION)
        val brightness = FirstExperienceBrightness(context, service).run()
        brightnessDone = brightness.performed
        if (brightness.performed) report(context, brightness.message) else skip(context, brightness.message)
        delay(FirstExperienceTempo.RESULT)
        if (!returnToApp(context)) throw IllegalStateException()
        // The first calculation's failure is not a permanent calculator capability verdict.
        // Always show the number prompt; prediction gets a fresh launch, clear and verification.
        state(context, "number", "Последний фокус. Проверим, умею ли я предсказывать результат?")
        val selected = withTimeout(120_000L) { requireNotNull(number).await() }
        state(context, "sealed", "Мой прогноз уже сделан.")
        delay(FirstExperienceTempo.SEALED)
        phase = "running"
        if (!calculator.open() || !calculator.clear()) {
            skip(context, "Калькулятор недоступен. Пропускаю предсказание.")
            returnToApp(context); phase = "finish"; return
        }
        val confirmed = FirstExperienceMath.performPrediction(selected) { index, calculation ->
            val action = listOf("Умножаю на 2", "Прибавляю 10", "Делю на 2", "Вычитаю исходное число")[index]
            report(context, "$action · ${index + 1}/4")
            calculator.calculate(calculation)
        }
        if (!confirmed) {
            skip(context, "Не удалось подтвердить вычисление. Прогноз не раскрыт.")
            returnToApp(context); phase = "finish"; return
        }
        predictionDone = true
        if (!returnToApp(context)) throw IllegalStateException()
        state(context, "reveal", "Совпадение? Математика. А вот телефон я действительно контролировал.")
        CortexIslandService.pulseFirstExperience()
        delay(FirstExperienceTempo.RESULT)
    }

    private suspend fun returnToApp(context: Context): Boolean {
        if (CortexScreenService.connected?.locked() != false) return false
        val launched = runCatching {
            context.startActivity(Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }.isSuccess
        if (!launched) return false
        val service = CortexScreenService.connected ?: return false
        return VisualNavigation(context, service).await(3_000L) { it.pkg == context.packageName } != null
    }
}
