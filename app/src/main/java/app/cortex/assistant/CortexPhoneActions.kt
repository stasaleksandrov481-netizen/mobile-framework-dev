package app.cortex.assistant

import android.accessibilityservice.AccessibilityService
import android.app.DownloadManager
import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.content.*
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.*
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.MediaStore
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.Executors

internal class CortexPhoneActions(private val context: Context) {

    init { scheduleAppIndex() }

    private fun scheduleAppIndex() {
        val now = SystemClock.elapsedRealtime()
        if (indexPending || indexUpdatedAt != 0L && now - indexUpdatedAt < APP_INDEX_TTL_MS) return
        synchronized(appWorker) {
            if (indexPending || indexUpdatedAt != 0L &&
                SystemClock.elapsedRealtime() - indexUpdatedAt < APP_INDEX_TTL_MS) return
            indexPending = true
            appWorker.execute {
                try {
                    val installed = launchableApps()
                    if (installed.isNotEmpty()) appIndex = installed
                } catch (_: Exception) {
                    // Keep the previous successful snapshot; allow a later refresh.
                } finally {
                    indexUpdatedAt = SystemClock.elapsedRealtime()
                    indexPending = false
                }
            }
        }
    }

    private fun cachedApps(): List<App> {
        scheduleAppIndex()
        val indexed = appIndex
        if (indexed.isNotEmpty()) return indexed
        // A voice command can arrive before the background index finishes.
        // Do one direct launcher query instead of falsely saying the app is absent.
        val initial = runCatching { launchableApps() }.getOrDefault(emptyList())
        if (initial.isNotEmpty()) {
            appIndex = initial
            indexUpdatedAt = SystemClock.elapsedRealtime()
        }
        return initial
    }

