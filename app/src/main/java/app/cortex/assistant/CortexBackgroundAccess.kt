package app.cortex.assistant

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import java.util.Locale

/**
 * Many Android shells stop background services even with every runtime permission granted:
 * the island, wake word and reminders then silently disappear. Android's own battery exemption
 * comes first; vendor autostart managers are opened only when that exact screen exists.
 */
internal object CortexBackgroundAccess {
    data class Screen(val packageName: String, val className: String)

    private val miui = Screen("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
    private val vivo = Screen("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
    private val iqoo = Screen("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager")
    private val coloros = Screen("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")
    private val oplus = Screen("com.oplus.safecenter", "com.oplus.safecenter.startupapp.StartupAppListActivity")

    /** Known vendor screens by manufacturer prefix. Each is resolved on the device, never assumed. */
    private val vendors = listOf(
        "xiaomi" to listOf(miui), "redmi" to listOf(miui), "poco" to listOf(miui),
        "vivo" to listOf(vivo, iqoo), "iqoo" to listOf(iqoo),
        "oppo" to listOf(coloros, oplus), "realme" to listOf(coloros, oplus), "oneplus" to listOf(oplus),
        "huawei" to listOf(Screen("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")),
        "honor" to listOf(Screen("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity")),
        "samsung" to listOf(Screen("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity")),
    )

    fun vendorScreens(manufacturer: String): List<Screen> {
        val brand = manufacturer.lowercase(Locale.ROOT).trim()
        return vendors.filter { (prefix, _) -> brand.startsWith(prefix) }.flatMap { it.second }.distinct()
    }

    fun unrestricted(context: Context): Boolean = runCatching {
        context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
    }.getOrDefault(false)

    /** Opens the next useful screen; returns false when Android offers none. */
    @SuppressLint("BatteryLife")  // A user-enabled assistant whose island, wake word and reminders must survive.
    fun open(context: Context, launch: (Intent) -> Boolean): Boolean {
        val manager = context.packageManager
        fun available(intent: Intent) = runCatching { manager.resolveActivity(intent, 0) != null }.getOrDefault(false)
        val app = Uri.parse("package:${context.packageName}")
        val candidates = buildList {
            if (!unrestricted(context)) {
                add(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, app))
                add(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
            vendorScreens(Build.MANUFACTURER).forEach { add(Intent().setComponent(ComponentName(it.packageName, it.className))) }
            add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, app))
        }
        return candidates.any { available(it) && launch(it) }
    }
}
