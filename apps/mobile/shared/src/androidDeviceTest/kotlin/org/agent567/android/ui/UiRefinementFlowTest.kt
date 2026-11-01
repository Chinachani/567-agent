package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.User
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.error.UiError
import org.agent567.android.domain.error.UiErrorAction
import org.agent567.android.domain.session.ChatContextSnapshot
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.ui.chat.ChatContextSheet
import org.agent567.android.ui.chat.ChatScreen
import org.agent567.android.ui.connect.DeviceDetailScreen
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.navigation.ChatSurface
import org.agent567.android.ui.me.MeScreen
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.*

@RunWith(AndroidJUnit4::class)
class UiRefinementFlowTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun accountSummaryKeepsProfileBalanceRefreshAndTopupEntryTogether() {
        var profile = 0
        var refreshed = 0
        rule.setContent { Agent567Theme(ThemeMode.Dark) {
            MeScreen(user = User(id = 1, username = "tester", nickname = "tester", quota = 5_000_000), subscription = null,
                themeMode = ThemeMode.Dark, onlineDeviceCount = 0,
                onOpenAccount = { profile++ }, onRefreshQuota = { refreshed++ })
        } }
        rule.onNodeWithText("tester").performClick()
        rule.onNodeWithContentDescription(Str.accountRefresh).performClick()
        rule.onNodeWithText("$10.00").assertIsDisplayed()
        rule.onNodeWithText(Str.mobileTopupAction).assertIsDisplayed()
        rule.onNodeWithText(Str.accountBalanceSection).assertDoesNotExist()
        assertEquals(1, profile)
        assertEquals(1, refreshed)
    }

    @Test fun contextSheetShowsReadableCountsAndKeepsCompactionReachable() {
        var compacted = 0
        rule.setContent { Agent567Theme(ThemeMode.Dark) {
            ChatContextSheet(
                desktop = true,
                snapshot = ChatContextSnapshot(tokens = 6272, contextWindow = 1048576, messageCount = 8),
                loading = false, busy = false, hasSession = true, error = null, notice = null,
                onDismiss = {}, onRefresh = {}, onCompact = { compacted++ }, onAutoChange = {},
                onInferenceApiChange = {}, onOpenWorkbench = {}, onReset = {}, onCancel = {},
            )
        } }
        rule.onNodeWithText("≈ 6,272 tokens").assertIsDisplayed()
        rule.onNodeWithText("< 1%", substring = true).assertIsDisplayed()
        rule.onNodeWithText("1,048,576 tokens").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(Str.contextCompactNow).performScrollTo().performClick()
        assertEquals(1, compacted)
    }

    @Test fun cloudErrorKeepsRouteRetryAndDismissInsideTheErrorActions() {
        var routes = 0
        var dismissed = 0
        var action: UiErrorAction? = null
        var error by mutableStateOf(UiError("Network unavailable", "Try again", UiErrorAction.Retry))
        rule.setContent { Agent567Theme(ThemeMode.Dark) {
            ChatScreen(
                title = "Chat", surface = ChatSurface.Cloud, messages = emptyList(), draft = "Saved draft",
                pendingImages = emptyList(), isStreaming = false, models = emptyList(), selectedModel = null,
                modelPickerOpen = false, chatError = error,
                onOpenServiceRoute = { routes++ }, onErrorAction = { action = it }, onDismissError = { dismissed++ },
                onDraftChange = {}, onSend = {}, onStop = {}, onBack = {}, onOpenModelPicker = {},
                onCloseModelPicker = {}, onSelectModel = {}, onImagesPicked = {}, onRemovePendingImage = {},
            )
        } }
        rule.onNodeWithText(Str.serviceRouteErrorAction).performClick()
        rule.onNodeWithText(Str.actionRetry).performClick()
        rule.onNodeWithText(Str.close).performClick()
        rule.runOnIdle {
            assertEquals(1, routes); assertEquals(1, dismissed); assertEquals(UiErrorAction.Retry, action)
            error = error.copy(action = UiErrorAction.OpenContext)
        }
        rule.onNodeWithText(Str.serviceRouteErrorAction).assertDoesNotExist()
        rule.onNodeWithText(Str.contextManage).performClick()
        assertEquals(UiErrorAction.OpenContext, action)
        rule.onNode(hasText("Saved draft") and hasSetTextAction()).assertIsDisplayed()
    }

    @Test fun deviceDetailsKeepSystemAndHardwareInformationWithoutAnEmptyFooter() {
        var device by mutableStateOf(DesktopDevice("pc", "Work PC", "Linux", "", DeviceStatus.Online))
        rule.setContent { Agent567Theme(ThemeMode.Dark) {
            DeviceDetailScreen(device, false, {}, {}, {}, {})
        } }
        rule.onNodeWithText("Linux").assertIsDisplayed()
        rule.onNodeWithText(Str.systemInfo).assertDoesNotExist()
        rule.runOnIdle { device = device.copy(cpu = "CPU model", ram = "32 GB") }
        rule.onNodeWithText("CPU model").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("32 GB").performScrollTo().assertIsDisplayed()
    }

    @Test fun compactMessageCopyControlRetainsItsExpandedTouchTargetAndCopiesTheReply() {
        rule.setContent { Agent567Theme(ThemeMode.Light) {
            ChatScreen(
                title = "Chat", surface = ChatSurface.Desktop,
                messages = listOf(LocalMessage(id = "reply", sessionId = "session", role = ChatRole.Assistant, content = "Copy this reply", status = MessageStatus.Complete, createdAtEpochMs = 1)),
                draft = "", pendingImages = emptyList(), isStreaming = false, models = emptyList(), selectedModel = null,
                modelPickerOpen = false, chatError = null, onErrorAction = {}, onDismissError = {},
                onDraftChange = {}, onSend = {}, onStop = {}, onBack = {}, onOpenModelPicker = {},
                onCloseModelPicker = {}, onSelectModel = {}, onImagesPicked = {}, onRemovePendingImage = {},
            )
        } }
        val copy = rule.onNodeWithContentDescription(Str.copyContent)
        copy.assertHeightIsEqualTo(28.dp)
        val touch = copy.fetchSemanticsNode().touchBoundsInRoot
        with(rule.density) { assertTrue(touch.height >= 48.dp.toPx()); assertTrue(touch.width >= 48.dp.toPx()) }
        copy.performClick()
        rule.onNodeWithText(Str.copiedContent).assertIsDisplayed()
    }
}
