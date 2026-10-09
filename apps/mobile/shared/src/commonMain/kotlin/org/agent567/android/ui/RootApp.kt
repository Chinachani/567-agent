package org.agent567.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.compose.viewModel
import org.agent567.android.app.AppContainer
import org.agent567.android.ui.auth.LoginScreen
import org.agent567.android.ui.auth.WelcomeScreen
import org.agent567.android.ui.chat.ChatScreen
import org.agent567.android.ui.components.LoadingBlock
import org.agent567.android.ui.components.Agent567BottomBar
import org.agent567.android.ui.connect.DeviceDetailScreen
import org.agent567.android.ui.connect.DiscoverConnectScreen
import org.agent567.android.ui.connect.NewConversationScreen
import org.agent567.android.ui.home.HomeScreen
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.me.MeScreen
import org.agent567.android.ui.me.PlanScreen
import org.agent567.android.ui.me.SettingsScreen
import org.agent567.android.ui.me.SettingsSection
import org.agent567.android.ui.me.AboutScreen
import org.agent567.android.ui.navigation.AppRoute
import org.agent567.android.ui.navigation.ChatSurface
import org.agent567.android.ui.theme.agent567Extra
import org.agent567.android.ui.navigation.MainTab
import org.agent567.android.ui.navigation.PlatformBackHandler
import org.agent567.android.ui.navigation.hasInAppBackDestination
import org.agent567.android.ui.sessions.SessionsScreen
import org.agent567.android.ui.toolbox.ToolboxScreen
import org.agent567.android.ui.theme.Agent567Theme
import kotlin.reflect.KClass

val LocalAppContainer =
    staticCompositionLocalOf<AppContainer> {
        error("AppContainer not provided")
    }

private class AppViewModelFactory(
    private val container: AppContainer,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(
        modelClass: KClass<T>,
        extras: CreationExtras,
    ): T = AppViewModel(container) as T
}

