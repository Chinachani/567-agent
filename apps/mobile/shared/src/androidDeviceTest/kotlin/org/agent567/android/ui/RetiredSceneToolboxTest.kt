package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.domain.conversation.RemoteToolboxAbility
import org.agent567.android.ui.theme.Agent567Theme
import org.agent567.android.ui.toolbox.ToolboxScreen
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class RetiredSceneToolboxTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test fun oldDesktopScenesAreHiddenAndOrdinarySkillsStillRequireInstallConfirmation() {
        fun ability(type: String, name: String) = RemoteToolboxAbility(
            slug = name, type = type, name = name, description = "description", version = "1",
            author = "", category = "", tags = emptyList(), installable = true, installed = false,
        )
        val skill = ability("skill", "Review skill")
        var installed: RemoteToolboxAbility? = null
        composeRule.setContent { Agent567Theme(ThemeMode.Dark) {
            ToolboxScreen("Toolbox", listOf(ability("scene", "Retired scene"), skill), "", false, null,
                {}, {}, { installed = it }, {}, {}, "Work computer")
        } }
        composeRule.onNodeWithText("Retired scene").assertDoesNotExist()
        composeRule.onNodeWithText(skill.name).assertIsDisplayed()
        composeRule.onNodeWithText("安装到电脑").performClick()
        composeRule.runOnIdle { assertEquals(null, installed) }
        composeRule.onNodeWithText("安装", useUnmergedTree = true).performClick()
        composeRule.runOnIdle { assertEquals(skill, installed) }
    }
}
