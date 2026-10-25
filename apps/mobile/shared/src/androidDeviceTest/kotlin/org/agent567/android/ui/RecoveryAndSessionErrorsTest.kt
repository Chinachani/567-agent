package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.remote.RemoteCaptureRecoveryCard
import org.agent567.android.ui.sessions.SessionsScreen
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class RecoveryAndSessionErrorsTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()
    @Test fun recoveryHasWorkingRetryAndExitActions() {
        var retries = 0
        var exits = 0
        composeRule.setContent { Agent567Theme(ThemeMode.Light) {
            RemoteCaptureRecoveryCard(Str.remoteCaptureFailed, { retries++ }, { exits++ })
        } }
        composeRule.onNodeWithText(Str.remoteReconnect).assertIsDisplayed().performClick()
        composeRule.onNodeWithText(Str.remoteExit).assertIsDisplayed().performClick()
        assertEquals(1, retries)
        assertEquals(1, exits)
    }
    @Test fun deletionFailureIsVisibleOnTheSessionListWithRetryAndDismiss() {
        var retries = 0
        var dismissals = 0
        composeRule.setContent { Agent567Theme(ThemeMode.Light) {
            SessionsScreen(emptyList(), "", 0, {}, {}, {}, {}, { _, _ -> }, {},
                operationError = "Computer unavailable", onRetryOperation = { retries++ }, onDismissOperationError = { dismissals++ })
        } }
        composeRule.onNodeWithText("Computer unavailable").assertIsDisplayed()
        composeRule.onNodeWithText(Str.retry).performClick()
        composeRule.onNodeWithText(Str.close).performClick()
        assertEquals(1, retries)
        assertEquals(1, dismissals)
    }    @Test fun aMissingDeviceDoesNotNavigateDuringComposition() {
        var backs = 0
        composeRule.setContent { Agent567Theme(ThemeMode.Light) {
            org.agent567.android.ui.connect.DeviceDetailRecovery(false) { backs++ }
        } }
        composeRule.onNodeWithText(Str.desktopUnavailable).assertIsDisplayed()
        assertEquals(0, backs)
        composeRule.onNodeWithText(Str.back).performClick()
        assertEquals(1, backs)
    }

}
