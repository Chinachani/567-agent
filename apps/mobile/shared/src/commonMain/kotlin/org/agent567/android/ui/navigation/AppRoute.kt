package org.agent567.android.ui.navigation

import org.agent567.android.domain.device.ConnectChannel

enum class MainTab {
    Home,
    Sessions,
    Discover,
    Me,
}

enum class ChatSurface {
    /** 对接 Desktop 会话 */
    Desktop,
    /** 云端 AI */
    Cloud,
}

sealed class AppRoute {
    data object Boot : AppRoute()

    data object Welcome : AppRoute()

    data object Login : AppRoute()

    /** 带底部导航的主壳 */
    data class Main(val tab: MainTab = MainTab.Home) : AppRoute()

    /** 聚合桌面任务、待确认事项和连接状态的跟进页。 */
    data object TaskCenter : AppRoute()

    data class DeviceDetail(val deviceId: String, val fromChat: Chat? = null) : AppRoute()

    data class DeviceCapabilities(val deviceId: String, val fromChat: Chat? = null) : AppRoute()

    data class NewConversation(
        val channel: ConnectChannel = ConnectChannel.Lan,
    ) : AppRoute()

    data class Chat(
        val sessionId: String?,
        val surface: ChatSurface = ChatSurface.Cloud,
        val title: String = "",
        val deviceId: String? = null,
    ) : AppRoute()

    data object Plan : AppRoute()

    data object Settings : AppRoute()

    data object SettingsData : AppRoute()

    data object Account : AppRoute()

    data object About : AppRoute()
}