    private val audio by lazy { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private val main = Handler(Looper.getMainLooper())
    private fun launch(intent: Intent): Boolean = runCatching {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    }.getOrDefault(false)

    /** OEM Settings apps do not necessarily implement every public settings action. */
    private fun openSettings(panel: Boolean, vararg candidates: String): JSONObject {
        val actions = (candidates.toList() + Settings.ACTION_SETTINGS).distinct()
        for ((index, action) in actions.withIndex()) {
            val intent = Intent(action)
            if (action == Settings.ACTION_APP_NOTIFICATION_SETTINGS) {
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            }
            if (launch(intent)) return JSONObject().put("status", if (panel) "panel" else "opened")
                .put("fallback", index != 0)
        }
        return JSONObject().put("status", "unavailable")
    }

    private fun execute(command: JSONObject): JSONObject {
        val kind = command.optString("kind")
        val target = command.optString("target")
        val mode = command.optString("mode")
        fun status(value: String) = JSONObject().put("status", value)
        fun started(intent: Intent) = status(if (launch(intent)) "opened" else "unavailable")
        when (kind) {
            "shade" -> {
                val service = CortexScreenService.connected ?: return status("needs_screen").put(
                    "message", "Для системной шторки разрешите службу CORTEX в «Вызов → Разрешения Android».")
                val action = if (target == "notifications") AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
                    else AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS
                val opened = service.global(action)
                return status(if (opened) "requested" else "unavailable").put("message",
                    if (opened) "Android принял команду открыть шторку." else "Android не открыл шторку.")
            }
            "media" -> return CortexMedia.execute(context, mode)
            "app" -> {
                if (normalized(target) in CAMERA_NAMES) return openCamera()
                val manager = context.packageManager
                val direct = manager.getLaunchIntentForPackage(target)
                val pkg = if (direct != null) target else resolveApp(target)?.pkg ?: return status("not_installed")
                val intent = direct ?: manager.getLaunchIntentForPackage(pkg) ?: return status("not_installed")
                val label = runCatching { manager.getApplicationLabel(manager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)
                return started(intent).put("name", label).put("package", pkg).put("verified", false)
            }
            "close_app" -> {
                val app = resolveApp(target) ?: return status("not_installed")
                val service = CortexScreenService.connected ?: return status("needs_screen").put("name", app.name)
                val current = service.activePackage() ?: return status("unavailable")
                if (current != app.pkg) return status("already_background").put("name", app.name)
                val sent = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
                return status(if (sent) "opened" else "unavailable").put("name", app.name).put("package", app.pkg).put("verified", false)
            }
            "open_web" -> {
                val url = CortexSafeUrl.parse(target) ?: return status("invalid")
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url.toASCIIString())).addCategory(Intent.CATEGORY_BROWSABLE)
                val browser = command.optString("browser")
                if (browser.isNotBlank()) {
                    val installed = resolveApp(browser) ?: return status("not_installed").put("name", browser)
                    intent.setPackage(installed.pkg)
                }
                return started(intent).put("host", url.host.orEmpty())
            }
            "play_store" -> {
                val query = command.optString("query").trim().take(100)
                if (query.isBlank()) return status("invalid")
                val encoded = Uri.encode(query)
                val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://search?q=" + encoded)).setPackage("com.android.vending")
                // The generic market intent also works with non-Google app stores.
                val opened = launch(market) || launch(Intent(Intent.ACTION_VIEW, Uri.parse("market://search?q=" + encoded))) ||
                    launch(Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/search?q=" + encoded + "&c=apps")))
                return status(if (opened) "panel" else "unavailable")
            }
            "app_list" -> {
                @Suppress("DEPRECATION")
                val names = context.packageManager.getInstalledApplications(0).mapNotNull {
                    runCatching { context.packageManager.getApplicationLabel(it).toString() }.getOrNull()
                }.filter { it.contains(command.optString("query"), true) }.distinct().sorted().take(70)
                return status("done").put("count", names.size).put("names", JSONArray(names))
            }
            "app_info" -> return started(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$target"))).put("name", target)
            "settings" -> {
                val action = when (target) {
                    "wifi", "wifi_ip" -> Settings.ACTION_WIFI_SETTINGS
                    "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
                    "mobile", "network_operator", "apn", "data_usage" -> Settings.ACTION_DATA_ROAMING_SETTINGS
                    "airplane" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS
                    "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
                    "nfc", "nfc_payment" -> Settings.ACTION_NFC_SETTINGS
                    "sound" -> Settings.ACTION_SOUND_SETTINGS
                    "apps", "default_apps" -> Settings.ACTION_APPLICATION_SETTINGS
                    "display", "rotate", "night_light" -> Settings.ACTION_DISPLAY_SETTINGS
                    "language", "region", "regional" -> Settings.ACTION_LOCALE_SETTINGS
                    "date" -> Settings.ACTION_DATE_SETTINGS
                    "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
                    "storage" -> Settings.ACTION_INTERNAL_STORAGE_SETTINGS
                    "security", "privacy" -> Settings.ACTION_SECURITY_SETTINGS
                    "about" -> Settings.ACTION_DEVICE_INFO_SETTINGS
                    "battery", "battery_saver" -> Settings.ACTION_BATTERY_SAVER_SETTINGS
                    "dnd" -> Settings.ACTION_SOUND_SETTINGS
                    "vpn" -> Settings.ACTION_VPN_SETTINGS
                    "keyboard" -> Settings.ACTION_INPUT_METHOD_SETTINGS
                    "accounts" -> Settings.ACTION_ADD_ACCOUNT
                    "notifications" -> Settings.ACTION_APP_NOTIFICATION_SETTINGS
                    else -> Settings.ACTION_SETTINGS
                }
                return if (target in setOf("wifi", "wifi_ip", "bluetooth", "mobile", "network_operator", "apn", "data_usage",
                        "airplane", "location", "nfc", "nfc_payment", "vpn")) {
                    openSettings(false, action, Settings.ACTION_WIRELESS_SETTINGS)
                } else openSettings(false, action)
            }
            "connectivity", "panel" -> {
                val action = when (target) {
                    "wifi" -> if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_WIFI else Settings.ACTION_WIFI_SETTINGS
                    "internet", "mobile" -> if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_INTERNET_CONNECTIVITY else Settings.ACTION_WIRELESS_SETTINGS
                    "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
                    "airplane" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS
                    "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
                    "nfc" -> Settings.ACTION_NFC_SETTINGS
                    else -> Settings.ACTION_WIRELESS_SETTINGS
                }
                val alternative = when (target) {
                    "wifi" -> Settings.ACTION_WIFI_SETTINGS
                    "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
                    "airplane" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS
                    "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
                    "nfc" -> Settings.ACTION_NFC_SETTINGS
                    else -> Settings.ACTION_WIRELESS_SETTINGS
                }
                return openSettings(true, action, alternative, Settings.ACTION_WIRELESS_SETTINGS)
            }
            "utility" -> return when (target) {
                "camera_photo" -> started(Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA))
                "camera_video" -> started(Intent(MediaStore.INTENT_ACTION_VIDEO_CAMERA))
                "downloads" -> started(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS))
                "keyboard" -> { (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker(); status("opened") }
                else -> status("invalid")
            }
            "battery" -> return readDevice("battery")
            "read_device" -> return readDevice(target)
            "volume" -> {
                val stream = when (command.optString("stream")) {
                    "ring" -> AudioManager.STREAM_RING
                    "alarm" -> AudioManager.STREAM_ALARM
                    "notification" -> AudioManager.STREAM_NOTIFICATION
                    "call" -> AudioManager.STREAM_VOICE_CALL
                    else -> AudioManager.STREAM_MUSIC
                }
                val maximum = audio.getStreamMaxVolume(stream).coerceAtLeast(1)
                val current = audio.getStreamVolume(stream)
                val change = command.optInt("level", 10)
                val currentPercent = current * 100 / maximum
                val percent = when (mode) { "set" -> change; "up" -> currentPercent + change; "down" -> currentPercent - change
                    "mute" -> 0; "unmute" -> 50; else -> currentPercent }.coerceIn(0, 100)
                if (mode != "status") audio.setStreamVolume(stream, percent * maximum / 100, 0)
                return status("done").put("level", audio.getStreamVolume(stream) * 100 / maximum)
            }
            "brightness" -> {
                if (mode != "status" && !Settings.System.canWrite(context)) return status("needs_brightness")
                val resolver = context.contentResolver
                val outcome = CortexBrightness.apply(object : CortexBrightness.Port {
                    override fun brightness() = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, -1)
                        .takeIf { it >= 0 }
                    override fun mode() = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, -1)
                        .takeIf { it >= 0 }
                    override fun writeBrightness(value: Int) = Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS, value)
                    override fun writeMode(value: Int) = Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, value)
                    override fun maximum() = runCatching {
                        val system = android.content.res.Resources.getSystem()
                        val id = system.getIdentifier("config_screenBrightnessSettingMaximum", "integer", "android")
                        if (id != 0) system.getInteger(id) else null
                    }.getOrNull()
                }, mode, command.optInt("level", 10))
                return status(outcome.status).apply {
                    outcome.percent?.let { put("level", it) }
                    outcome.automatic?.let { put("automatic", it) }
                }
            }
            "rotate" -> {
                if (!Settings.System.canWrite(context)) return status("needs_brightness")
                val key = Settings.System.ACCELEROMETER_ROTATION
                val wanted = if (mode == "on") 1 else 0
                val saved = Settings.System.putInt(context.contentResolver, key, wanted)
                val enabled = Settings.System.getInt(context.contentResolver, key, 0) != 0
                return status(if (saved && enabled == (wanted == 1)) "done" else "requested").put("enabled", enabled)
            }
            "ringer" -> {
                val wanted = when (mode) { "vibrate" -> AudioManager.RINGER_MODE_VIBRATE;
                    "silent" -> AudioManager.RINGER_MODE_SILENT; else -> AudioManager.RINGER_MODE_NORMAL }
                audio.ringerMode = wanted
                return status(if (audio.ringerMode == wanted) "done" else "requested")
            }
            "lock_screen" -> {
                val service = CortexScreenService.connected
                if (Build.VERSION.SDK_INT >= 28 && service?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN) == true) {
                    return status("requested")
                }
                val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                if (!dpm.isAdminActive(ComponentName(context, CortexDeviceAdmin::class.java))) return status("needs_lock")
                dpm.lockNow()
                return status("requested")
            }
            "home" -> {
                if (CortexScreenService.connected?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) == true) return status("opened")
                return started(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME))
            }
            "recents" -> return status(if (CortexScreenService.connected?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_RECENTS) == true)
                "opened" else "unsupported")
            "timer" -> return started(Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, command.optInt("seconds")))
            "alarm" -> return started(Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, command.optInt("hour")).putExtra(AlarmClock.EXTRA_MINUTES, command.optInt("minute")))
            "dial" -> return started(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(command.optString("number")))))
            "sms" -> return started(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(command.optString("number"))))
                .putExtra("sms_body", command.optString("text")))
            "search" -> return started(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/search?q=" + Uri.encode(command.optString("query")))))
            "maps" -> return started(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(command.optString("query")))))
            "calendar" -> return started(Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.Events.TITLE, command.optString("title")))
            "share_text" -> return started(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"; putExtra(Intent.EXTRA_TEXT, command.optString("text"))
            }, "Поделиться текстом"))
            "copy_text" -> {
                (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("CORTEX", command.optString("text")))
                return status("done")
            }
        }
        return status("unsupported")
    }

    data class App(val pkg: String, val name: String)

    private fun launchableApps(): List<App> {
        val manager = context.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        return manager.queryIntentActivities(launcher, 0)
            .map { App(it.activityInfo.packageName, it.loadLabel(manager).toString()) }
            .distinctBy(App::pkg)
    }

    private fun normalized(text: String) = text.lowercase(Locale.ROOT).replace('ё', 'е').trim()

    fun commandAppResolver(): (String) -> String? =
        { target -> resolveApp(target, cachedApps())?.pkg }

    fun resolveApp(target: String): App? = resolveApp(target, cachedApps())

    private fun resolveApp(target: String, apps: List<App>): App? {
        val clean = normalized(target)
        apps.firstOrNull { it.pkg == clean }?.let { return it }
        val exact = apps.filter { normalized(it.name) == clean }
        if (exact.size == 1) return exact[0]
        for ((pkg, names) in ALIASES) {
            if (clean in names) {
                apps.firstOrNull { it.pkg == pkg }?.let { return it }
                // A package alias is not proof that the app is installed.
                if (apps.isEmpty() && context.packageManager.getLaunchIntentForPackage(pkg) != null)
                    return App(pkg, target)
            }
        }
        return when (clean) {
            in CAMERA_NAMES -> cameraApp(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
            else -> CortexAppRoles.role(clean)?.let(::roleApp)
        }
    }

    /** The user's default (or the only/system) launchable app for a standard Android role. */
    private fun roleApp(role: CortexAppRoles.Role): App? {
        val intent = when (role) {
            CortexAppRoles.Role.PHONE -> Intent(Intent.ACTION_DIAL)
            CortexAppRoles.Role.CLOCK -> Intent(AlarmClock.ACTION_SHOW_ALARMS)
            CortexAppRoles.Role.SETTINGS -> Intent(Settings.ACTION_SETTINGS)
            CortexAppRoles.Role.FILES -> if (Build.VERSION.SDK_INT >= 29)
                Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_FILES) else return null
            else -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, when (role) {
                CortexAppRoles.Role.GALLERY -> Intent.CATEGORY_APP_GALLERY
                CortexAppRoles.Role.MESSAGING -> Intent.CATEGORY_APP_MESSAGING
                CortexAppRoles.Role.CONTACTS -> Intent.CATEGORY_APP_CONTACTS
                CortexAppRoles.Role.CALENDAR -> Intent.CATEGORY_APP_CALENDAR
                CortexAppRoles.Role.EMAIL -> Intent.CATEGORY_APP_EMAIL
                CortexAppRoles.Role.MAPS -> Intent.CATEGORY_APP_MAPS
                CortexAppRoles.Role.MUSIC -> Intent.CATEGORY_APP_MUSIC
                CortexAppRoles.Role.BROWSER -> Intent.CATEGORY_APP_BROWSER
                else -> Intent.CATEGORY_APP_CALCULATOR
            })
        }
        val manager = context.packageManager
        val launchable = { pkg: String -> pkg != "android" && manager.getLaunchIntentForPackage(pkg) != null }
        @Suppress("DEPRECATION")
        val preferred = runCatching { manager.resolveActivity(intent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY) }.getOrNull()
            ?.activityInfo?.packageName?.takeIf(launchable)
        // Several handlers without a chosen default resolve to the system chooser ("android").
        @Suppress("DEPRECATION")
        val pkg = preferred ?: runCatching { manager.queryIntentActivities(intent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY) }
            .getOrDefault(emptyList()).map { it.activityInfo }
            .sortedByDescending { it.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM != 0 }
            .map { it.packageName }.firstOrNull(launchable) ?: return null
        val label = runCatching { manager.getApplicationLabel(manager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)
        return App(pkg, label)
    }

    private fun cameraApp(action: String): App? {
        val manager = context.packageManager
        val camera = manager.resolveActivity(Intent(action), 0) ?: return null
        val pkg = camera.activityInfo.packageName
        if (pkg == "android") return null
        return App(pkg, camera.loadLabel(manager).toString())
    }

    private fun openCamera(): JSONObject {
        val action = MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA
        val app = cameraApp(action)
        val intent = Intent(action)
        if (app != null) intent.setPackage(app.pkg)
        val opened = launch(intent) || (app != null && launch(Intent(action)))
        return JSONObject().put("status", if (opened) "opened" else "unavailable")
            .put("name", app?.name ?: "Камера").put("package", app?.pkg.orEmpty()).put("verified", false)
    }

    fun mentionedApp(text: String): App? {
        val clean = normalized(text)
        val matches = cachedApps().filter { app ->
            val terms = listOf(normalized(app.name), app.pkg) + ALIASES[app.pkg].orEmpty()
            terms.any { name ->
                name.length >= 2 && Regex("(?<![\\p{L}\\p{N}])" + Regex.escape(name) +
                    "(?![\\p{L}\\p{N}])").containsMatchIn(clean)
            }
        }
        return matches.singleOrNull()
    }

    fun capabilities(): JSONObject {
        val info = runCatching { context.packageManager.getPackageInfo(context.packageName, 0) }.getOrNull()
        val service = CortexScreenService.connected
        val admin = context.getSystemService(DevicePolicyManager::class.java)
        return JSONObject().put("version", info?.versionName ?: BuildConfig.VERSION_NAME)
            .put("android", Build.VERSION.RELEASE).put("model", Build.MANUFACTURER + " " + Build.MODEL)
            .put("screen", service != null).put("overlay", Settings.canDrawOverlays(context))
            .put("lock", admin.isAdminActive(ComponentName(context, CortexDeviceAdmin::class.java)) ||
                Build.VERSION.SDK_INT >= 28 && service != null)
            .put("brightness", Settings.System.canWrite(context))
            .put("microphone", context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED)
            .put("camera", context.checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED)
            .put("notifications", context.getSystemService(android.app.NotificationManager::class.java).areNotificationsEnabled())
            .put("battery", safeRead("battery")).put("network", safeRead("network"))
    }

    private fun safeRead(target: String) = runCatching { readDevice(target) }.getOrNull() ?: JSONObject()

    fun executeChecked(command: JSONObject, active: () -> Boolean = { true }, done: (JSONObject) -> Unit) {
        val kind = command.optString("kind")
        if (!active()) return
        if (kind == "torch") {
            torch(command.optString("mode"), active, done)
            return
        }
        fun checked(result: JSONObject) {
            if (!active()) return
            val expected = result.optString("package")
            if (kind in setOf("app", "close_app") && result.optString("status") == "opened" &&
                expected.isNotBlank() && CortexScreenService.connected != null) {
                awaitState(active, attempts = if (kind == "app") 30 else 12, interval = 160L, condition = {
                    val foreground = CortexScreenService.connected?.activePackage()
                    foreground != null && if (kind == "close_app") foreground != expected else foreground == expected
                }) { confirmed -> done(result.put("verified", confirmed)) }
            } else if (kind == "shade" && result.optString("status") == "requested") {
                awaitState(active, attempts = 18, interval = 160L, condition = {
                    CortexScreenService.connected?.frame()?.let {
                        it.pkg == "com.android.systemui" && it.tree.isNotEmpty()
                    } == true
                }) { confirmed ->
                    done(result.put("status", if (confirmed) "done" else "requested").put("message",
                        if (confirmed) "Шторка открыта." else "Android принял запрос открыть шторку."))
                }
            } else if (kind == "lock_screen" && result.optString("status") == "requested") {
                val keyguard = context.getSystemService(KeyguardManager::class.java)
                awaitState(active, condition = {
                    keyguard.isKeyguardLocked || !context.getSystemService(PowerManager::class.java).isInteractive
                }) { done(result.put("status", if (it) "done" else "requested")) }
            } else done(result)
        }
        if (kind in setOf("app", "close_app", "app_list", "app_info")) {
            // These paths query installed apps and can take hundreds of milliseconds on Samsung.
            appWorker.execute {
                val result = runCatching { execute(command) }
                    .getOrElse { JSONObject().put("status", "unavailable") }
                main.post { checked(result) }
            }
        } else {
            checked(runCatching { execute(command) }
                .getOrElse { JSONObject().put("status", "unavailable") })
        }
    }

    private fun awaitState(
        active: () -> Boolean, attempts: Int = 9, interval: Long = 220L,
        condition: () -> Boolean, done: (Boolean) -> Unit
    ) {
        var remaining = attempts
        fun check() {
            if (!active()) return
            if (condition()) done(true)
            else if (remaining-- == 0) done(false)
            else main.postDelayed(::check, interval)
        }
        check()
    }

    private fun torch(mode: String, active: () -> Boolean, done: (JSONObject) -> Unit) {
        fun result(status: String, message: String = "", enabled: Boolean? = null) =
            JSONObject().put("status", status).apply {
                if (message.isNotBlank()) put("message", message)
                if (enabled != null) put("enabled", enabled)
            }
        val permissionHint = "Разрешите доступ к фонарику в CORTEX → Вызов → Разрешения Android → Фонарик."
        val cameraGranted = context.checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val manager = context.getSystemService(CameraManager::class.java)
        val id = runCatching {
            val cameras = manager.cameraIdList.mapNotNull { id ->
                val info = manager.getCameraCharacteristics(id)
                if (info.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) != true) null
                else id to (info.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK)
            }
            cameras.firstOrNull { it.second }?.first ?: cameras.firstOrNull()?.first
        }.getOrNull()
        if (id == null) {
            val flash = context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_FLASH)
            done(if (flash && !cameraGranted) result("permission", permissionHint)
                else result("unsupported", "Android не предоставил доступную вспышку."))
            return
        }
        var target: Boolean? = when (mode) {
            "on" -> true
            "off" -> false
            "toggle", "status" -> null
            else -> { done(result("invalid")); return }
        }
        var finished = false
        lateinit var callback: CameraManager.TorchCallback
        val timeout = Runnable {
            if (active()) done(result("unavailable", "Android не подтвердил состояние фонарика."))
            finished = true
            runCatching { manager.unregisterTorchCallback(callback) }
        }
        fun finish(status: String, message: String = "", enabled: Boolean? = null) {
            if (finished) return
            finished = true
            main.removeCallbacks(timeout)
            runCatching { manager.unregisterTorchCallback(callback) }
            if (active()) done(result(status, message, enabled))
        }
        fun request(enabled: Boolean) {
            try { manager.setTorchMode(id, enabled) }
            catch (_: SecurityException) { finish("permission", permissionHint) }
            catch (_: android.hardware.camera2.CameraAccessException) {
                finish("unavailable", "Вспышка занята или недоступна. Закройте камеру и попробуйте снова.")
            } catch (_: IllegalArgumentException) {
                finish("unavailable", "Android отклонил переключение этой вспышки.")
            }
        }
        callback = object : CameraManager.TorchCallback() {
            override fun onTorchModeUnavailable(cameraId: String) {
                if (cameraId == id) finish("unavailable", "Вспышка сейчас недоступна.")
            }

            override fun onTorchModeChanged(cameraId: String, enabled: Boolean) {
                if (cameraId != id || finished) return
                if (!active()) { finish("cancelled"); return }
                if (mode == "status" || target == enabled) {
                    finish("done", enabled = enabled)
                } else if (target == null) {
                    target = !enabled
                    request(!enabled)
                }
            }
        }
        try {
            manager.registerTorchCallback(callback, main)
            main.postDelayed(timeout, 3_800L)
            target?.let(::request)
        } catch (_: SecurityException) {
            finish("permission", permissionHint)
        } catch (_: IllegalArgumentException) {
            finish("unavailable", "Android не предоставил состояние вспышки.")
        }
    }

    private fun readDevice(target: String): JSONObject {
        fun done() = JSONObject().put("status", "done")
        return when (target) {
            "battery" -> {
                val battery = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
                done().put("level", battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
                    .put("charging", battery.isCharging)
            }
            "storage" -> { val f = android.os.StatFs(android.os.Environment.getDataDirectory().path)
                done().put("free", f.availableBytes).put("total", f.totalBytes) }
            "phone" -> done().put("value", Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE)
            "ringer" -> done().put("value", when(audio.ringerMode) { AudioManager.RINGER_MODE_SILENT -> "silent"
                AudioManager.RINGER_MODE_VIBRATE -> "vibrate"; else -> "sound" })
            "time" -> done().put("value", java.time.ZonedDateTime.now().toString())
            "locale" -> done().put("value", Locale.getDefault().toLanguageTag())
            "refresh" -> CortexDisplaySettings.info(context).put("status", "done")
            "rotate" -> done().put("enabled", Settings.System.getInt(context.contentResolver, Settings.System.ACCELEROMETER_ROTATION, 0) != 0)
            "wifi" -> done().put("enabled", (context.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager).isWifiEnabled)
            "network" -> { val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                val active = cm.activeNetwork; val cap = cm.getNetworkCapabilities(active)
                val value = when { cap == null -> "offline"; cap.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
                    cap.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                    cap.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"; else -> "connected" }
                done().put("value", value).put("validated", cap?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true) }
            "airplane" -> done().put("enabled", Settings.Global.getInt(context.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) != 0)
            "location" -> done().put("enabled", androidx.core.location.LocationManagerCompat.isLocationEnabled(
                context.getSystemService(android.location.LocationManager::class.java)))
            "battery_saver" -> done().put("enabled", (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode)
            "screen_lock" -> done().put("enabled", (context.getSystemService(Context.KEYGUARD_SERVICE) as android.app.KeyguardManager).isDeviceSecure)
            else -> JSONObject().put("status", "unsupported")
        }
    }

    private companion object {
        // PackageManager launcher enumeration and label loading must never stall the island UI.
        private val appWorker = Executors.newSingleThreadExecutor { task ->
            Thread(task, "cortex-app-index").apply { isDaemon = true }
        }
        @Volatile private var appIndex: List<App> = emptyList()
        @Volatile private var indexUpdatedAt = 0L
        @Volatile private var indexPending = false
        private const val APP_INDEX_TTL_MS = 120_000L
        val CAMERA_NAMES = setOf("camera", "камера", "камеру", "фотокамера", "фотокамеру")
        val TELEGRAM_NAMES = listOf("telegram", "телеграм", "телеграмм", "телеграме", "телега", "телегу", "телеге", "тг")
        val ALIASES = mapOf(
            "org.telegram.messenger" to TELEGRAM_NAMES,
            "org.telegram.messenger.web" to TELEGRAM_NAMES,
            "org.thunderdog.challegram" to listOf("telegram x", "телеграм x"),
            "com.wildberries.ru" to listOf("wildberries", "вб", "вайлдберриз"),
            "com.zhiliaoapp.musically" to listOf("tiktok", "тик ток", "тикток", "тиктоке", "тт"),
            "com.instagram.android" to listOf("instagram", "инстаграм", "инстаграме"),
            "com.google.android.youtube" to listOf("youtube", "ютуб", "ютубе"),
            "com.whatsapp" to listOf("whatsapp", "ватсап", "ватсапе"),
            "com.android.chrome" to listOf("chrome", "хром", "хроме"),
            "com.yandex.browser" to listOf("яндекс браузер", "яндекс браузере", "яндексе", "яндекс", "yandex", "yandex browser"),
            "ru.yandex.searchplugin" to listOf("яндекс с алисой", "яндексе", "яндекс", "yandex"),
            "com.android.vending" to listOf("google play", "play market", "плей маркет")
        )
    }
}
