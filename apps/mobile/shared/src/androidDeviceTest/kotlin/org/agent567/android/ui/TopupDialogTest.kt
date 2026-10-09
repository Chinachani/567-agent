package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.ui.me.TopupDialog
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.Test

@RunWith(AndroidJUnit4::class)
class TopupDialogTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun opensWithPaymentActionVisibleWithoutDragging() {
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                TopupDialog(
                    user = null,
                    onDismiss = {},
                    onTopupWithKey = { _, _ -> },
                    onCreatePayOrder = { _, _, _, _ -> },
                    onRefreshQuota = {},
                )
            }
        }

        composeRule.onNodeWithText("账户额度充值").assertIsDisplayed()
        composeRule.onNodeWithText("前往支付").assertIsDisplayed()
    }
}
