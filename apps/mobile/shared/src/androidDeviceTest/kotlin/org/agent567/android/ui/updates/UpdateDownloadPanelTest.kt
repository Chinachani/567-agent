package org.agent567.android.ui.updates

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.*

@RunWith(AndroidJUnit4::class)
class UpdateDownloadPanelTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun userPausesResumesThenChoosesInstallationFromTheProgressPanel() {
        val state = mutableStateOf(UpdateDownloadState(UpdateDownloadPhase.Downloading, "v9.0.0", 1024, 4096))
        val actions = mutableListOf<String>()
        rule.setContent { Agent567Theme(ThemeMode.Light) {
            UpdateDownloadPanel(state.value,
                onPause = { actions += "pause"; state.value = state.value.copy(phase = UpdateDownloadPhase.Paused) },
                onResume = { actions += "resume"; state.value = state.value.copy(phase = UpdateDownloadPhase.Downloading) },
                onInstall = { actions += "install" })
        } }
        rule.onNodeWithText(Str.updateDownloadProgress(1024, 4096)).assertIsDisplayed()
        rule.onNodeWithText(Str.updateDownloadPause).performClick()
        rule.onNodeWithText(Str.updateDownloadPaused).assertIsDisplayed()
        rule.onNodeWithText(Str.updateDownloadResume).performClick()
        rule.onNodeWithText(Str.updateDownloadPause).assertIsDisplayed()
        rule.runOnIdle { state.value = state.value.copy(phase = UpdateDownloadPhase.Ready, downloadedBytes = 4096) }
        rule.onNodeWithText(Str.updateDownloadInstall).performClick()
        rule.runOnIdle { assertEquals(listOf("pause", "resume", "install"), actions) }
    }
}
