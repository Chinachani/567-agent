package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.core.model.User
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.ui.home.HomeScreen
import org.agent567.android.ui.me.MeScreen
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.*

@RunWith(AndroidJUnit4::class)
class MobileEntryPointsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun homeKeepsPhoneAndComputerDestinationsDistinct() {
        val events = mutableListOf<String>()
        rule.setContent { Agent567Theme(ThemeMode.Light) {
            HomeScreen(DesktopDevice("pc", "Test computer", "Linux", "127.0.0.1", status = DeviceStatus.Online), emptyList(),
                onOpenDevice = { events += it }, onOpenDevices = { events += "devices" },
                onOpenSessions = { events += "sessions" }, onOpenDesktopSessions = { events += "computer" },
                onOpenSession = {}, onNewConversation = { events += "new" }, onUseCloudAi = { events += "phone" })
        } }
        rule.onNodeWithText("Test computer").performClick()
        rule.onNodeWithText(Str.openDesktopSessions).performClick()
        rule.onNodeWithText(Str.phoneDirectTitle).performScrollTo().performClick()
        rule.onNodeWithText(Str.newConversation).performScrollTo().performClick()
        rule.runOnIdle { assertEquals(listOf("pc", "computer", "phone", "new"), events) }
    }

    @Test fun profileKeepsQuotaAndModelServiceSeparateAndShowsAnUpdateBadge() {
        var route = false
        var about = false
        rule.setContent { Agent567Theme(ThemeMode.Dark) {
            MeScreen(User(id = 1, username = "test", nickname = "Test", quota = 500000), null, ThemeMode.Dark,
                onlineDeviceCount = 0, serverUrl = "https://api.567.wiki", hasUpdate = true,
                onOpenServiceRoute = { route = true }, onOpenAbout = { about = true })
        } }
        rule.onNodeWithText(Str.accountBalanceSection).assertIsDisplayed()
        rule.onNodeWithText(Str.phoneModelServiceSection).performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(Str.serviceRouteTitle).performScrollTo().performClick()
        rule.onNodeWithText(Str.updateNewVersion).performScrollTo().performClick()
        rule.runOnIdle { assertTrue(route); assertTrue(about) }
    }
    @Test fun updateOnATestInstallOpensReleaseNotesInsteadOfAnIncompatibleProductionApk() {
        var opened = ""
        rule.setContent {
            androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalUriHandler provides object : androidx.compose.ui.platform.UriHandler {
                override fun openUri(uri: String) { opened = uri }
            }) {
                Agent567Theme(ThemeMode.Light) {
                    org.agent567.android.ui.me.AboutScreen(onBack = {}, knownUpdate = org.agent567.android.core.api.AppUpdateCheckResult(true, "v9.0", "v1.3.3", "", "https://github.com/Chinachani/567-agent/releases/download/v9/production.apk"))
                }
            }
        }
        rule.onNodeWithText(Str.updateOpenRelease).performClick()
        rule.runOnIdle { assertEquals("https://github.com/Chinachani/567-agent/releases/latest", opened) }
    }

}
