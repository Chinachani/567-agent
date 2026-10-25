import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties
import java.util.zip.ZipFile
import com.android.build.api.artifact.SingleArtifact

plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.composeCompiler)
}

val releaseStorePath = providers.gradleProperty("AGENT567_ANDROID_KEYSTORE_PATH")
	.orElse(providers.environmentVariable("AGENT567_ANDROID_KEYSTORE_PATH"))
	.orElse(providers.gradleProperty("AGENT567_ANDROID_KEYSTORE_PATH"))
	.orElse(providers.environmentVariable("AGENT567_ANDROID_KEYSTORE_PATH"))
	.orNull
val releaseStorePassword = providers.gradleProperty("AGENT567_ANDROID_KEYSTORE_PASSWORD")
	.orElse(providers.environmentVariable("AGENT567_ANDROID_KEYSTORE_PASSWORD"))
	.orElse(providers.gradleProperty("AGENT567_ANDROID_KEYSTORE_PASSWORD"))
	.orElse(providers.environmentVariable("AGENT567_ANDROID_KEYSTORE_PASSWORD"))
	.orNull
val releaseKeyAlias = providers.gradleProperty("AGENT567_ANDROID_KEY_ALIAS")
	.orElse(providers.environmentVariable("AGENT567_ANDROID_KEY_ALIAS"))
	.orElse(providers.gradleProperty("AGENT567_ANDROID_KEY_ALIAS"))
	.orElse(providers.environmentVariable("AGENT567_ANDROID_KEY_ALIAS"))
	.orNull
val releaseKeyPassword = providers.gradleProperty("AGENT567_ANDROID_KEY_PASSWORD")
	.orElse(providers.environmentVariable("AGENT567_ANDROID_KEY_PASSWORD"))
	.orElse(providers.gradleProperty("AGENT567_ANDROID_KEY_PASSWORD"))
	.orElse(providers.environmentVariable("AGENT567_ANDROID_KEY_PASSWORD"))
	.orNull

val migrationStorePath = providers.gradleProperty("AGENT567_ANDROID_MIGRATION_KEYSTORE_PATH")
	.orElse(providers.environmentVariable("AGENT567_ANDROID_MIGRATION_KEYSTORE_PATH"))
	.orElse(providers.gradleProperty("AGENT567_ANDROID_MIGRATION_KEYSTORE_PATH"))
	.orElse(providers.environmentVariable("AGENT567_ANDROID_MIGRATION_KEYSTORE_PATH"))
	.orNull
val migrationStorePassword = providers.gradleProperty("AGENT567_ANDROID_MIGRATION_KEYSTORE_PASSWORD")
	.orElse(providers.environmentVariable("AGENT567_ANDROID_MIGRATION_KEYSTORE_PASSWORD"))
	.orElse(providers.gradleProperty("AGENT567_ANDROID_MIGRATION_KEYSTORE_PASSWORD"))
	.orElse(providers.environmentVariable("AGENT567_ANDROID_MIGRATION_KEYSTORE_PASSWORD"))
	.orNull
val migrationKeyAlias = providers.gradleProperty("AGENT567_ANDROID_MIGRATION_KEY_ALIAS")
	.orElse(providers.environmentVariable("AGENT567_ANDROID_MIGRATION_KEY_ALIAS"))
	.orElse(providers.gradleProperty("AGENT567_ANDROID_MIGRATION_KEY_ALIAS"))
	.orElse(providers.environmentVariable("AGENT567_ANDROID_MIGRATION_KEY_ALIAS"))
	.orNull
val migrationKeyPassword = providers.gradleProperty("AGENT567_ANDROID_MIGRATION_KEY_PASSWORD")
	.orElse(providers.environmentVariable("AGENT567_ANDROID_MIGRATION_KEY_PASSWORD"))
	.orElse(providers.gradleProperty("AGENT567_ANDROID_MIGRATION_KEY_PASSWORD"))
	.orElse(providers.environmentVariable("AGENT567_ANDROID_MIGRATION_KEY_PASSWORD"))
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
        create("debugTest") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".test"
            versionNameSuffix = "-test"
            matchingFallbacks += listOf("debug")
        }
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

androidComponents.onVariants { variant ->
    val capitalizedName = variant.name.replaceFirstChar { it.uppercase() }
    val apkDirectory = variant.artifacts.get(SingleArtifact.APK)
    val brandSource = project(":shared").layout.projectDirectory.file("src/commonMain/composeResources/drawable/brand_icon.png")
    val verifyResources = tasks.register("verify${capitalizedName}PackagedResources") {
        inputs.dir(apkDirectory)
        inputs.file(brandSource)
        doLast {
            val apks = apkDirectory.get().asFile.listFiles().orEmpty().filter { it.extension == "apk" }
            check(apks.isNotEmpty()) { "No APK found for ${variant.name}" }
            val resourcePath = "assets/composeResources/org.agent567.android.resources/drawable/brand_icon.png"
            apks.forEach { apk ->
                ZipFile(apk).use { zip ->
                    val entry = checkNotNull(zip.getEntry(resourcePath)) { "Missing About image in ${apk.name}: $resourcePath" }
                    check(zip.getInputStream(entry).use { it.readBytes() }.contentEquals(brandSource.asFile.readBytes())) {
                        "Packaged About image differs from source in ${apk.name}"
                    }
                }
            }
        }
    }
    tasks.matching { it.name == "assemble$capitalizedName" }.configureEach { dependsOn(verifyResources) }
}
