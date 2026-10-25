package org.agent567.android.ui

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.agent567.android.app.ThemeMode
import org.agent567.android.ui.preview.*
import org.junit.Rule
import org.junit.runner.RunWith
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/** Captures real production Compose screens in an isolated emulator, never a logged-in app. */
@RunWith(AndroidJUnit4::class)
class MobileWorkspaceScreenshotTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test fun captureMobileWorkspaceScreens() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val profile = InstrumentationRegistry.getArguments().getString("profile") ?: "phone"
        val output = File(instrumentation.targetContext.getExternalFilesDir(null), "workspace-screenshots/$profile").apply { mkdirs() }
        var scene by mutableStateOf("home")
        var theme by mutableStateOf(ThemeMode.Light)
        instrumentation.runOnMainSync { composeRule.activity.enableEdgeToEdge() }
        composeRule.setContent {
            key(scene, theme) {
                when (scene) {
                    "home" -> HomePreview(theme)
                    "sessions" -> SessionsPreview(theme)
                    "profile" -> ProfilePreview(theme)
                    "connections" -> ConnectionsPreview(theme)
                    "chat" -> ChatPreview(theme)
                    "welcome" -> WelcomePreview(theme)
                    "device" -> DevicePreview(theme)
                }
            }
        }
        for (mode in listOf(ThemeMode.Light, ThemeMode.Dark)) {
            for (page in listOf("home", "sessions", "profile", "connections", "chat", "welcome", "device")) {
                composeRule.runOnIdle { scene = page; theme = mode }
                composeRule.waitForIdle()
                val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
                File(output, "$page-${mode.name.lowercase()}.png").outputStream().use {
                    assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG, 100, it))
                }
                screenshot.recycle()
            }
        }
    }
}
