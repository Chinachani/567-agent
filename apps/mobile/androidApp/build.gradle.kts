import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.composeCompiler)
}

val releaseStorePath = providers.gradleProperty("VETTA_ANDROID_KEYSTORE_PATH")
	.orElse(providers.environmentVariable("VETTA_ANDROID_KEYSTORE_PATH"))
	.orNull
val releaseStorePassword = providers.gradleProperty("VETTA_ANDROID_KEYSTORE_PASSWORD")
	.orElse(providers.environmentVariable("VETTA_ANDROID_KEYSTORE_PASSWORD"))
	.orNull
val releaseKeyAlias = providers.gradleProperty("VETTA_ANDROID_KEY_ALIAS")
	.orElse(providers.environmentVariable("VETTA_ANDROID_KEY_ALIAS"))
	.orNull
val releaseKeyPassword = providers.gradleProperty("VETTA_ANDROID_KEY_PASSWORD")
	.orElse(providers.environmentVariable("VETTA_ANDROID_KEY_PASSWORD"))
	.orNull

val migrationStorePath = providers.gradleProperty("VETTA_ANDROID_MIGRATION_KEYSTORE_PATH")
	.orElse(providers.environmentVariable("VETTA_ANDROID_MIGRATION_KEYSTORE_PATH"))
	.orNull
val migrationStorePassword = providers.gradleProperty("VETTA_ANDROID_MIGRATION_KEYSTORE_PASSWORD")
	.orElse(providers.environmentVariable("VETTA_ANDROID_MIGRATION_KEYSTORE_PASSWORD"))
	.orNull
val migrationKeyAlias = providers.gradleProperty("VETTA_ANDROID_MIGRATION_KEY_ALIAS")
	.orElse(providers.environmentVariable("VETTA_ANDROID_MIGRATION_KEY_ALIAS"))
	.orNull
val migrationKeyPassword = providers.gradleProperty("VETTA_ANDROID_MIGRATION_KEY_PASSWORD")
	.orElse(providers.environmentVariable("VETTA_ANDROID_MIGRATION_KEY_PASSWORD"))
	.orNull

val mobileVersion = Properties().apply {
	rootProject.file("version.properties").inputStream().use(::load)
}
val mobileVersionName = mobileVersion.getProperty("versionName")
val mobileVersionCode = mobileVersion.getProperty("versionCode").toInt()

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_11
    }
}
dependencies {
    implementation(project(":shared"))

    implementation(libs.androidx.activity.compose)

    implementation(libs.compose.uiToolingPreview)
    debugImplementation(libs.compose.uiTooling)
}

android {
    namespace = "org.agent567.android"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    signingConfigs {
        create("release") {
            storeFile = releaseStorePath?.let { file(it) } ?: file("release-signing-not-configured.keystore")
            storePassword = releaseStorePassword.orEmpty()
            keyAlias = releaseKeyAlias.orEmpty()
            keyPassword = releaseKeyPassword.orEmpty()
        }
        create("migration") {
            storeFile = migrationStorePath?.let { file(it) } ?: file("migration-signing-not-configured.keystore")
            storePassword = migrationStorePassword.orEmpty()
            keyAlias = migrationKeyAlias.orEmpty()
            keyPassword = migrationKeyPassword.orEmpty()
        }
    }

    defaultConfig {
        applicationId = "com.api567.agent"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.targetSdk.get().toInt()
        versionCode = mobileVersionCode
        versionName = mobileVersionName
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        create("migration") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("migration")
            versionNameSuffix = "-migration"
            matchingFallbacks += listOf("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
    }
}
