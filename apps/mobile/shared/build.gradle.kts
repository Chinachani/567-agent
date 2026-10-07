import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidMultiplatformLibrary)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.kotlinSerialization)
}

val mobileVersionFile = rootProject.file("version.properties")
val generatedVersionDir = layout.buildDirectory.dir("generated/app-version/commonMain/kotlin")
val generateMobileVersionSource = tasks.register("generateMobileVersionSource") {
    inputs.file(mobileVersionFile)
    outputs.dir(generatedVersionDir)
    doLast {
        val properties = Properties().apply { mobileVersionFile.inputStream().use(::load) }
        val versionName = properties.getProperty("versionName")
        val versionCode = properties.getProperty("versionCode").toInt()
        require(versionName.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+"))) {
            "Invalid mobile versionName: $versionName"
        }
        require(versionCode > 0) { "Invalid mobile versionCode: $versionCode" }
        val output = generatedVersionDir.get().file("org/agent567/android/AppVersion.kt").asFile
        output.parentFile.mkdirs()
        output.writeText(
            """package org.agent567.android

object AppVersion {
    const val NAME = "$versionName"
    const val CODE = $versionCode
}
""",
        )
    }
}

tasks.configureEach {
	// KMP uses task names such as compileAndroidMain (without "Kotlin") for
	// Android source-set compilations, so match all compile tasks in this module.
	if (name.startsWith("compile")) {
		dependsOn(generateMobileVersionSource)
	}
}

kotlin {
    android {
        namespace = "org.agent567.android.shared"
        compileSdk = libs.versions.android.compileSdk.get().toInt()
        minSdk = libs.versions.android.minSdk.get().toInt()

        compilerOptions {
            jvmTarget = JvmTarget.JVM_11
        }
        androidResources {
            enable = true
        }
        withHostTest {
            isIncludeAndroidResources = true
        }
        withDeviceTestBuilder {
            sourceSetTreeName = "test"
        }.configure {
            instrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.compose.runtime)
            implementation(libs.compose.foundation)
            implementation(libs.compose.material3)
            implementation(libs.compose.ui)
            implementation(libs.compose.components.resources)
            implementation(libs.compose.uiToolingPreview)
            implementation(libs.compose.material.icons.core)
            implementation(libs.compose.material.icons.extended)
            implementation(libs.multiplatform.markdown.renderer)
            implementation(libs.multiplatform.markdown.renderer.m3)
            implementation(libs.androidx.lifecycle.viewmodelCompose)
            implementation(libs.androidx.lifecycle.runtimeCompose)

            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)

            implementation(libs.ktor.client.core)
            implementation(libs.ktor.client.content.negotiation)
            implementation(libs.ktor.client.auth)
            implementation(libs.ktor.client.logging)
            implementation(libs.ktor.client.websockets)
            implementation(libs.ktor.serialization.kotlinx.json)

            implementation(libs.multiplatform.settings)
            implementation(libs.multiplatform.settings.no.arg)
        }
        commonMain {
            kotlin.srcDir(generatedVersionDir)
        }
        androidMain.dependencies {
            implementation(libs.compose.uiToolingPreview)
            implementation(libs.compose.uiTooling)
            implementation(libs.ktor.client.okhttp)
            implementation(libs.kotlinx.coroutines.android)
            implementation(libs.androidx.activity.compose)
            implementation(libs.androidx.core.ktx)
            implementation(libs.androidx.exifinterface)
            implementation(libs.webrtc.android)
            implementation(libs.androidx.camera.camera2)
            implementation(libs.androidx.camera.lifecycle)
            implementation(libs.androidx.camera.mlkit.vision)
            implementation(libs.androidx.camera.view)
            implementation(libs.mlkit.barcode.scanning)
        }
        getByName("androidDeviceTest").dependencies {
            implementation(libs.androidx.activity.compose)
            implementation(libs.androidx.compose.uiTestJunit4)
            implementation(libs.androidx.compose.uiTestManifest)
            implementation(libs.androidx.testExt.junit)
            implementation(libs.androidx.espresso.core)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
            implementation(libs.multiplatform.settings.test)
            implementation(libs.kotlinx.coroutines.test)
        }
    }
}

dependencies {
    androidRuntimeClasspath(libs.compose.uiTooling)
}
