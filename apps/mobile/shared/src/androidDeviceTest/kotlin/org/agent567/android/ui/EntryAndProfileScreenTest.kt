package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.agent567.android.app.ThemeMode
import org.agent567.android.core.model.User
import org.agent567.android.ui.auth.WelcomeScreen
import org.agent567.android.ui.auth.LoginScreen
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.me.AccountScreen
import org.agent567.android.ui.me.MeScreen
import org.agent567.android.ui.me.AboutScreen
import org.agent567.android.ui.me.PlanScreen
import org.agent567.android.ui.theme.Agent567Theme
import kotlin.test.Test
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class EntryAndProfileScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun opensFeatureGuideFromMeAndShowsFirstTaskSteps() {
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                MeScreen(user = null, subscription = null, themeMode = ThemeMode.Light, onlineDeviceCount = 0)
            }
        }
        composeRule.onNodeWithText("功能指南").performScrollTo().performClick()
        composeRule.onNodeWithText("直接在手机对话").assertIsDisplayed()
        composeRule.onNodeWithText("关闭").performClick()
        composeRule.onNodeWithText("功能指南").assertIsDisplayed()
    }

    @Test
    fun accountSecurityFormsSubmitInsideTheApp() {
        var passwordChange: Pair<String, String>? = null
        var codeEmail: String? = null
        var emailBinding: Pair<String, String>? = null
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                AccountScreen(user = User(id = 1, username = "tester", nickname = "Tester"),
                    onBack = {}, onLogin = {}, onLogout = {}, onRefresh = {}, onSaveName = { _, done -> done(null) },
                    onChangePassword = { original, new, done -> passwordChange = original to new; done(null) },
                    onSendEmailCode = { email, done -> codeEmail = email; done(null) },
                    onBindEmail = { email, code, done -> emailBinding = email to code; done(null) })
            }
        }
        composeRule.onNodeWithText("修改登录密码").performScrollTo().performClick()
        composeRule.onNodeWithText("当前密码").performTextInput("old-password")
        composeRule.onNodeWithText("新密码").performTextInput("new-password")
        composeRule.onNodeWithText("确认新密码").performTextInput("new-password")
        composeRule.onNodeWithText("确认修改").performClick()
        composeRule.runOnIdle { assertTrue(passwordChange == "old-password" to "new-password") }
        composeRule.onNodeWithText("密码已修改").assertIsDisplayed()
        composeRule.onNodeWithText("邮箱").performScrollTo().performClick()
        composeRule.onNodeWithText("邮箱地址").performTextInput("native@example.test")
        composeRule.onNodeWithText("发送验证码").performClick()
        composeRule.onNodeWithText("验证码").performTextInput("123456")
        composeRule.onNodeWithText("确认修改").performClick()
        composeRule.runOnIdle {
            assertTrue(codeEmail == "native@example.test")
            assertTrue(emailBinding == "native@example.test" to "123456")
        }
        composeRule.onNodeWithText("邮箱已绑定").assertIsDisplayed()
    }

    @Test
    fun welcomePresentsLoginScanAndSkipAsRealActions() {
        var skipped = false
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                WelcomeScreen(
                    connecting = false,
                    error = null,
                    onLogin = {},
                    onScanPairing = {},
                    onSkip = { skipped = true },
                    onClearError = {},
                )
            }
        }

        composeRule.onNodeWithText(Str.getStarted).assertIsDisplayed()
        composeRule.onNodeWithText(Str.scanPairing).assertIsDisplayed()
        composeRule.onNodeWithText(Str.skipForNow).performScrollTo().performClick()

        assertTrue(skipped)
    }

    @Test
    fun loggedOutProfileUsesReadableStateAndOffersLogin() {
        var loginRequested = false
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                MeScreen(
                    themeMode = ThemeMode.Light,
                    user = null,
                    subscription = null,
                    onlineDeviceCount = 0,
                    onOpenPlan = {},
                    onOpenSettings = {},
                    onOpenDevices = {},
                    onOpenAbout = {},
                    onOpenAccount = { loginRequested = true },
                )
            }
        }

        composeRule.onNodeWithText(Str.notLoggedIn).assertIsDisplayed()
        composeRule.onNodeWithText(Str.notLoggedIn).performClick()

        assertTrue(loginRequested)
    }

    @Test
    fun profileNavigationRowsOpenTheirDestinations() {
        val opened = mutableListOf<String>()
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                MeScreen(
                    themeMode = ThemeMode.Light,
                    user = null,
                    subscription = null,
                    onlineDeviceCount = 0,
                    onOpenPlan = { opened += "plan" },
                    onOpenSettings = { opened += "settings" },
                    onOpenDataSettings = { opened += "data" },
                    onOpenDevices = { opened += "devices" },
                    onOpenAbout = { opened += "about" },
                    onOpenAccount = {},
                )
            }
        }

        composeRule.onNodeWithText(Str.connectedDevices).performScrollTo().performClick()
        composeRule.onNodeWithText(Str.behavior).performScrollTo().performClick()
        composeRule.onNodeWithText(Str.dataSection).performScrollTo().performClick()
        composeRule.onNodeWithText(Str.aboutUs).performScrollTo().performClick()

        assertTrue(opened == listOf("devices", "settings", "data", "about"))
    }

    @Test
    fun aboutScreenShowsProductIdentity() {
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                AboutScreen(onBack = {})
            }
        }

        composeRule.onNodeWithText(Str.aboutAgent567).assertIsDisplayed()
        composeRule.onNodeWithContentDescription(Str.appName).assertIsDisplayed()
        composeRule.onNodeWithText(Str.versionNumber).assertIsDisplayed()
        composeRule.onNodeWithText(Str.aboutDescription).assertIsDisplayed()
    }

    @Test
    fun aboutDocumentsOpenReadableDialogs() {
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                AboutScreen(onBack = {})
            }
        }

        composeRule.onNodeWithText(Str.openSourceLicenses).performClick()
        composeRule.onNodeWithText(Str.openSourceLicensesBody).assertIsDisplayed()
        composeRule.onNodeWithText(Str.close).performClick()

        composeRule.onNodeWithText(Str.privacyPolicy).performClick()
        composeRule.onNodeWithText(Str.privacyPolicyBody).assertIsDisplayed()
    }

    @Test
    fun aboutBackButtonCallsNavigationCallback() {
        var navigatedBack = false
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                AboutScreen(onBack = { navigatedBack = true })
            }
        }

        composeRule.onNodeWithContentDescription(Str.back).performClick()
        assertTrue(navigatedBack)
    }

    @Test
    fun loginFormSubmitsEnteredCredentials() {
        var credentials: Pair<String, String>? = null
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                LoginScreen(
                    loading = false,
                    error = null,
                    loginModeEmail = false,
                    passwordVisible = false,
                    onToggleMode = {},
                    onTogglePassword = {},
                    onLogin = { account, password -> credentials = account to password },
                    onClearError = {},
                    onBack = {},
                )
            }
        }

        composeRule.onNodeWithText(Str.account).performTextInput("user@example.test")
        composeRule.onNodeWithText(Str.password).performTextInput("password")
        composeRule.onNodeWithText(Str.loginAction).performScrollTo().performClick()

        assertTrue(credentials == "user@example.test" to "password")
    }

    @Test
    fun loginModeAndPasswordVisibilityUseCallbacks() {
        val modeChanges = mutableListOf<Boolean>()
        val visibilityChanges = mutableListOf<Boolean>()
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                LoginScreen(
                    loading = false,
                    error = null,
                    loginModeEmail = false,
                    passwordVisible = false,
                    onToggleMode = { modeChanges += it },
                    onTogglePassword = { visibilityChanges += it },
                    onLogin = { _, _ -> },
                    onClearError = {},
                    onBack = {},
                )
            }
        }

        composeRule.onNodeWithContentDescription(Str.showPassword).performClick()
        composeRule.onNodeWithText(Str.useEmailLogin).performClick()

        assertTrue(visibilityChanges == listOf(true))
        assertTrue(modeChanges == listOf(true))
    }

    @Test
    fun loggedOutPlanOffersLoginAction() {
        var loginRequested = false
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                PlanScreen(
                    subscription = null,
                    loggedIn = false,
                    onBack = {},
                    onRefresh = {},
                    onLogin = { loginRequested = true },
                )
            }
        }

        composeRule.onNodeWithText(Str.loginToViewPlan).assertIsDisplayed()
        composeRule.onNodeWithText(Str.getStarted).performClick()
        assertTrue(loginRequested)
    }

    @Test
    fun loggedInPlanRefreshUsesRetryAction() {
        var refreshed = false
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                PlanScreen(
                    subscription = null,
                    loggedIn = true,
                    onBack = {},
                    onRefresh = { refreshed = true },
                    onLogin = {},
                )
            }
        }

        composeRule.onNodeWithContentDescription(Str.actionRetry).performClick()
        assertTrue(refreshed)
    }

    @Test
    fun logoutDialogCanClearLocalSessions() {
        var clearLocal: Boolean? = null
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                AccountScreen(
                    user = User(id = 1, username = "tester", nickname = "Tester"),
                    onBack = {}, onLogin = {}, onRefresh = {}, onSaveName = { _, done -> done(null) }, onLogout = { clearLocal = it },
                )
            }
        }

        composeRule.onNodeWithText(Str.logout).performScrollTo().performClick()
        composeRule.onNodeWithText(Str.logoutConfirm).assertIsDisplayed()
        composeRule.onNodeWithText(Str.logoutAndClear).performClick()
        assertTrue(clearLocal == true)
    }

    @Test
    fun logoutDialogCanPreserveLocalSessions() {
        var clearLocal: Boolean? = null
        composeRule.setContent {
            Agent567Theme(ThemeMode.Light) {
                AccountScreen(
                    user = User(id = 1, username = "tester", nickname = "Tester"),
                    onBack = {}, onLogin = {}, onRefresh = {}, onSaveName = { _, done -> done(null) }, onLogout = { clearLocal = it },
                )
            }
        }

        composeRule.onNodeWithText(Str.logout).performScrollTo().performClick()
        composeRule.onNodeWithText(Str.logoutConfirm).assertIsDisplayed()
        composeRule.onNodeWithText(Str.confirmLogout).performClick()

        assertTrue(clearLocal == false)
    }
}
