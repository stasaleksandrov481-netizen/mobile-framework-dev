plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "qa.cortex.calculator"
    compileSdk = 36
    defaultConfig {
        applicationId = "qa.cortex.calculator"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "test-only"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
