package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.core.chat.InferenceApi
import org.agent567.android.domain.session.ChatContextSnapshot
import org.agent567.android.ui.chat.ChatInferenceApiSettings
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.*

@RunWith(AndroidJUnit4::class)
class ChatInferenceApiSettingsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    @Test fun userSelectsManualProtocolAndRestoresAutomatic() {
        var state by mutableStateOf(ChatContextSnapshot(modelKey = "codex", automaticInferenceApi = InferenceApi.Responses.wireValue))
        var enabled by mutableStateOf(true)
        rule.setContent { Agent567Theme(ThemeMode.Light) {
            ChatInferenceApiSettings(state, enabled, onChange = { state = state.copy(inferenceApiOverride = it?.wireValue) })
        } }
        val auto = "${Str.modelProtocolAuto} · ${Str.modelProtocolResponses}"
        rule.onNodeWithText(auto).performClick()
        rule.onNodeWithText(Str.modelProtocolCompletions, substring = false).performClick()
        rule.runOnIdle { assertEquals(InferenceApi.Completions.wireValue, state.inferenceApiOverride) }
        rule.onNodeWithText(Str.modelProtocolCompletions).performClick()
        rule.onNodeWithText(auto).performClick()
        rule.runOnIdle { assertNull(state.inferenceApiOverride); enabled = false }
        rule.onNodeWithText(auto).assertIsNotEnabled()
    }
}
