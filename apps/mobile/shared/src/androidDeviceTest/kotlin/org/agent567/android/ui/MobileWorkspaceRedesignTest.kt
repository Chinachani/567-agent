package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import android.view.WindowManager
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.core.model.ChatRole
import org.agent567.android.domain.device.SessionListItem
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.ui.chat.ChatScreen
import org.agent567.android.ui.components.Agent567BottomBar
import org.agent567.android.ui.components.FeatureGuideDialog
import org.agent567.android.ui.home.HomeScreen
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.navigation.ChatSurface
import org.agent567.android.ui.navigation.MainTab
import org.agent567.android.ui.sessions.SessionsScreen
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class MobileWorkspaceRedesignTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test fun smallScreenWithLargeTextCanStartWriteAndSendAConversation() {
        var page by mutableStateOf("home")
        var draft by mutableStateOf("")
        var sent by mutableStateOf("")
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().runOnMainSync {
            composeRule.activity.enableEdgeToEdge()
            composeRule.activity.window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        composeRule.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1.5f)) {
                Agent567Theme(ThemeMode.Dark) {
                    Box(Modifier.fillMaxSize()) {
                        if (page == "home") HomeScreen(null, emptyList(), {}, {}, {}, {},
                            onOpenSession = {}, onNewConversation = { page = "chat" }, onUseCloudAi = {})
                        else ChatScreen(
                            title = "Small screen conversation", surface = ChatSurface.Desktop,
                            messages = if (sent.isEmpty()) emptyList() else listOf(LocalMessage(
                                id = "sent", sessionId = "test", role = ChatRole.User,
                                content = sent, status = MessageStatus.Complete, createdAtEpochMs = 1)),
                            draft = draft, pendingImages = emptyList(), isStreaming = false,
                            models = emptyList(), selectedModel = null, modelPickerOpen = false, chatError = null,
                            onDraftChange = { draft = it }, onSend = { sent = draft; draft = "" }, onStop = {}, onBack = { page = "home" },
                            onOpenModelPicker = {}, onCloseModelPicker = {}, onSelectModel = {}, onErrorAction = {},
                            onDismissError = {}, onImagesPicked = {}, onRemovePendingImage = {},
                        )
                    }
                }
            }
        }
        composeRule.onNodeWithText(Str.newConversation).performScrollTo().performClick()
        composeRule.onNode(hasSetTextAction()).performTextInput("A task from the phone")
        composeRule.onNodeWithContentDescription(Str.attach).assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
        composeRule.onNodeWithContentDescription(Str.send).assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp).performClick()
        composeRule.waitUntil(5_000) { composeRule.onNodeWithText("A task from the phone").isDisplayed() }
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "large-text-semantics.txt").writeText(composeRule.onRoot(useUnmergedTree = true).printToString())
        java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "large-text-after-send.png").outputStream().use {
            checkNotNull(instrumentation.uiAutomation.takeScreenshot()).compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        composeRule.onNodeWithText("A task from the phone").assertIsDisplayed()
        composeRule.runOnIdle { assertEquals("A task from the phone", sent); assertEquals("", draft) }
    }

    @Test fun systemIconsFollowTheAppThemeAndRestoreWhenItCloses() {
        var theme by mutableStateOf(ThemeMode.Light)
        var showing by mutableStateOf(true)
        val controller = androidx.core.view.WindowCompat.getInsetsController(composeRule.activity.window, composeRule.activity.window.decorView)
        var originalLightStatus = false
        composeRule.runOnUiThread { originalLightStatus = controller.isAppearanceLightStatusBars }
        composeRule.setContent { if (showing) Agent567Theme(theme) { androidx.compose.material3.Text("Theme") } }
        composeRule.runOnIdle { assertEquals(true, controller.isAppearanceLightStatusBars); theme = ThemeMode.Dark }
        composeRule.runOnIdle { assertEquals(false, controller.isAppearanceLightStatusBars); showing = false }
        composeRule.runOnIdle { assertEquals(originalLightStatus, controller.isAppearanceLightStatusBars) }
    }

    @Test fun populatedSessionListKeepsTheNewConversationEntry() {
        var opened = 0
        val session = SessionListItem("session", "Existing task", "", Str.filterCloud, "now", true)
        composeRule.setContent { Agent567Theme(ThemeMode.Light) {
            SessionsScreen(listOf(session), "", 0, {}, {}, {}, { opened++ }, { _, _ -> }, {})
        } }
        composeRule.onNodeWithText(session.title).assertIsDisplayed()
        composeRule.onNodeWithContentDescription(Str.newConversation).performClick()
        assertEquals(1, opened)
    }

    @Test fun bottomNavigationExposesOneSelectedDestinationWithAndWithoutLabels() {
        var labels by mutableStateOf(true)
        var selected by mutableStateOf(MainTab.Home)
        composeRule.setContent { Agent567Theme(ThemeMode.Light) {
            Agent567BottomBar(selected, { selected = it }, showLabels = labels)
        } }
        composeRule.onNodeWithText(Str.tabSessions).performClick().assertIsSelected()
        composeRule.runOnIdle { labels = false }
        composeRule.onNodeWithContentDescription(Str.tabMe).performClick().assertIsSelected()
        assertEquals(MainTab.Me, selected)
    }

    @Test fun guideHasFullRowTopicsAndReadableSteps() {
        composeRule.setContent { Agent567Theme(ThemeMode.Dark) { FeatureGuideDialog {} } }
        composeRule.onNodeWithText("直接在手机对话").assertIsDisplayed()
        composeRule.onNodeWithText("登录账号后，选择对话分组和模型。").assertIsDisplayed()
        composeRule.onNodeWithText("远程控制与输入").performScrollTo().performClick()
        composeRule.onNodeWithText("在电脑确认共享画面，远程输入需单独开启并同意系统授权。").performScrollTo().assertIsDisplayed()
    }
}
