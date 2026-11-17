package app.cortex.assistant

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest

/**
 * Detects an APK whose installed signing certificate differs from the one
 * Gradle read from the release keystore at build time.
 *
 * This check runs locally and is NOT Android Key Attestation: a modified APK
 * can patch the check. The server must never treat this as device authenticity.
 */
internal object CortexApkIntegrity {
    fun releaseSignerMatches(context: Context): Boolean {
        if (BuildConfig.DEBUG) return true
        val expected = BuildConfig.CORTEX_RELEASE_SIGNER_SHA256
        if (!expected.matches(Regex("^[a-f0-9]{64}$")) ||
            context.packageName != BuildConfig.APPLICATION_ID) return false
        return runCatching {
            val manager = context.packageManager
            @Suppress("DEPRECATION")
            val details = manager.getPackageInfo(context.packageName,
                if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES
                else PackageManager.GET_SIGNATURES)
            @Suppress("DEPRECATION")
            val certificates = if (Build.VERSION.SDK_INT >= 28)
                details.signingInfo?.apkContentsSigners.orEmpty()
            else details.signatures.orEmpty()
            val expectedBytes = expected.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            certificates.any { signature ->
                val digest = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
                MessageDigest.isEqual(expectedBytes, digest)
            }
        }.getOrDefault(false)
    }
}
