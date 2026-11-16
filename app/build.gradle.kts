import java.net.URI
import java.security.KeyFactory
import java.security.interfaces.RSAPublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val previousPreview = providers.gradleProperty("cortexPreview").map(String::toBoolean).orElse(false)
fun quotedBuildValue(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
val webUpdateRoot = providers.environmentVariable("CORTEX_WEB_UPDATE_ROOT").orNull.orEmpty().trim()
val webUpdatePublicKey = providers.environmentVariable("CORTEX_WEB_UPDATE_PUBLIC_KEY").orNull.orEmpty().trim()
require(webUpdateRoot.isBlank() == webUpdatePublicKey.isBlank()) {
    "Configure CORTEX_WEB_UPDATE_ROOT and CORTEX_WEB_UPDATE_PUBLIC_KEY together."
}
if (webUpdateRoot.isNotBlank()) {
    val address = URI(webUpdateRoot)
    require(address.scheme == "https" && !address.host.isNullOrBlank() && address.userInfo == null &&
        address.port == -1 && address.query == null && address.fragment == null &&
        ".." !in address.path.orEmpty().split('/')) { "Invalid signed WebView HTTPS update URL." }
    val publicKey = KeyFactory.getInstance("RSA").generatePublic(
        X509EncodedKeySpec(Base64.getDecoder().decode(webUpdatePublicKey))) as RSAPublicKey
    require(publicKey.modulus.bitLength() >= 3072) { "Use a dedicated RSA 3072+ public signing key." }
}

val signingInputs = listOf(
    "CORTEX_KEYSTORE_FILE", "CORTEX_STORE_PASSWORD", "CORTEX_KEY_ALIAS", "CORTEX_KEY_PASSWORD"
).associateWith { providers.environmentVariable(it).orNull?.takeUnless(String::isBlank) }
val hasSigning = signingInputs.values.any { it != null }
if (hasSigning) {
    require(signingInputs.values.none { it == null }) { "Provide all four CORTEX signing environment variables." }
}

android {
    namespace = "app.cortex.assistant"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = if (previousPreview.get()) "app.cortex.assistant.preview.v105" else "app.cortex.assistant"
        minSdk = 26
        targetSdk = 35
        versionCode = 113
        versionName = "1.0.13"
        buildConfigField("String", "CORTEX_WEB_UPDATE_ROOT", quotedBuildValue(webUpdateRoot))
        buildConfigField("String", "CORTEX_WEB_UPDATE_PUBLIC_KEY", quotedBuildValue(webUpdatePublicKey))
    }
    buildFeatures { buildConfig = true }
    signingConfigs {
        if (hasSigning) create("cortexUpdate") {
            storeFile = file(requireNotNull(signingInputs["CORTEX_KEYSTORE_FILE"]))
            storePassword = signingInputs["CORTEX_STORE_PASSWORD"]
            keyAlias = signingInputs["CORTEX_KEY_ALIAS"]
            keyPassword = signingInputs["CORTEX_KEY_PASSWORD"]
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasSigning) signingConfig = signingConfigs.getByName("cortexUpdate")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging {
        resources { excludes += setOf("META-INF/DEPENDENCIES", "META-INF/NOTICE", "META-INF/LICENSE") }
        jniLibs {
            // Compress native libraries in the downloadable APK.
            useLegacyPackaging = true
        }
    }
}

dependencies {
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.browser:browser:1.9.0")
    implementation("androidx.core:core:1.16.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("cz.adaptech.tesseract4android:tesseract4android:4.9.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
