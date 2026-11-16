package app.cortex.assistant

import android.app.ActivityManager
import android.app.KeyguardManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import org.json.JSONObject
import java.util.Locale

/** Live, read-only device facts from public Android APIs. Never reads IMEI, phone number or device IDs. */
internal object CortexDeviceSnapshot {
    private fun gb(bytes: Long): String = String.format(Locale.ROOT, "%.1f", bytes.toDouble() / 1_073_741_824)

    fun info(context: Context): JSONObject {
        val power = context.getSystemService(PowerManager::class.java)
        val battery = context.getSystemService(BatteryManager::class.java)
        val memory = ActivityManager.MemoryInfo().also {
            context.getSystemService(ActivityManager::class.java).getMemoryInfo(it)
        }
        val fs = StatFs(Environment.getDataDirectory().path)
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        val transport = when {
            caps == null -> "нет подключения"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "мобильная сеть"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
            else -> "другая сеть"
        }
        return JSONObject()
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            .put("android", Build.VERSION.RELEASE)
            .put("battery", battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
            .put("charging", battery.isCharging)
            .put("power_saving", power.isPowerSaveMode)
            .put("ram_free_gb", gb(memory.availMem))
            .put("ram_total_gb", gb(memory.totalMem))
            .put("storage_free_gb", gb(fs.availableBytes))
            .put("storage_total_gb", gb(fs.totalBytes))
            .put("network", transport)
            .put("internet_available", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
            .put("vpn_active", caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true)
            .put("screen_on", power.isInteractive)
            .put("locked", context.getSystemService(KeyguardManager::class.java).isDeviceLocked)
            .put("uptime_minutes", SystemClock.elapsedRealtime() / 60_000)
            .put("notification_access", CortexNotificationJournal.accessGranted(context))
    }

    fun answer(context: Context, raw: String): String? {
        val clean = (CortexHotword.command(raw) ?: raw).lowercase(Locale.ROOT)
            .replace('ё', 'е').trim().trimEnd('?', '.', '!', ' ')
        val full = clean in setOf("состояние телефона", "сводка телефона", "сведения о телефоне",
            "информация о телефоне", "расскажи о моем телефоне", "расскажи про мой телефон",
            "что с моим телефоном", "что сейчас с телефоном", "диагностика телефона",
            "все о моем телефоне", "какой у меня телефон", "какие характеристики телефона")
        val battery = clean in setOf("сколько у меня заряда", "сколько заряда", "уровень заряда",
            "сколько процентов зарядки", "заряд батареи", "сколько осталось батареи")
        val storage = clean in setOf("сколько памяти свободно", "сколько свободного места",
            "сколько места на телефоне", "свободная память телефона", "сколько осталось места")
        val ram = clean in setOf("сколько оперативной памяти", "сколько свободной оперативной памяти",
            "сколько свободно озу", "сколько озу", "сколько у меня озу")
        val network = clean in setOf("есть ли интернет", "интернет работает", "какое соединение",
            "какая сеть", "как интернет", "подключен ли интернет", "проверь интернет")
        if (!full && !battery && !storage && !ram && !network) return null
        val status = runCatching { info(context) }.getOrElse {
            return "Не удалось прочитать состояние телефона через Android."
        }
        return when {
            battery -> "Заряд: ${status.optInt("battery")}%${if (status.optBoolean("charging")) ", идёт зарядка" else ""}."
            storage -> "На устройстве свободно ${status.optString("storage_free_gb")} ГБ из ${status.optString("storage_total_gb")} ГБ."
            ram -> "Оперативная память: свободно ${status.optString("ram_free_gb")} ГБ из ${status.optString("ram_total_gb")} ГБ."
            network -> "Подключение: ${status.optString("network")}. " +
                (if (status.optBoolean("internet_available")) "Доступ в интернет подтверждён Android."
                else "Android не подтвердил доступ в интернет.") +
                (if (status.optBoolean("vpn_active")) " VPN активен." else "")
            else -> listOf(
                "${status.optString("model")} · Android ${status.optString("android")}",
                "Заряд ${status.optInt("battery")}%${if (status.optBoolean("charging")) " (заряжается)" else ""}" +
                    if (status.optBoolean("power_saving")) ", энергосбережение включено" else "",
                "Память: ${status.optString("storage_free_gb")} ГБ свободно из ${status.optString("storage_total_gb")} ГБ",
                "ОЗУ: ${status.optString("ram_free_gb")} ГБ свободно из ${status.optString("ram_total_gb")} ГБ",
                "Сеть: ${status.optString("network")}" + if (status.optBoolean("internet_available")) ", интернет доступен" else ", интернет не подтверждён",
                "Экран: " + if (status.optBoolean("screen_on")) "включён" else "выключен",
                "Сводка уведомлений: " + if (status.optBoolean("notification_access")) "доступна" else "нужен отдельный доступ Android"
            ).joinToString("\n")
        }
    }
}
