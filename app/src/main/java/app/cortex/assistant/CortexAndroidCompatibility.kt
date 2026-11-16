package app.cortex.assistant

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.speech.SpeechRecognizer
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** Capabilities are probed on the actual device, never inferred from its brand alone. */
internal object CortexAndroidCompatibility {
    fun offlineWakeAvailable(context: Context): Boolean = Build.VERSION.SDK_INT >= 31 &&
        runCatching { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }.getOrDefault(false)

    fun report(context: Context): JSONObject {
        val manager = context.packageManager
        fun has(feature: String) = runCatching { manager.hasSystemFeature(feature) }.getOrDefault(false)
        val battery = runCatching {
            context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
        }.getOrDefault(false)
        return JSONObject()
            .put("sdk", Build.VERSION.SDK_INT)
            .put("manufacturer", Build.MANUFACTURER)
            .put("model", Build.MODEL)
            .put("camera", has(PackageManager.FEATURE_CAMERA_ANY))
            .put("flashlight", has(PackageManager.FEATURE_CAMERA_FLASH))
            .put("wifi", has(PackageManager.FEATURE_WIFI))
            .put("bluetooth", has(PackageManager.FEATURE_BLUETOOTH))
            .put("nfc", has(PackageManager.FEATURE_NFC))
            .put("telephony", has(PackageManager.FEATURE_TELEPHONY))
            .put("speech", runCatching { SpeechRecognizer.isRecognitionAvailable(context) }.getOrDefault(false))
            .put("offlineWake", offlineWakeAvailable(context))
            .put("webBridge", runCatching { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) }
                .getOrDefault(false))
            .put("batteryUnrestricted", battery)
    }
}
