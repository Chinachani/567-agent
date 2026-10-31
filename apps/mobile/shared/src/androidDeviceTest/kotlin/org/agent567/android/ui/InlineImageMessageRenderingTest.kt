package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.core.model.ChatRole
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.ui.chat.MessageBubble
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class InlineImageMessageRenderingTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun legacyTruncatedImageDataDoesNotBlockTextLayoutOrReserveImageHeight() {
        val source = "Image ready\n\n![generated](data:image/png;base64," + "A".repeat(1_000_000)
        val message = LocalMessage("reply", "chat", ChatRole.Assistant, source, MessageStatus.Aborted, 1)
        rule.setContent {
            Agent567Theme(ThemeMode.Dark) {
                Column {
                    MessageBubble(message)
                    Text("after-message")
                }
            }
        }
        rule.onNodeWithText("Image ready").assertIsDisplayed()
        rule.onNodeWithText("after-message").assertIsDisplayed()
        rule.onAllNodes(hasText("data:image/", substring = true)).assertCountEquals(0)
        assertEquals(source, message.content)
    }
}
