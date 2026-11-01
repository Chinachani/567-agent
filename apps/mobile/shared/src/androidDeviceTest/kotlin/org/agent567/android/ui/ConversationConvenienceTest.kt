package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.core.model.ChatRole
import org.agent567.android.domain.device.*
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.ui.chat.MessageBubble
import org.agent567.android.ui.home.HomeScreen
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.*

@RunWith(AndroidJUnit4::class)
class ConversationConvenienceTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun editingAnOlderMessageConfirmsDraftOverwriteAndNeverSends() {
        var draft by mutableStateOf("Unsent draft")
        rule.setContent { Agent567Theme(ThemeMode.Dark) {
            MessageBubble(message = LocalMessage(id = "old", sessionId = "session", role = ChatRole.User, content = "Earlier prompt", status = MessageStatus.Complete, createdAtEpochMs = 1L), onEdit = { draft = it }, hasDraft = draft.isNotBlank())
        } }
        rule.onNodeWithContentDescription(Str.editMessage).performClick()
        rule.onNodeWithText(Str.cancel).performClick()
        assertEquals("Unsent draft", draft)
        rule.onNodeWithContentDescription(Str.editMessage).performClick()
        rule.onNodeWithText(Str.confirm).performClick()
        assertEquals("Earlier prompt", draft)
        rule.onNodeWithText("Earlier prompt").assertIsDisplayed()
    }

    @Test fun homeShowsCurrentDesktopConversationAndRemovesHandoffOnDisconnect() {
        var device by mutableStateOf(DesktopDevice("pc-2", "Work PC", "Linux", "paired", DeviceStatus.Online, activeConversation = DesktopActiveConversation("remote-7", "Current desktop work", "running")))
        var target: Pair<String, String>? = null
        rule.setContent { Agent567Theme(ThemeMode.Dark) {
            HomeScreen(device, emptyList(), {}, {}, {}, {}, {}, {}, {}, onContinueDesktopSession = { pc, session -> target = pc to session })
        } }
        rule.onNodeWithText("Current desktop work").performClick()
        assertEquals("pc-2" to "remote-7", target)
        rule.runOnIdle { device = device.copy(activeConversation = device.activeConversation?.copy(status = "waiting")) }
        rule.onNodeWithText(Str.desktopWaiting).assertIsDisplayed()
        rule.runOnIdle { device = device.copy(status = DeviceStatus.Offline) }
        rule.onNodeWithText("Current desktop work").assertDoesNotExist()
    }
}
