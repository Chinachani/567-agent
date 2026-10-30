package org.agent567.android.ui.chat

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.domain.session.ToolTrace
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ToolTraceDetailsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    @Test fun identicalResultAndDetailAreDisplayedOnlyOnceWhenExpanded() {
        rule.setContent { Agent567Theme(ThemeMode.Light) {
            ToolTraceRow(ToolTrace("completed", "image", "generate_image", detail = "Image saved", arguments = "draw a poster", result = "Image saved"))
        } }
        rule.onNodeWithContentDescription(Str.showToolDetails).performClick()
        rule.onAllNodesWithText("Image saved").assertCountEquals(1)
        rule.onNodeWithText(Str.toolImagePrompt).assertIsDisplayed()
        rule.onNodeWithText("draw a poster").assertIsDisplayed()
    }
    @Test fun distinctDetailIsRetainedAndFailedGenerationDoesNotSayCompleted() {
        rule.setContent { Agent567Theme(ThemeMode.Dark) {
            ToolTraceRow(ToolTrace("error", "image", "generate_image", detail = "Provider diagnostics", result = Str.toolImageMissing))
        } }
        rule.onNodeWithContentDescription(Str.showToolDetails).performClick()
        rule.onNodeWithText("Provider diagnostics").assertIsDisplayed()
        rule.onNodeWithText(Str.toolImageMissing).assertIsDisplayed()
        rule.onAllNodesWithText(Str.toolCompleted).assertCountEquals(0)
    }
}
