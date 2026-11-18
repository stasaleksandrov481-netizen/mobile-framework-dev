package app.cortex.assistant

import android.Manifest
import android.app.Activity
import android.app.role.RoleManager
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.*
import android.provider.Settings
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/** Kotlin implementation of the web page's `CortexDevice` message contract.
 * The original Kotlin implementation cannot be recovered bit-for-bit from an APK.
 * The app never claims that a system action succeeded without a platform result.
 */
internal class CortexDeviceBridge(
    private val activity: Activity,
    private val speech: CortexSpeech,
    private val openLogin: (String) -> Boolean,
    private val emit: (JSONObject) -> Unit
) : AutoCloseable {
    private val context get() = activity.applicationContext
    private val engineDelegate = lazy { CortexActionEngine(activity) }
    private val engine by engineDelegate
    private val voiceOutputDelegate = lazy { CortexVoiceOutput(activity) }
    private val voiceOutput by voiceOutputDelegate
    private var pendingImage = false
    private var pendingExport: String? = null
    private var scenarioExport: String? = null
    private var pointRecorder: CortexPointRecorder? = null
    private val scheduleListener: () -> Unit = ::scheduleList
    init { CortexRuntime.scheduleChanged = scheduleListener }

    fun handle(raw: String) {
        if (raw.length > 2_200_000) return
        val body = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (body.optString("operation")) {
            "permissions" -> refreshPermissions()
            "open-settings" -> sendAction("settings") { open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }
            "assistant-permission" -> sendAction("assistant-permission") {
                requestAssistantRole() || open(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)) ||
                    open(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
            }
            "verification-permission" -> open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            "notification-permission" -> requestPermission(Manifest.permission.POST_NOTIFICATIONS)
            "notification-listener-permission" -> sendAction("notification-listener") {
                open(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
            "notification-journal-clear" -> {
                CortexNotificationJournal(context).clear()
                emit(JSONObject().put("type", "notification-journal-cleared").put("ok", true))
            }
            "private-data-clear" -> {
                CortexNotificationJournal(context).clear()
                CortexPrivateMemory(context).wipeDevice()
                emit(JSONObject().put("type", "private-data-cleared").put("ok", true))
            }
            "schedule-exact" -> if (Build.VERSION.SDK_INT >= 31) sendAction("schedule-exact") {
                open(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}")))
            }
            "schedule-list" -> scheduleList()
            "schedule-save" -> scheduleResult(CortexSchedule.save(context, body.optJSONObject("task") ?: JSONObject()))
            "schedule-action" -> scheduleResult(CortexSchedule.handle(context, body.optString("id"), body.optString("action")) {
                activity.moveTaskToBack(true)
            })
            "scenario-list" -> scenarioList()
            "scenario-check" -> {
                val error = CortexScenarios.check(body.optJSONObject("scenario") ?: JSONObject())
                scenarioStatus(error ?: "Параметры сценария прошли проверку.", error == null, "check")
            }
            "scenario-save" -> {
                val error = CortexScenarios.save(context, body.optJSONObject("scenario") ?: JSONObject())
                if (error == null) scenarioList()
                scenarioStatus(if (error == null) "Сценарий сохранён." else error, error == null, "save")
            }
            "scenario-delete" -> {
                val ok = CortexScenarios.delete(context, body.optString("id"))
                if (ok) scenarioList()
                scenarioStatus(if (ok) "Сценарий удалён." else "Не удалось удалить сценарий.", ok, "delete")
            }
            "scenario-run" -> {
                val item = CortexScenarios.get(context, body.optString("id"))
                if (item == null) scenarioStatus("Сначала сохраните сценарий.", false, "run")
                else engine.start(item.name, "fast", force = true, explicitScenario = item,
                    beforeScreen = { activity.moveTaskToBack(true) },
                    allowPhone = context.getSharedPreferences("cortex-display", Context.MODE_PRIVATE).getBoolean("phoneActions", true),
                    progress = { emit(JSONObject().put("type", "scenario-progress").put("text", it)) }) {
                    scenarioStatus(it.text, it.ok, "run")
                }
            }
            "scenario-point" -> recordScenarioPoint()
            "scenario-import" -> runCatching {
                @Suppress("DEPRECATION")
                activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "application/json"
                }, 503)
            }.onFailure { scenarioStatus("Android не открыл выбор файла.", false, "file") }
            "scenario-export" -> {
                val item = CortexScenarios.get(context, body.optString("id"))
                if (item != null) runCatching {
                    scenarioExport = item.json().toString(2)
                    @Suppress("DEPRECATION")
                    activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "application/json"
                        putExtra(Intent.EXTRA_TITLE, "cortex-scenario.json")
                    }, 504)
                }.onFailure { scenarioStatus("Android не открыл сохранение файла.", false, "file") }
            }
            "camera-permission" -> requestPermission(Manifest.permission.CAMERA)
            "microphone-permission" -> requestPermission(Manifest.permission.RECORD_AUDIO)
            "tap" -> vibrate()
            "conversation-clear" -> {
                val source = body.optString("source").take(100)
                CortexSchedule.clearDraft(source)
                CortexActionEngine.clearPaused(source)
            }
            "action-start" -> {
                val id = body.optString("id")
                fun event(phase: String, text: String = "", ok: Boolean = false, resumable: Boolean = false,
                          ephemeral: Boolean = false) =
                    emit(JSONObject().put("type", "action").put("id", id).put("phase", phase).put("text", text)
                        .put("ok", ok).put("resumable", resumable).put("ephemeral", ephemeral)
                        .put("external", !CortexRuntime.appVisible))
                val handled = engine.start(body.optString("text"), body.optString("profile"),
                    force = body.optBoolean("force"), allowPhone = body.optBoolean("allowPhone", true),
                    source = body.optString("source", "chat").take(100),
                    beforeScreen = { activity.moveTaskToBack(true) },
                    progress = { event("progress", it) }) { result ->
                    event("result", result.text, result.ok, result.resumable, result.ephemeral)
                }
                if (!handled) event("pass")
            }
            "action-stop" -> CortexActionState.stop()
            "visual-privacy" -> {
                val options = context.getSharedPreferences("cortex-display", Context.MODE_PRIVATE)
                if (body.has("enabled")) options.edit().putBoolean("visual-model-consent", body.optBoolean("enabled")).apply()
                emit(JSONObject().put("type", "visual-privacy").put("enabled", options.getBoolean("visual-model-consent", false)))
            }
            "action-history" -> emit(JSONObject().put("type", "action-history").put("entries", CortexActionState.history(context)))
            "gate-cache" -> emit(JSONObject().put("type", "gate-cache").put("gate", CortexActionState.cachedGate(context)))
            "support-notify-config" -> CortexSupportNotification.configure(context, body.optBoolean("enabled"))
            "support-notification" -> body.optJSONArray("ids")?.let {
                CortexSupportNotification.update(context, it, body.optBoolean("seen"))
            }
            "voice-start" -> {
                val id = body.optString("id")
                if (android.os.Build.VERSION.SDK_INT >= 23 && activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    emit(JSONObject().put("type", "voice").put("id", id).put("phase", "error")
                        .put("text", "Разрешите микрофон CORTEX в Android."))
                    requestPermission(Manifest.permission.RECORD_AUDIO)
                } else speech.listen(id, body.optString("language", "ru-RU"), preferOffline = !body.optBoolean("dictation"))
            }
            "voice-finish" -> speech.finish(body.optString("id"))
            "voice-cancel" -> speech.cancel(body.optString("id"))
            "voice-speak" -> {
                val id = body.optString("id").take(90)
                voiceOutput.speak(body.optString("text")) { ok ->
                    emit(JSONObject().put("type", "voice-output").put("id", id).put("ok", ok))
                }
            }
            "voice-stop" -> if (voiceOutputDelegate.isInitialized()) voiceOutput.stop()
            "copy" -> {
                val text = body.optString("text").take(200_000)
                val ok = runCatching {
                    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                        .setPrimaryClip(ClipData.newPlainText("CORTEX", text))
                }.isSuccess
                emit(JSONObject().put("type", "copy").put("ok", ok))
            }
            "open-link" -> {
                val url = body.optString("url")
                val safeUrl = CortexSafeUrl.parse(url)
                val ok = safeUrl != null && launch(Intent(Intent.ACTION_VIEW, Uri.parse(safeUrl.toASCIIString())))
                emit(JSONObject().put("type", "link").put("ok", ok))
            }
            "open-login" -> {
                val ok = openLogin(body.optString("url"))
                emit(JSONObject().put("type", "browser").put("ok", ok))
            }
            "choose-image" -> {
                pendingImage = true
                @Suppress("DEPRECATION")
                activity.startActivityForResult(Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*"; addCategory(Intent.CATEGORY_OPENABLE) }, 501)
            }
            "export" -> {
                pendingExport = body.optString("text").take(2_000_000)
                @Suppress("DEPRECATION")
                activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE); type = "text/plain"; putExtra(Intent.EXTRA_TITLE, "cortex-chats.txt")
                }, 502)
            }
            "screen-context" -> {
                val frame = CortexScreenService.connected?.frame()?.takeUnless { it.secure || it.hasPrivateFields || it.pkg == context.packageName }
                val text = frame?.tree?.map { VisualLabels.forModel(it.label) }?.filter(String::isNotBlank)
                    ?.distinct()?.joinToString("\n")?.take(2600)
                if (!text.isNullOrBlank() && frame != null) emit(JSONObject().put("type", "screen-context")
                    .put("context", JSONObject().put("app", frame.pkg).put("text", text)))
            }
            "overlay-config", "overlay-permission" -> emit(JSONObject().put("type", "overlay-mode").put("ok", false)
                .put("message", "В версии 0.8.6 нет системной службы островка."))
            "wake-config" -> emit(JSONObject().put("type", "wake-config").put("ok", false)
                .put("message", "Фоновая активация голосом не включена в этом исходном проекте."))
        }
    }

    override fun close() {
        val recorder = pointRecorder
        pointRecorder = null
        recorder?.cancel()
        if (CortexRuntime.scheduleChanged === scheduleListener) CortexRuntime.scheduleChanged = null
        if (engineDelegate.isInitialized()) engine.close()
        if (voiceOutputDelegate.isInitialized()) voiceOutput.close()
    }

    fun scheduleEntry(id: String) = emit(JSONObject().put("type", "schedule-open").put("id", id))

    private fun scheduleList() = emit(JSONObject().put("type", "schedule-list")
        .put("tasks", CortexSchedule.list(context)).put("exact", CortexSchedule.exactAllowed(context))
        .put("notifications", CortexSchedule.notificationsAllowed(context)))

    private fun scheduleResult(result: CortexActionEngine.Result) =
        emit(JSONObject().put("type", "schedule-result").put("ok", result.ok).put("text", result.text))

    private fun scenarioList() = emit(JSONObject().put("type", "scenario-list").put("items", CortexScenarios.list(context)))

    private fun scenarioStatus(text: String, ok: Boolean, operation: String) = emit(JSONObject()
        .put("type", "scenario-result").put("text", text).put("ok", ok).put("operation", operation))

    private fun recordScenarioPoint() {
        val service = CortexScreenService.connected
        if (service == null || service.locked() || CortexActionState.busy) {
            scenarioStatus("Для записи точки разблокируйте телефон и включите управление экраном CORTEX.", false, "point")
            return
        }
        if (pointRecorder != null) return
        activity.moveTaskToBack(true)
        pointRecorder = CortexPointRecorder(service).also { recorder ->
            recorder.start { value ->
                if (pointRecorder !== recorder) return@start
                pointRecorder = null
                runCatching { service.startActivity(Intent(service, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                if (value == null) scenarioStatus("Запись точки завершилась. Откройте нужное приложение и повторите.", false, "point")
                else emit(JSONObject().put("type", "scenario-point").put("point", value))
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun requestAssistantRole(): Boolean {
        if (Build.VERSION.SDK_INT < 29 || CortexAssistActivity.selected(context)) return false
        val roles = context.getSystemService(RoleManager::class.java) ?: return false
        if (!roles.isRoleAvailable(RoleManager.ROLE_ASSISTANT)) return false
        return runCatching {
            activity.startActivityForResult(roles.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT), 505)
        }.isSuccess
    }

    private fun requestPermission(name: String) {
        if (Build.VERSION.SDK_INT >= 23 && activity.checkSelfPermission(name) != PackageManager.PERMISSION_GRANTED) {
            if (name == Manifest.permission.POST_NOTIFICATIONS && Build.VERSION.SDK_INT < 33) return
            activity.requestPermissions(arrayOf(name), 801)
        } else refreshPermissions()
    }
    fun refreshPermissions() {
        val obj = JSONObject().put("type", "permissions")
            .put("assistantSupported", CortexAssistActivity.available(context))
            .put("assistant", CortexAssistActivity.selected(context))
            .put("versionName", BuildConfig.VERSION_NAME)
            .put("versionCode", BuildConfig.VERSION_CODE)
            .put("manufacturer", Build.MANUFACTURER)
            .put("phoneModel", Build.MODEL)
            .put("androidRelease", Build.VERSION.RELEASE)
            .put("microphone", Build.VERSION.SDK_INT < 23 || activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            .put("camera", activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
            .put("notifications", Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            .put("notificationAccess", CortexNotificationJournal.accessGranted(context))
            .put("deviceSnapshot", runCatching { CortexDeviceSnapshot.info(context) }.getOrNull())
            .put("compatibility", CortexAndroidCompatibility.report(context))
            .put("screenLock", Build.VERSION.SDK_INT >= 28 && CortexScreenService.connected != null)
            .put("screenLockSupported", Build.VERSION.SDK_INT >= 28)
            .put("screenAutomation", CortexScreenService.connected != null)
            .put("verifyApps", CortexScreenService.connected != null)
            .put("overlay", Settings.canDrawOverlays(context))
        emit(obj)
    }
    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == 505) {
            refreshPermissions()
            return
        }
        if (requestCode == 501 && pendingImage) {
            pendingImage = false
            val e = JSONObject().put("type", "image")
            if (resultCode == Activity.RESULT_OK && data?.data != null) {
                val value = runCatching {
                    val uri = requireNotNull(data.data)
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                    require(bounds.outWidth > 0 && bounds.outHeight > 0)
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1500) sample *= 2
                    val bitmap = context.contentResolver.openInputStream(uri)?.use {
                        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
                    } ?: return@runCatching null
                    try {
                        val output = ByteArrayOutputStream()
                        for (quality in listOf(82, 68, 54, 40, 28)) {
                            output.reset()
                            if (bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output) && output.size() <= 174_000) {
                                return@runCatching "data:image/jpeg;base64," +
                                    android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP)
                            }
                        }
                        null
                    } finally { bitmap.recycle() }
                }.getOrNull()
                e.put("ok", !value.isNullOrBlank())
                if (!value.isNullOrBlank()) e.put("data", value)
            } else e.put("cancelled", true)
            emit(e)
        }
        if (requestCode == 502) {
            val e = JSONObject().put("type", "export")
            val text = pendingExport
            pendingExport = null
            if (resultCode == Activity.RESULT_OK && data?.data != null && text != null) {
                e.put("ok", runCatching {
                    context.contentResolver.openOutputStream(data.data!!)?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                }.isSuccess)
            } else e.put("cancelled", true)
            emit(e)
        }
        if (requestCode == 503 && resultCode == Activity.RESULT_OK && data?.data != null) {
            val item = runCatching {
                val input = requireNotNull(context.contentResolver.openInputStream(data.data!!))
                val bytes = input.use { stream ->
                    val buffer = ByteArray(153_601)
                    var length = 0
                    while (length < buffer.size) {
                        val count = stream.read(buffer, length, buffer.size - length)
                        if (count <= 0) break
                        length += count
                    }
                    require(length < buffer.size)
                    String(buffer, 0, length, Charsets.UTF_8)
                }
                JSONObject(bytes).apply { remove("id") }
            }.getOrNull()
            if (item == null) scenarioStatus("Не удалось прочитать JSON сценария.", false, "file")
            else emit(JSONObject().put("type", "scenario-import").put("item", item))
        }
        if (requestCode == 504) {
            val value = scenarioExport
            scenarioExport = null
            if (resultCode == Activity.RESULT_OK && data?.data != null && value != null) {
                val ok = runCatching {
                    requireNotNull(context.contentResolver.openOutputStream(data.data!!)).use {
                        it.write(value.toByteArray(Charsets.UTF_8))
                    }
                }.isSuccess
                scenarioStatus(if (ok) "Сценарий экспортирован." else "Не удалось сохранить сценарий.", ok, "file")
            }
        }
    }
    private fun open(intent: Intent): Boolean = launch(intent)
    private fun sendAction(type: String, action: () -> Boolean) { emit(JSONObject().put("type", type).put("ok", action())) }
    private fun launch(intent: Intent): Boolean = runCatching { intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); activity.startActivity(intent); true }.getOrDefault(false)
    private fun vibrate() {
        val v = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        if (Build.VERSION.SDK_INT >= 26 && v.hasVibrator()) v.vibrate(VibrationEffect.createOneShot(14, VibrationEffect.DEFAULT_AMPLITUDE))
    }

}
