package org.agent567.android.ui.preview

import android.content.res.Configuration
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import org.agent567.android.app.ThemeMode
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.User
import org.agent567.android.core.model.LlmModel
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.device.SessionListItem
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.ui.auth.WelcomeScreen
import org.agent567.android.ui.chat.ChatScreen
import org.agent567.android.ui.components.Agent567BottomBar
import org.agent567.android.ui.connect.DeviceDetailScreen
import org.agent567.android.ui.connect.DiscoverConnectScreen
import org.agent567.android.ui.home.HomeScreen
import org.agent567.android.ui.me.MeScreen
import org.agent567.android.ui.navigation.ChatSurface
import org.agent567.android.ui.navigation.MainTab
import org.agent567.android.ui.sessions.SessionsScreen
import org.agent567.android.ui.theme.Agent567Theme

// Production Compose screens with inert callbacks; previews never create a client or ViewModel.
@Preview(name = "Small · light", widthDp = 320, heightDp = 740, showBackground = true)
@Preview(name = "Phone · dark", widthDp = 390, heightDp = 844, uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Preview(name = "Large text", widthDp = 320, heightDp = 740, fontScale = 1.5f, showBackground = true)
@Preview(name = "Landscape", widthDp = 740, heightDp = 360, showBackground = true)
private annotation class WorkspacePreviews

private val previewModel = LlmModel("preview-model", "preview-model", "Gemini 3 Flash", "preview")

private val previewDevice = DesktopDevice("preview", "工作电脑", "Linux", "wss://relay.example.test/v1/relay/abcdefghijklmnopqrstuvwxyz012345/mobile#resume=fixture", status = DeviceStatus.Online, latencyMs = 40, connectedDuration = "5秒", cpu = "12th Gen Intel Core i5-12400", ram = "61.4 GB")
private val previewSessions = (1..3).map {
    SessionListItem("preview-$it", listOf("整理今天的项目进展", "设计一个更清晰的工作流程", "分析文档并列出下一步")[it - 1], "", if (it == 1) "电脑会话" else "手机会话", "刚刚", it != 1)
}

@Composable
private fun PreviewMain(tab: MainTab, theme: ThemeMode, content: @Composable () -> Unit) {
    Agent567Theme(theme) {
        Scaffold(contentWindowInsets = WindowInsets(0, 0, 0, 0), bottomBar = { Agent567BottomBar(tab, {}) }) { padding ->
            Box(Modifier.padding(padding).consumeWindowInsets(padding).fillMaxSize()) { content() }
        }
    }
}

@WorkspacePreviews @Composable internal fun HomePreview(theme: ThemeMode = ThemeMode.System) = PreviewMain(MainTab.Home, theme) {
    HomeScreen(previewDevice, previewSessions.map { it.copy(isCloud = true, sourceLabel = "手机会话") }, {}, {}, {}, {}, {}, {}, {})
}

@WorkspacePreviews @Composable internal fun SessionsPreview(theme: ThemeMode = ThemeMode.System) = PreviewMain(MainTab.Sessions, theme) {
    SessionsScreen(previewSessions, "", 0, {}, {}, {}, {}, { _, _ -> }, {})
}

@WorkspacePreviews @Composable internal fun ProfilePreview(theme: ThemeMode = ThemeMode.System) = PreviewMain(MainTab.Me, theme) {
    MeScreen(User(id = 1, username = "preview", nickname = "一个比较长的名字也能完整管理账号", quota = 34105000), null, ThemeMode.System, onlineDeviceCount = 1)
}

@WorkspacePreviews @Composable internal fun ConnectionsPreview(theme: ThemeMode = ThemeMode.System) = PreviewMain(MainTab.Discover, theme) {
    DiscoverConnectScreen(listOf(previewDevice), 0, {}, {}, {}, {})
}

@WorkspacePreviews @Composable internal fun ChatPreview(theme: ThemeMode = ThemeMode.System) {
    Agent567Theme(theme) {
        ChatScreen(
            title = "整理今天的工作", surface = ChatSurface.Desktop,
            messages = listOf(
                LocalMessage("user", "preview", ChatRole.User, "帮我整理这份计划，并给出具体的下一步。", MessageStatus.Complete, 1),
                LocalMessage("assistant", "preview", ChatRole.Assistant, "## 可以从这三步开始\n\n1. 明确目标与范围。\n2. 列出优先完成的事项。\n3. 完成后检查结果。", MessageStatus.Complete, 2),
            ), draft = "补充一下时间安排", pendingImages = emptyList(), isStreaming = false,
            models = listOf(previewModel), selectedModel = previewModel, modelPickerOpen = false, chatError = null,
            onDraftChange = {}, onSend = {}, onStop = {}, onBack = {}, onOpenModelPicker = {}, onCloseModelPicker = {},
            onSelectModel = {}, onErrorAction = {}, onDismissError = {}, onImagesPicked = {}, onRemovePendingImage = {},
        )
    }
}

@WorkspacePreviews @Composable internal fun WelcomePreview(theme: ThemeMode = ThemeMode.System) {
    Agent567Theme(theme) { WelcomeScreen(false, null, {}, {}, {}, {}) }
}

@WorkspacePreviews @Composable internal fun DevicePreview(theme: ThemeMode = ThemeMode.System) {
    Agent567Theme(theme) { DeviceDetailScreen(previewDevice, false, {}, {}, {}, {}) }
}