@Composable
fun RootApp(
    container: AppContainer = LocalAppContainer.current,
    pairingInvite: String? = null,
    onPairingInviteHandled: () -> Unit = {},
) {
    val vm: AppViewModel =
        viewModel(factory = remember(container) { AppViewModelFactory(container) })
    val state by vm.state.collectAsState()
    val sessions by vm.sessions.collectAsState()
    val sessionItems by vm.sessionListItems.collectAsState()

    PlatformBackHandler(
        enabled = state.route.hasInAppBackDestination(),
        onBack = vm::handleSystemBack,
    )

    LaunchedEffect(pairingInvite, state.bootstrapped) {
        if (pairingInvite != null && state.bootstrapped) {
            vm.handlePairingInvite(pairingInvite)
            onPairingInviteHandled()
        }
    }

    LaunchedEffect(state.route) {
        (state.route as? AppRoute.DeviceCapabilities)?.let { vm.refreshToolbox(it.deviceId) }
    }

    CompositionLocalProvider(LocalMotionEnabled provides state.motionEnabled) {
    Agent567Theme(themeMode = state.themeMode) {
        if (!state.bootstrapped || state.route is AppRoute.Boot) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                LoadingBlock()
            }
            return@Agent567Theme
        }

        Box(Modifier.fillMaxSize().background(MaterialTheme.agent567Extra.pageBackground)) {
            when (val route = state.route) {
            AppRoute.Boot -> Unit
            AppRoute.Welcome ->
                WelcomeScreen(
                    connecting = state.remoteConnecting,
                    error = state.remoteError,
                    onLogin = vm::openLogin,
                    onScanPairing = vm::connectDesktop,
                    onSkip = vm::skipWelcome,
                    onClearError = vm::clearRemoteError,
                )
            AppRoute.Login ->
                LoginScreen(
                    loading = state.authLoading,
                    error = state.authError,
                    loginModeEmail = state.loginModeEmail,
                    passwordVisible = state.passwordVisible,
                    onToggleMode = vm::setLoginModeEmail,
                    onTogglePassword = vm::setPasswordVisible,
                    onLogin = vm::login,
                    onClearError = vm::clearAuthError,
                    onBack = vm::openWelcome,
                    onSendVerification = vm::sendVerificationCode,
                    onRegister = { u, p, e, c, a -> vm.register(u, p, e, c, a) { _, _ -> } },
                )
            is AppRoute.Main -> {
                Scaffold(
                    contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
                    bottomBar = {
                        Agent567BottomBar(
                            selected = state.mainTab,
                            onSelect = vm::selectMainTab,
                            showLabels = state.showBottomNavLabels,
                        )
                    },
                ) { padding ->
                    Box(Modifier.padding(padding).fillMaxSize()) {
                            when (state.mainTab) {
                            MainTab.Home ->
                                HomeScreen(
                                    primaryDevice =
                                        state.devices.firstOrNull {
                                            it.status == org.agent567.android.domain.device.DeviceStatus.Online
                                        },
                                    recentSessions = sessionItems.filter { it.isCloud }.take(5),
                                    onOpenDevice = vm::openDeviceDetail,
                                    onOpenDevices = { vm.selectMainTab(MainTab.Discover) },
                                    onOpenSessions = vm::openPhoneSessions,
                                    onOpenDesktopSessions = vm::openDesktopSessions,
                                    onOpenSession = { id ->
                                        val item = vm.sessionListItems().firstOrNull { it.id == id }
                                        vm.openChat(
                                            sessionId = id,
                                            surface = if (item?.isCloud == false) ChatSurface.Desktop else ChatSurface.Cloud,
                                            title = item?.title.orEmpty(),
                                        )
                                    },
                                    onNewConversation = { vm.openNewConversation(0) },
                                    onUseCloudAi = vm::openCloudConversation,
                                )
                            MainTab.Sessions ->
                                SessionsScreen(
                                    sessions = sessionItems,
                                    query = state.sessionQuery,
                                    filterIndex = state.sessionFilterIndex,
                                    desktopSessionsLoading = state.desktopSessionsLoading,
                                    desktopSessionsError = state.desktopSessionsError,
                                    desktopSessionsWarning = state.desktopSessionsWarning,
                                    onRefreshDesktopSessions = vm::refreshDesktopSessions,
                                    onRefreshSessions = vm::refreshSessions,
                                    onQueryChange = vm::setSessionQuery,
                                    onFilterChange = vm::setSessionFilter,
                                    onNewConversation = { vm.openNewConversation(0) },
                                    onRenameSession = vm::renameSession,
                                    onDeleteSession = vm::deleteSession,
                                    confirmBeforeDelete = state.confirmBeforeDelete,
                                    onOpenSession = { item ->
                                        if (item.remoteSessionId != null) {
                                            vm.openDesktopSession(item.remoteSessionId, item.title)
                                        } else {
                                            vm.openChat(
                                                sessionId = item.id,
                                                surface = if (item.isCloud) ChatSurface.Cloud else ChatSurface.Desktop,
                                                title = item.title,
                                            )
                                        }
                                    },
                                )
                            MainTab.Discover ->
                                DiscoverConnectScreen(
                                    devices = state.devices,
                                    channelIndex = state.discoverChannelIndex,
                                    onChannelChange = vm::setDiscoverChannel,
                                    onOpenDevice = vm::openDeviceDetail,
                                    onConnectManual = vm::connectDesktop,
                                    onUseCloud = vm::openCloudConversation,
                                    remoteConnecting = state.remoteConnecting,
                                    error = state.remoteError,
                                    onClearError = vm::clearRemoteError,
                                )
                            MainTab.Me ->
                                MeScreen(
                                    user = state.user,
                                    themeMode = state.themeMode,
                                    subscription = state.subscription,
                                    activeGroup = state.active567Group,
                                    availableGroups = state.available567Groups,
                                    onlineDeviceCount =
                                        state.devices.count {
                                            it.status == org.agent567.android.domain.device.DeviceStatus.Online
                                        },
                                    onSelectGroup = vm::setActive567Group,
                                    onRefreshQuota = vm::refreshQuota,
                                    catalogLoading = state.catalogLoading,
                                    quotaRefreshing = state.quotaRefreshing,
                                    onOpenPlan = vm::openPlan,
                                    onOpenSettings = vm::openSettings,
                                    onOpenDataSettings = vm::openDataSettings,
                                    onThemeMode = vm::setThemeMode,
                                    onOpenDevices = { vm.selectMainTab(MainTab.Discover) },
                                    onOpenAbout = vm::openAbout,
                                    onLogin = vm::openLogin,
                                    onLogout = vm::logout,
                                    onTopupWithKey = vm::topupWithKey,
                                    onCreatePayOrder = vm::createPayOrder,
                                )
                            }
                    }
                }
            }
            is AppRoute.DeviceDetail -> {
                val device = state.devices.firstOrNull { it.id == route.deviceId }
                if (device == null) {
                    vm.navigateBackFromSecondary()
                } else {
                    DeviceDetailScreen(
                        device = device,
                        autoRequestDesktopScreen = state.autoRequestDesktopScreen,
                        onBack = vm::navigateBackFromSecondary,
                        onDisconnect = { vm.disconnectDesktop(device.id) },
                        onNewChat = { vm.startDesktopConversation(device.id) },
                        onOpenCapabilities = { vm.openDeviceCapabilities(device.id) },
                    )
                }
            }
            is AppRoute.DeviceCapabilities -> {
                val device = state.devices.firstOrNull { it.id == route.deviceId }
                ToolboxScreen(
                    title = "电脑端能力管理",
                    abilities = state.toolboxAbilities,
                    query = state.toolboxQuery,
                    loading = state.toolboxLoading,
                    error = state.toolboxError,
                    onBack = { vm.openDeviceDetail(route.deviceId) },
                    onQueryChange = vm::setToolboxQuery,
                    onRefresh = { vm.refreshToolbox(route.deviceId) },
                    onInstall = vm::installToolboxAbility,
                    onConnectDesktop = { vm.selectMainTab(MainTab.Discover) },
                    deviceName = device?.name,
                )
            }
            is AppRoute.NewConversation ->
                NewConversationScreen(
                    devices = state.devices,
                    channelIndex = state.newConversationChannelIndex,
                    onChannelChange = vm::setNewConversationChannel,
                    onBack = vm::navigateBackFromSecondary,
                    onStartDesktop = { deviceId ->
                        vm.startDesktopConversation(deviceId)
                    },
                    onStartCloud = {
                        vm.openCloudConversation()
                    },
                    onConnectDesktop = { vm.selectMainTab(MainTab.Discover) },
                )
            is AppRoute.Chat -> {
                val chatModels = if (route.surface == ChatSurface.Desktop) state.desktopModels else state.models
                val selected = if (route.surface == ChatSurface.Desktop) {
                    chatModels.firstOrNull { it.id == state.desktopSelectedModelId } ?: chatModels.firstOrNull()
                } else {
                    chatModels.firstOrNull { it.id == state.selectedModelId } ?: chatModels.firstOrNull()
                }
                val title =
                    route.title.ifBlank {
                        sessions.firstOrNull { it.id == state.currentSessionId }?.title
                            ?: if (route.surface == ChatSurface.Cloud) Str.channelCloud else Str.pairDesktop
                    }
                ChatScreen(
                    title = title,
                    surface = route.surface,
                    messages = state.messages,
                    draft = state.draft,
                    pendingImages = state.pendingImages,
                    pendingFiles = state.pendingFiles,
                    isStreaming = state.isStreaming,
                    streamingStatus = state.streamingStatus,
                    inputPredictions = state.inputPredictions,
                    inputPredictionLoading = state.inputPredictionLoading,
                    onSelectInputPrediction = vm::selectInputPrediction,
                    desktopHistoryLoading = state.desktopHistoryLoading,
                    models = chatModels,
                    selectedModel = selected,
                    modelPickerOpen = state.modelPickerOpen,
                    activeGroup = state.active567Group,
                    availableGroups = state.available567Groups,
                    groupPickerOpen = state.groupPickerOpen,
                    onOpenGroupPicker = { vm.setGroupPickerOpen(true) },
                    onCloseGroupPicker = { vm.setGroupPickerOpen(false) },
                    onSelectGroup = vm::setActive567Group,
                    onRefreshCatalog = if (route.surface == ChatSurface.Desktop) {
                        { vm.refreshDesktopSessionModels() }
                    } else {
                        vm::refreshCatalog
                    },
                    catalogLoading = state.catalogLoading,
                    activeImageGroup = state.activeImageGroup,
                    activeImageModel = state.activeImageModel,
                    imageGenEnabled = state.imageGenEnabled,
                    imagePickerOpen = state.imagePickerOpen,
                    availableImageModels = state.availableImageModels,
                    imageModelsLoading = state.imageModelsLoading,
                    imageGroupExpanded = state.imageGroupExpanded,
                    onOpenImagePicker = { vm.setImagePickerOpen(true) },
                    onCloseImagePicker = { vm.setImagePickerOpen(false) },
                    onToggleGroupExpanded = vm::setImageGroupExpanded,
                    onToggleImageGen = vm::setImageGenEnabled,
                    onSelectImageGroup = vm::setActiveImageGroup,
                    onSelectImageModel = vm::setActiveImageModel,
                    chatError = state.chatError,
                    onDraftChange = vm::onDraftChange,
                    onSend = vm::sendMessage,
                    onStop = vm::stopStreaming,
                    onRetryAssistant = { vm.retryLastError(it) },
                    onBack = vm::navigateBackFromSecondary,
                    onOpenModelPicker = { vm.setModelPicker(true) },
                    onCloseModelPicker = { vm.setModelPicker(false) },
                    onSelectModel = vm::selectModel,
                    onErrorAction = vm::handleErrorAction,
                    onDismissError = vm::clearChatError,
                    onImagesPicked = vm::addPendingImages,
                    onRemovePendingImage = vm::removePendingImage,
                    onAddPendingFile = vm::addPendingDocument,
                    onRemovePendingFile = vm::removePendingDocument,
                    pendingQuestion = state.pendingQuestion?.takeIf { it.sessionId == state.currentSessionId },
                    questionSubmitting = state.isQuestionSubmitting,
                    onToggleQuestionOption = vm::toggleQuestionOption,
                    onSubmitQuestion = vm::submitQuestion,
                )
            }
            AppRoute.Plan ->
                PlanScreen(
                    subscription = state.subscription,
                    subscriptionLoadFailed = state.subscriptionLoadFailed,
                    loggedIn = state.user != null,
                    onBack = vm::navigateBackFromSecondary,
                    onRefresh = vm::refreshCatalog,
                    onLogin = vm::openLogin,
                )
            AppRoute.Settings ->
                SettingsScreen(
                    section = SettingsSection.Behavior,
                    autoResumeLastSession = state.autoResumeLastSession,
                    motionEnabled = state.motionEnabled,
                    inputPredictionEnabled = state.inputPredictionEnabled,
                    migrationBackupLimitMb = state.migrationBackupLimitMb,
                    onMigrationBackupLimitMb = vm::setMigrationBackupLimitMb,
                    onAutoResumeLastSession = vm::setAutoResumeLastSession,
                    onMotionEnabled = vm::setMotionEnabled,
                    onInputPredictionEnabled = vm::setInputPredictionEnabled,
                    onClearLocalData = vm::clearLocalSessions,
                    onExportMigration = vm::exportSessionMigration,
                    onSendMigration = vm::sendSessionMigrationToDesktop,
                    onImportMigration = vm::importSessionMigration,
                    onBack = vm::navigateBackFromSecondary,
                    confirmBeforeDelete = state.confirmBeforeDelete,
                    onConfirmBeforeDelete = vm::setConfirmBeforeDelete,
                    autoRequestDesktopScreen = state.autoRequestDesktopScreen,
                    onAutoRequestDesktopScreen = vm::setAutoRequestDesktopScreen,
                    showBottomNavLabels = state.showBottomNavLabels,
                    onShowBottomNavLabels = vm::setShowBottomNavLabels,
                )
            AppRoute.SettingsData ->
                SettingsScreen(
                    section = SettingsSection.Data,
                    autoResumeLastSession = state.autoResumeLastSession,
                    motionEnabled = state.motionEnabled,
                    inputPredictionEnabled = state.inputPredictionEnabled,
                    migrationBackupLimitMb = state.migrationBackupLimitMb,
                    onMigrationBackupLimitMb = vm::setMigrationBackupLimitMb,
                    onAutoResumeLastSession = vm::setAutoResumeLastSession,
                    onMotionEnabled = vm::setMotionEnabled,
                    onInputPredictionEnabled = vm::setInputPredictionEnabled,
                    onClearLocalData = vm::clearLocalSessions,
                    onExportMigration = vm::exportSessionMigration,
                    onSendMigration = vm::sendSessionMigrationToDesktop,
                    onImportMigration = vm::importSessionMigration,
                    onBack = vm::navigateBackFromSecondary,
                    confirmBeforeDelete = state.confirmBeforeDelete,
                    onConfirmBeforeDelete = vm::setConfirmBeforeDelete,
                    autoRequestDesktopScreen = state.autoRequestDesktopScreen,
                    onAutoRequestDesktopScreen = vm::setAutoRequestDesktopScreen,
                    showBottomNavLabels = state.showBottomNavLabels,
                    onShowBottomNavLabels = vm::setShowBottomNavLabels,
                )
            AppRoute.About ->
                AboutScreen(onBack = vm::navigateBackFromSecondary, onCheckUpdate = vm::checkAppUpdate)
            }
            val pending = state.pendingQuestion
            val currentChatHasPending = state.route is AppRoute.Chat && pending?.sessionId == state.currentSessionId
            AnimatedVisibility(
                visible = pending != null && !currentChatHasPending,
                modifier = Modifier.align(Alignment.TopCenter),
                enter = fadeIn(tween(optionalMotionDuration(state.motionEnabled, 200))) + slideInVertically(tween(optionalMotionDuration(state.motionEnabled, 200))) { -it },
                exit = fadeOut(tween(optionalMotionDuration(state.motionEnabled, 180))) + slideOutVertically(tween(optionalMotionDuration(state.motionEnabled, 180))) { -it },
            ) {
                PendingQuestionNotice(
                    onOpen = {
                        pending?.let { question ->
                            val session = sessions.firstOrNull { it.id == question.sessionId }
                            vm.openChat(
                                sessionId = question.sessionId,
                                surface = ChatSurface.Desktop,
                                title = session?.title.orEmpty(),
                            )
                        }
                    },
                )
            }
        }
    }
    }
}

@Composable
private fun PendingQuestionNotice(
    modifier: Modifier = Modifier,
    onOpen: () -> Unit,
) {
    Surface(
        modifier = modifier.padding(top = 12.dp, start = 16.dp, end = 16.dp),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        tonalElevation = 3.dp,
    ) {
        TextButton(onClick = onOpen) {
            Text(Str.pendingDesktopQuestion)
        }
    }
}
