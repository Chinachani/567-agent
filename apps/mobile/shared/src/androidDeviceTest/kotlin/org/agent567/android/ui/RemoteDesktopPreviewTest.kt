package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.remote.RemoteDesktopPreview
import org.agent567.android.ui.remote.RemotePreviewPhase
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.Test
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class RemoteDesktopPreviewTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test fun smallPreviewOffersRecoveryAtLargeTextSizeAndFullscreenOnlyAfterReady() {
        var phase by mutableStateOf(RemotePreviewPhase.Waiting)
        var closed = false
        var fullscreen = false
        composeRule.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1.5f)) {
                Agent567Theme(ThemeMode.Dark) {
                    Box(Modifier.width(280.dp)) {
                        RemoteDesktopPreview(
                            phase, if (phase == RemotePreviewPhase.Failed) Str.remoteCaptureRevoked else null,
                            onRetry = { phase = RemotePreviewPhase.Waiting }, onClose = { closed = true },
                            onFullscreen = { fullscreen = true },
                        ) { }
                    }
                }
            }
        }
        composeRule.onNodeWithText(Str.remoteCaptureWaiting).assertIsDisplayed()
        composeRule.onNodeWithText(Str.remoteDesktopFullscreen).assertDoesNotExist()
        composeRule.runOnIdle { phase = RemotePreviewPhase.Failed }
        composeRule.onNodeWithText(Str.remoteCaptureRevoked).assertIsDisplayed()
        composeRule.onNodeWithText(Str.remoteReconnect).assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
        composeRule.onNodeWithText(Str.remoteCaptureWaiting).assertIsDisplayed()
        composeRule.runOnIdle { phase = RemotePreviewPhase.Ready }
        composeRule.onNodeWithText(Str.remoteDesktopFullscreen).assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertTrue(fullscreen); phase = RemotePreviewPhase.Failed }
        composeRule.onNodeWithText(Str.remoteClosePreview).assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
        composeRule.runOnIdle { assertTrue(closed) }
    }
}
