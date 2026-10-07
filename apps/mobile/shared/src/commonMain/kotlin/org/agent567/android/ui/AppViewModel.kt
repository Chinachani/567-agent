package org.agent567.android.ui

import org.agent567.android.AppVersion

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import org.agent567.android.app.AppContainer
import org.agent567.android.app.ThemeMode
import org.agent567.android.data.session.SessionMigrationBackup
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.model.LlmModel
import org.agent567.android.core.model.SubscriptionStatus
import org.agent567.android.core.model.TokenUsage
import org.agent567.android.core.model.User
import org.agent567.android.core.net.RefreshOutcome
import org.agent567.android.domain.chat.prepareRetryTurn
import org.agent567.android.domain.chat.shouldClearPendingImagesOnSessionChange
import org.agent567.android.domain.conversation.RemoteSessionModelCatalog
import org.agent567.android.domain.conversation.RemoteDesktopSessionSummary
import org.agent567.android.domain.conversation.RemoteConversationException
import org.agent567.android.domain.error.ErrorMapper
import org.agent567.android.domain.error.UiError
import org.agent567.android.domain.error.UiErrorAction
import org.agent567.android.domain.remote.createSecureRemoteResumeSecret
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.SessionListItem
import org.agent567.android.domain.session.ConversationOrigin
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageImage
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.domain.session.PendingQuestion
import org.agent567.android.domain.session.ToolTrace
import org.agent567.android.domain.session.SessionStore
import org.agent567.android.domain.session.nowEpochMs
import org.agent567.android.data.session.MigrationBackupTooLargeException
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.navigation.AppRoute
import org.agent567.android.ui.navigation.ChatSurface
import org.agent567.android.ui.navigation.MainTab
import kotlin.random.Random

data class AppUiState(
    val bootstrapped: Boolean = false,
    val mainAccessGranted: Boolean = false,
    val route: AppRoute = AppRoute.Boot,
    val mainTab: MainTab = MainTab.Home,
    val themeMode: ThemeMode = ThemeMode.System,
    val autoResumeLastSession: Boolean = true,
    val motionEnabled: Boolean = true,
    val inputPredictionEnabled: Boolean = true,
    val confirmBeforeDelete: Boolean = true,
    val migrationBackupLimitMb: Int = 50,
    val serverUrl: String = "",
    val user: User? = null,
    val subscription: SubscriptionStatus? = null,
    val subscriptionLoadFailed: Boolean = false,
    val models: List<LlmModel> = emptyList(),
    val selectedModelId: String? = null,
    val desktopModels: List<LlmModel> = emptyList(),
    val desktopSelectedModelId: String? = null,
    val currentSessionId: String? = null,
    val messages: List<LocalMessage> = emptyList(),
    val draft: String = "",
    val pendingImages: List<MessageImage> = emptyList(),
    val isStreaming: Boolean = false,
    /** 面向用户的短状态，不透传 Desktop 内部思考文本或异常原文。 */
    val streamingStatus: String? = null,
    val inputPredictions: List<String> = emptyList(),
    val inputPredictionLoading: Boolean = false,
    val modelPickerOpen: Boolean = false,
    val available567Groups: Map<String, org.agent567.android.core.api.ApiGroupInfoDto> = emptyMap(),
    val active567Group: String? = null,
    val groupPickerOpen: Boolean = false,
    val activeImageGroup: String? = null,
    val activeImageModel: String? = null,
    val imageGenEnabled: Boolean = false,
    val imagePickerOpen: Boolean = false,
    val availableImageModels: List<String> = emptyList(),
    val imageModelsLoading: Boolean = false,
    val imageGroupExpanded: Boolean = false,
    val remoteConnecting: Boolean = false,
    val desktopSessionsLoading: Boolean = false,
    val desktopSessionsError: String? = null,
    /** 配对与设备管理错误，只在连接相关页面展示。 */
    val remoteError: UiError? = null,
    /** 当前聊天的错误提示；切换会话时清空，后台任务不得写入。 */
    val chatError: UiError? = null,
    val authError: UiError? = null,
    val authLoading: Boolean = false,
    val loginModeEmail: Boolean = false,
    val catalogLoading: Boolean = false,
    val quotaRefreshing: Boolean = false,
    val passwordVisible: Boolean = false,
    val sessionQuery: String = "",
    val topupDialogOpen: Boolean = false,
    val topupLoading: Boolean = false,
    val topupMessage: String? = null,
    val sessionFilterIndex: Int = 0,
    val discoverChannelIndex: Int = 0,
    val newConversationChannelIndex: Int = 0,
    val devices: List<DesktopDevice> = emptyList(),
    val remoteDesktopSessions: List<RemoteDesktopSessionSummary> = emptyList(),
    val desktopHistoryLoading: Boolean = false,
    val pendingQuestion: PendingQuestion? = null,
    val isQuestionSubmitting: Boolean = false,
)

private data class PreferenceSnapshot(
    val theme: ThemeMode,
    val server: String,
    val autoResume: Boolean,
    val motion: Boolean,
    val confirmDelete: Boolean,
)

private const val STREAMING_PERSIST_INTERVAL_MS = 1_000L
private const val NEW_SESSION_SEND_RESERVATION = "__new-session-send__"
private const val REMOTE_GENERATED_IMAGE_CHUNK_BYTES = 48 * 1024
private const val REMOTE_GENERATED_IMAGE_MAX_BYTES = 12 * 1024 * 1024
private const val MAX_ASSISTANT_MESSAGE_CHARS = 1_000_000
private const val MAX_TOOL_TRACE_FIELD_CHARS = 8 * 1024
private const val MAX_TOOL_TRACE_EVENTS = 80
private const val MAX_REQUEST_IMAGE_CONTEXT_BYTES = 12 * 1024 * 1024

private fun formatBackupSizeMb(bytes: Long): String =
    ((bytes + 1024L * 1024L - 1) / (1024L * 1024L)).toString()

private fun safeRemoteConnectionError(error: Throwable): String =
    (error.message ?: "Connection failed")
        .replace(Regex("(?i)(pairing|resume|bootstrap|fingerprint)=([^&\\s]+)"), "\$1=[redacted]")
        .replace(Regex("(?i)wss?://[^\\s]+"), "<remote-url>")
        .take(240)

class AppViewModel(
    private val container: AppContainer,
) : ViewModel() {
    private val _state =
        MutableStateFlow(
            AppUiState(
                themeMode = container.preferences.themeMode.value,
                serverUrl = container.preferences.serverUrl.value,
                autoResumeLastSession = container.preferences.autoResumeLastSession.value,
                motionEnabled = container.preferences.motionEnabled.value,
                inputPredictionEnabled = container.preferences.inputPredictionEnabled.value,
                confirmBeforeDelete = container.preferences.confirmBeforeDelete.value,
                migrationBackupLimitMb = container.preferences.migrationBackupLimitMb.value,
            ),
        )
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    private val streamJobs = mutableMapOf<String, Job>()
    private val pendingSendReservations = mutableSetOf<String>()
    private val retryPreparingSessions = mutableSetOf<String>()
    private val remoteImageFetches = mutableSetOf<String>()
    private val streamStatuses = mutableMapOf<String, String>()
    private var messagesCollectJob: Job? = null
    private var desktopSessionsJob: Job? = null
    private var desktopHistoryJob: Job? = null
    private val inputPredictionJobs = mutableMapOf<String, Job>()
    private val inputPredictionsBySession = mutableMapOf<String, List<String>>()
    private val inputPredictionLoadingSessions = mutableSetOf<String>()
    private val desktopSessionModelJobs = mutableMapOf<String, Deferred<Pair<String, RemoteSessionModelCatalog>?>>()
    private val drafts = mutableMapOf<String, String>()
    private var pendingLoginAction: PendingLoginAction? = null

    init {
        viewModelScope.launch {
            combine(
                container.preferences.themeMode,
                container.preferences.serverUrl,
                container.preferences.autoResumeLastSession,
                container.preferences.motionEnabled,
                container.preferences.confirmBeforeDelete,
            ) { theme, server, autoResume, motion, confirmDelete ->
                PreferenceSnapshot(theme, server, autoResume, motion, confirmDelete)
            }
                .collect { preferences ->
                    _state.update {
                        it.copy(
                            themeMode = preferences.theme,
                            serverUrl = preferences.server,
                            autoResumeLastSession = preferences.autoResume,
                            motionEnabled = preferences.motion,
                            confirmBeforeDelete = preferences.confirmDelete,
                        )
                    }
                }
        }
        viewModelScope.launch {
            container.preferences.migrationBackupLimitMb.collect { limitMb ->
                _state.update { it.copy(migrationBackupLimitMb = limitMb) }
            }
        }
        viewModelScope.launch {
            container.preferences.inputPredictionEnabled.collect { enabled ->
                _state.update { it.copy(inputPredictionEnabled = enabled) }
            }
        }
        viewModelScope.launch {
            container.unauthorizedEpoch.collect { epoch ->
                if (epoch > 0) {
                    forceLogout(keepLocalSessions = true, message = "登录已失效，请重新登录")
                }
            }
        }
        viewModelScope.launch {
            var hadOnlineDevice = container.remoteConversationGateway.devices.value.any {
                it.status == org.agent567.android.domain.device.DeviceStatus.Online
            }
            container.remoteConversationGateway.devices.collect { devices ->
                _state.update { it.copy(devices = devices) }
                val hasOnlineDevice = devices.any { it.status == org.agent567.android.domain.device.DeviceStatus.Online }
                if (hasOnlineDevice) {
                    _state.update { it.copy(desktopSessionsError = null) }
                }
                if (!hadOnlineDevice && hasOnlineDevice && _state.value.sessionFilterIndex == 1) {
                    loadDesktopSessions()
                }
                hadOnlineDevice = hasOnlineDevice
            }
        }
        bootstrap()
    }

    private fun bootstrap() {
        viewModelScope.launch {
            val savedGroup = container.preferences.active567Group
            val savedImageGroup = container.preferences.activeImageGroup
            val savedImageModel = container.preferences.activeImageModel
            val savedImageEnabled = container.preferences.imageGenEnabled

            val cachedUsername = container.preferences.authUsername
            val cachedUser = if (!cachedUsername.isNullOrBlank()) {
                User(
                    id = container.preferences.authUserId,
                    username = cachedUsername,
                    nickname = cachedUsername,
                    phone = null,
                    email = null,
                    avatar = "",
                    isActive = true,
                    createdAt = null,
                    quota = (container.preferences.authQuotaUsd * 500000.0 + 0.5).toLong(),
                    quotaUsd = container.preferences.authQuotaUsd,
                )
            } else {
                null
            }

            val cachedModelIds = container.preferences.getCachedGroupModels(savedGroup)
            val initialCachedModels = cachedModelIds.map { id ->
                val isReasoning = id.contains("reasoner", ignoreCase = true) ||
                        id.contains("r1", ignoreCase = true) ||
                        id.contains("o1", ignoreCase = true) ||
                        id.contains("o3", ignoreCase = true) ||
                        id.contains("thinking", ignoreCase = true) ||
                        id.contains("sol", ignoreCase = true)
                LlmModel(
                    id = id,
                    modelId = id,
                    name = id,
                    providerName = savedGroup ?: "567 API",
                    reasoning = isReasoning,
                )
            }
            val initialSelected = resolveModelId(container.preferences.lastModelId, initialCachedModels)
                ?: initialCachedModels.firstOrNull()?.id

            _state.update {
                it.copy(
                    active567Group = savedGroup,
                    activeImageGroup = savedImageGroup,
                    activeImageModel = savedImageModel,
                    imageGenEnabled = savedImageEnabled,
                    user = cachedUser,
                    models = initialCachedModels,
                    selectedModelId = initialSelected,
                )
            }
            val token = container.tokenStore.accessToken ?: container.preferences.authToken
            val refreshToken = container.tokenStore.refreshToken ?: container.preferences.authRefreshToken ?: token
            if (token.isNullOrBlank()) {
                _state.update {
                    it.copy(
                        bootstrapped = true,
                        mainAccessGranted = false,
                        route = AppRoute.Welcome,
                    )
                }
                restorePendingQuestion()
                restorePairedDesktopConnection()
                return@launch
            }
            if (container.tokenStore.accessToken.isNullOrBlank() || container.tokenStore.refreshToken.isNullOrBlank()) {
                container.client.auth.installSession(token, refreshToken ?: token)
            }
            if (container.preferences.authToken.isNullOrBlank()) {
                container.preferences.authToken = token
            }
            if (container.preferences.authRefreshToken.isNullOrBlank() && !refreshToken.isNullOrBlank()) {
                container.preferences.authRefreshToken = refreshToken
            }
            // Reuse the persisted session. Authenticated API calls refresh tokens through
            // TokenRefresher, which only falls back to account login after refresh rejection.
            loadWorkspace(openLastSession = container.preferences.autoResumeLastSession.value)
            restorePairedDesktopConnection()
        }
    }

    private suspend fun loadWorkspace(openLastSession: Boolean) {
        val lastSessionId = container.preferences.lastSessionId
        val lastSession = if (openLastSession && lastSessionId != null) {
            container.sessionStore.getSession(lastSessionId)
        } else {
            null
        }
        val routeSession = lastSession?.id

        _state.update {
            it.copy(
                bootstrapped = true,
                mainAccessGranted = true,
                route = AppRoute.Main(it.mainTab),
                currentSessionId = routeSession,
                catalogLoading = true,
            )
        }
        restorePendingQuestion()

        try {
            val user = runCatching { container.client.auth.me() }.getOrNull()
            if (user != null) {
                container.preferences.authUsername = user.nickname.ifBlank { user.username }
                container.preferences.authQuotaUsd = user.quotaUsd
                container.preferences.authUserId = user.id
            }
            val sub = runCatching { container.client.subscription.me() }.getOrNull()
            val groups = runCatching { container.client.models.getAvailableGroups() }.getOrDefault(emptyMap())
            val currentGroup = _state.value.active567Group ?: pickDefaultGroup(groups)
            if (_state.value.active567Group == null && currentGroup != null) {
                container.preferences.active567Group = currentGroup
            }
            val currentImageGroup = _state.value.activeImageGroup ?: pickDefaultImageGroup(groups)
            if (_state.value.activeImageGroup == null && currentImageGroup != null) {
                container.preferences.activeImageGroup = currentImageGroup
            }
            val models =
                if (!currentGroup.isNullOrBlank()) {
                    runCatching { container.client.models.listGoModels(currentGroup) }.getOrElse { emptyList() }
                } else {
                    runCatching { container.client.models.listGoModels(null) }.getOrElse { emptyList() }
                }
            val cachedFallbackIds = container.preferences.getCachedGroupModels(currentGroup)
            val fallbackModels = cachedFallbackIds.map { id ->
                val isReasoning = id.contains("reasoner", ignoreCase = true) ||
                        id.contains("r1", ignoreCase = true) ||
                        id.contains("o1", ignoreCase = true) ||
                        id.contains("o3", ignoreCase = true) ||
                        id.contains("thinking", ignoreCase = true) ||
                        id.contains("sol", ignoreCase = true)
                LlmModel(
                    id = id,
                    modelId = id,
                    name = id,
                    providerName = currentGroup ?: "567 API",
                    reasoning = isReasoning,
                )
            }
            val finalModels = if (models.isNotEmpty()) {
                models
            } else if (_state.value.models.isNotEmpty()) {
                _state.value.models
            } else {
                fallbackModels
            }
            val selected =
                resolveModelId(
                    preferred = container.preferences.lastModelId,
                    models = finalModels,
                ) ?: finalModels.firstOrNull()?.id
            _state.update {
                it.copy(
                    user = user ?: it.user,
                    // A failed subscription lookup must not leave an old
                    // balance/tier looking current. `sub` is null on lookup
                    // failure and the UI can then rely on the error state.
                    subscription = sub,
                    subscriptionLoadFailed = sub == null,
                    available567Groups = if (groups.isNotEmpty()) groups else it.available567Groups,
                    active567Group = currentGroup,
                    activeImageGroup = currentImageGroup ?: it.activeImageGroup,
                    models = finalModels,
                    selectedModelId = selected,
                    catalogLoading = false,
                )
            }
            if (!currentImageGroup.isNullOrBlank() && _state.value.availableImageModels.isEmpty()) {
                loadGroupImageModels(currentImageGroup)
            }
        } catch (t: Throwable) {
            _state.update {
                it.copy(
                    catalogLoading = false,
                )
            }
        }
    }

    fun openWelcome() = navigate(AppRoute.Welcome)

    fun openLogin() = navigate(AppRoute.Login)

    fun skipWelcome() {
        _state.update {
            it.copy(
                bootstrapped = true,
                mainAccessGranted = true,
                route = AppRoute.Main(MainTab.Home),
                mainTab = MainTab.Home,
                authError = null,
            )
        }
        restorePendingQuestion()
        restorePairedDesktopConnection()
    }

    /** 从本地消息恢复尚未回答的问题，让重启后仍能从主壳进入正确会话。 */
    private fun restorePendingQuestion() {
        viewModelScope.launch {
            var pending: PendingQuestion? = null
            for (session in container.sessionStore.sessions.value) {
                if (session.origin != ConversationOrigin.Desktop) continue
                pending = container.sessionStore.getMessages(session.id).asReversed().firstNotNullOfOrNull { it.pendingQuestion }
                if (pending != null) break
            }
            if (pending != null) _state.update { it.copy(pendingQuestion = pending) }
        }
    }

    fun openPlan() = navigate(AppRoute.Plan)

    fun openSettings() = navigate(AppRoute.Settings)

    fun openDataSettings() = navigate(AppRoute.SettingsData)


    fun checkAppUpdate(onResult: (org.agent567.android.core.api.AppUpdateCheckResult) -> Unit) {
        viewModelScope.launch {
            try {
                val res = container.client.models.checkAppUpdate()
                onResult(res)
            } catch (t: Throwable) {
                if (t is CancellationException) throw t
                onResult(
                    org.agent567.android.core.api.AppUpdateCheckResult(
                        hasUpdate = false,
                        latestVersion = "v${AppVersion.NAME}",
                        currentVersion = "v${AppVersion.NAME}",
                        releaseNotes = "",
                        apkUrl = null,
                        error = t.message,
                    )
                )
            }
        }
    }

    fun openAbout() = navigate(AppRoute.About)

    /** 登录后继续用户刚刚发起的高意图操作，避免登录成功后把用户丢回首页。 */
    fun openCloudConversation() {
        if (container.tokenStore.accessToken.isNullOrBlank()) {
            pendingLoginAction = PendingLoginAction.CloudConversation
            openLogin()
        } else {
            newChat()
        }
    }

    fun selectMainTab(tab: MainTab) {
        _state.update {
            it.copy(
                mainTab = tab,
                route = AppRoute.Main(tab),
                authError = null,
            )
        }
    }

    fun openDeviceDetail(deviceId: String) = navigate(AppRoute.DeviceDetail(deviceId))

    fun openNewConversation(channelIndex: Int = 0) {
        _state.update { it.copy(newConversationChannelIndex = channelIndex) }
        navigate(AppRoute.NewConversation())
    }

    fun setNewConversationChannel(index: Int) {
        _state.update { it.copy(newConversationChannelIndex = index) }
    }

    fun setDiscoverChannel(index: Int) {
        _state.update { it.copy(discoverChannelIndex = index) }
    }

    fun handlePairingInvite(target: String) {
        if (org.agent567.android.domain.remote.parsePairingInvite(target) == null) {
            _state.update {
                it.copy(
                    route = AppRoute.Welcome,
                    remoteError =
                        UiError(
                            title = Str.invalidPairingInvite,
                            message = Str.invalidPairingInviteHint,
                            action = UiErrorAction.None,
                        ),
                )
            }
            return
        }
        connectDesktop(target)
    }

    fun connectDesktop(target: String) {
        if (_state.value.remoteConnecting) return
        val routeBeforeConnect = _state.value.route
        _state.update { it.copy(remoteConnecting = true, remoteError = null) }
        viewModelScope.launch {
            try {
                val invite = org.agent567.android.domain.remote.parsePairingInvite(target)
                val savedResume =
                    invite?.let {
                        container.preferences.remoteResumeSecret?.takeIf { secret ->
                            container.preferences.remotePairingId == it.pairingId && secret.isNotBlank()
                        }
                    }
                val resume = invite?.let { savedResume ?: newRemoteResumeSecret() }
                val candidateTargets =
                    if (invite == null) {
                        listOf(target)
                    } else {
                        buildList {
                            if (!invite.lanBaseUrl.isNullOrBlank()) {
                                val lanInvite = invite.copy(relayBaseUrl = invite.lanBaseUrl)
                                if (savedResume != null) {
                                    add(org.agent567.android.domain.remote.buildMobileResumeTarget(lanInvite, savedResume))
                                }
                                add(org.agent567.android.domain.remote.buildMobileBootstrapTarget(lanInvite, requireNotNull(resume)))
                            }
                            if (invite.relayBaseUrl.isNotBlank() && invite.relayBaseUrl != invite.lanBaseUrl) {
                                val cloudInvite = invite.copy(lanCertificateFingerprint = null)
                                if (savedResume != null) {
                                    add(org.agent567.android.domain.remote.buildMobileResumeTarget(cloudInvite, savedResume))
                                }
                                add(org.agent567.android.domain.remote.buildMobileBootstrapTarget(cloudInvite, requireNotNull(resume)))
                            }
                        }
                    }
                val connected =
                    try {
                        container.remoteConversationGateway.connect(candidateTargets)
                    } catch (error: Throwable) {
                        if (error is CancellationException) throw error
                        org.agent567.android.domain.remote.connection.PlatformRemoteLogger.warn(
                            "remote pairing connection failed",
                            mapOf(
                                "errorType" to error::class.simpleName,
                                "error" to safeRemoteConnectionError(error),
                            ),
                        )
                        false
                    }
                if (connected) {
                    _state.update { it.copy(mainAccessGranted = true) }
                    if (invite != null && resume != null) {
                        container.preferences.remotePairingId = invite.pairingId
                        container.preferences.remoteResumeSecret = resume
                        container.preferences.remoteRelayBaseUrl = invite.relayBaseUrl
                        container.preferences.remoteLanBaseUrl = invite.lanBaseUrl
                        container.preferences.remoteLanCertificateFingerprint = invite.lanCertificateFingerprint
                    }
                    val device = container.remoteConversationGateway.devices.value.firstOrNull()
                    when {
                        routeBeforeConnect is AppRoute.Chat -> Unit
                        (routeBeforeConnect is AppRoute.Welcome ||
                            routeBeforeConnect is AppRoute.Main && routeBeforeConnect.tab == MainTab.Discover) && device != null ->
                            openDeviceDetail(device.id)
                        routeBeforeConnect is AppRoute.Welcome -> navigate(AppRoute.Main(MainTab.Discover))
                    }
                    return@launch
                }
                _state.update {
                    it.copy(
                        remoteError =
                            UiError(
                                title = Str.remoteConnectFailed,
                                message = Str.remoteConnectFailedHint,
                                action = UiErrorAction.None,
                            ),
                    )
                }
            } finally {
                _state.update { it.copy(remoteConnecting = false) }
            }
        }
    }

    private fun newRemoteResumeSecret(): String = createSecureRemoteResumeSecret()

    fun disconnectDesktop(deviceId: String) {
        viewModelScope.launch {
            runCatching { container.remoteConversationGateway.disconnect(deviceId) }
            container.preferences.remotePairingId = null
            container.preferences.remoteResumeSecret = null
            container.preferences.remoteRelayBaseUrl = null
            container.preferences.remoteLanBaseUrl = null
            container.preferences.remoteLanCertificateFingerprint = null
            navigateBackFromSecondary()
        }
    }

    private fun restorePairedDesktopConnection() {
        if (_state.value.remoteConnecting || container.remoteConversationGateway.devices.value.any {
                it.status == org.agent567.android.domain.device.DeviceStatus.Online
            }
        ) return
        val pairingId = container.preferences.remotePairingId ?: return
        val resumeSecret = container.preferences.remoteResumeSecret ?: return
        val relayUrl = container.preferences.remoteRelayBaseUrl ?: return
        val lanUrl = container.preferences.remoteLanBaseUrl
        val fingerprint = container.preferences.remoteLanCertificateFingerprint
        val invite = org.agent567.android.domain.remote.PairingInvite(
            relayBaseUrl = relayUrl,
            pairingId = pairingId,
            bootstrapSecret = "",
            lanBaseUrl = lanUrl,
            lanCertificateFingerprint = fingerprint,
        )
        val targets = buildList {
            if (!lanUrl.isNullOrBlank() && !fingerprint.isNullOrBlank()) {
                add(
                    org.agent567.android.domain.remote.buildMobileResumeTarget(
                        invite.copy(relayBaseUrl = lanUrl),
                        resumeSecret,
                    ),
                )
            }
            add(
                org.agent567.android.domain.remote.buildMobileResumeTarget(
                    invite.copy(lanBaseUrl = null, lanCertificateFingerprint = null),
                    resumeSecret,
                ),
            )
        }
        _state.update { it.copy(remoteConnecting = true) }
        viewModelScope.launch {
            try {
                var connected = false
                for (attempt in 0..2) {
                    if (attempt > 0) delay(attempt * 2_000L)
                    connected = try {
                        container.remoteConversationGateway.connect(targets)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Throwable) {
                        false
                    }
                    if (connected) break
                }
                if (connected) {
                    _state.update { state ->
                        val route = when (state.route) {
                            AppRoute.Boot, AppRoute.Welcome -> AppRoute.Main(MainTab.Home)
                            else -> state.route
                        }
                        state.copy(
                            mainAccessGranted = true,
                            route = route,
                            mainTab = (route as? AppRoute.Main)?.tab ?: state.mainTab,
                        )
                    }
                }
            } finally {
                _state.update { it.copy(remoteConnecting = false) }
            }
        }
    }

    fun setSessionQuery(query: String) {
        _state.update { it.copy(sessionQuery = query) }
    }

    fun setSessionFilter(index: Int) {
        _state.update { it.copy(sessionFilterIndex = index) }
        if (index == 1) loadDesktopSessions()
    }

    fun openDesktopSessions() {
        _state.update { it.copy(mainTab = MainTab.Sessions, sessionFilterIndex = 1) }
        navigate(AppRoute.Main(MainTab.Sessions))
        loadDesktopSessions()
    }

    fun refreshDesktopSessions() {
        loadDesktopSessions()
    }

    fun refreshSessions() {
        viewModelScope.launch {
            container.sessionStore.refresh()
            if (_state.value.sessionFilterIndex != 2) loadDesktopSessions()
        }
    }

    fun openPhoneSessions() {
        _state.update { it.copy(mainTab = MainTab.Sessions, sessionFilterIndex = 2) }
        navigate(AppRoute.Main(MainTab.Sessions))
    }

    private fun loadDesktopSessions() {
        if (desktopSessionsJob?.isActive == true) return
        desktopSessionsJob = viewModelScope.launch {
            val devices = container.remoteConversationGateway.devices.value
            val device = devices.firstOrNull {
                it.status == org.agent567.android.domain.device.DeviceStatus.Online
            }
            if (device == null) {
                _state.update {
                    it.copy(
                        // Pair restoration can complete after this screen first renders. Do not
                        // report "connect first" during that window or leave a stale red error.
                        desktopSessionsLoading = devices.any { item -> item.status == org.agent567.android.domain.device.DeviceStatus.Connecting } ||
                            (devices.isEmpty() && container.preferences.remotePairingId != null),
                        desktopSessionsError = if (devices.isEmpty() && container.preferences.remotePairingId == null) {
                            Str.desktopSessionConnectFirst
                        } else null,
                    )
                }
                return@launch
            }
            _state.update { it.copy(desktopSessionsLoading = true, desktopSessionsError = null) }
            try {
                val summaries = container.remoteConversationGateway.listDesktopSessions(device.id)
                    ?: throw RemoteConversationException("电脑暂时无法读取会话列表，请确认设备在线")
                val summaryIds = summaries.mapTo(mutableSetOf()) { it.id }
                val emptyRemoteDrafts = container.sessionStore.sessions.value.filter { session ->
                    session.origin == ConversationOrigin.Desktop &&
                        session.remoteSessionCreatedOnMobile &&
                        session.remoteDeviceId == device.id &&
                        session.remoteSessionId != null &&
                        session.remoteSessionId in summaryIds &&
                        drafts[session.id].isNullOrBlank() &&
                        streamJobs[session.id]?.isActive != true &&
                        (_state.value.currentSessionId != session.id || _state.value.pendingImages.isEmpty()) &&
                        (_state.value.route as? AppRoute.Chat)?.sessionId != session.id
                }
                val removedDrafts = emptyRemoteDrafts.chunked(4).flatMap { batch ->
                    coroutineScope {
                        batch.map { draft ->
                            async {
                                val remoteId = draft.remoteSessionId ?: return@async null
                                if (container.sessionStore.getMessages(draft.id).isNotEmpty()) return@async null
                                if (!isEmptyRemoteDraftStillDisposable(draft.id)) return@async null
                                val deleted = try {
                                    container.remoteConversationGateway.deleteEmptyDesktopSession(device.id, remoteId)
                                } catch (error: CancellationException) {
                                    throw error
                                } catch (_: Throwable) {
                                    false
                                }
                                if (deleted == true) draft to remoteId else null
                            }
                        }.awaitAll().filterNotNull()
                    }
                }
                val removedRemoteDraftIds = removedDrafts.mapTo(mutableSetOf()) { it.second }
                removedDrafts.forEach { (draft, _) ->
                    if (isEmptyRemoteDraftStillDisposable(draft.id) && container.sessionStore.getMessages(draft.id).isEmpty()) {
                        cancelInputPredictionsForSession(draft.id)
                        container.sessionStore.deleteSession(draft.id)
                        drafts.remove(draft.id)
                        if (container.preferences.lastSessionId == draft.id) {
                            container.preferences.lastSessionId = null
                        }
                    } else {
                        // The remote draft was removed while the user reopened it.
                        // Keep the local mirror and let the next send create a fresh remote session.
                        container.sessionStore.getSession(draft.id)?.let { latest ->
                            container.sessionStore.updateSession(latest.copy(remoteSessionId = null))
                        }
                    }
                }
                val visibleSummaries = summaries.filterNot { it.id in removedRemoteDraftIds }
                // Keep cached mirrors when the Desktop no longer lists a session.
                // The list can be stale during reconnects or partial history reads;
                // silently deleting the local copy would make that loss permanent.
                visibleSummaries.forEach { summary ->
                    val mirror = container.sessionStore.sessions.value.firstOrNull {
                        it.origin == ConversationOrigin.Desktop &&
                            it.remoteDeviceId == device.id &&
                            it.remoteSessionId == summary.id
                    }
                    if (mirror != null && !mirror.titleManuallyEdited && mirror.title != summary.title) {
                        container.sessionStore.updateSession(mirror.copy(title = summary.title))
                    }
                }
                _state.update {
                    it.copy(remoteDesktopSessions = visibleSummaries, desktopSessionsLoading = false, desktopSessionsError = null)
                }
            } catch (error: Throwable) {
                val stillOnline = container.remoteConversationGateway.devices.value.any {
                    it.id == device.id && it.status == org.agent567.android.domain.device.DeviceStatus.Online
                }
                _state.update {
                    it.copy(
                        desktopSessionsLoading = false,
                        desktopSessionsError = if (stillOnline) error.message ?: Str.desktopSessionLoadError else null,
                    )
                }
            }
        }
    }

    fun openDesktopSession(remoteSessionId: String, title: String) {
        viewModelScope.launch {
            val device = container.remoteConversationGateway.devices.value.firstOrNull {
                it.status == org.agent567.android.domain.device.DeviceStatus.Online
            } ?: run {
                _state.update { it.copy(remoteError = ErrorMapper.from(RemoteConversationException("请先连接电脑"))) }
                return@launch
            }
            val existing = container.sessionStore.sessions.value.firstOrNull {
                it.origin == ConversationOrigin.Desktop &&
                    it.remoteDeviceId == device.id &&
                    it.remoteSessionId == remoteSessionId
            }
            val session = existing ?: container.sessionStore.createSession(
                title = title,
                origin = ConversationOrigin.Desktop,
                remoteDeviceId = device.id,
                remoteSessionId = remoteSessionId,
            )
            openChat(session.id, ChatSurface.Desktop, session.title, device.id)
        }
    }

    fun openChat(
        sessionId: String?,
        surface: ChatSurface = ChatSurface.Cloud,
        title: String = "",
        deviceId: String? = null,
    ) {
        val previousSessionId = _state.value.currentSessionId
        if (surface != ChatSurface.Desktop || sessionId == null) {
            desktopHistoryJob?.cancel()
            _state.update { it.copy(desktopHistoryLoading = false) }
        }
        val clearPending =
            shouldClearPendingImagesOnSessionChange(previousSessionId, sessionId)
        navigate(
            AppRoute.Chat(
                sessionId = sessionId,
                surface = surface,
                title = title,
                deviceId = deviceId,
            ),
        )
        if (sessionId != null) {
            attachSession(sessionId, clearPendingImages = clearPending)
            if (surface == ChatSurface.Desktop) {
                val session = container.sessionStore.sessions.value.firstOrNull { it.id == sessionId }
                if (session?.remoteSessionId != null) loadDesktopSessionDetail(sessionId, session.remoteSessionId)
                else refreshDesktopSessionModels(sessionId)
            }
        } else {
            detachSessionMessages()
            _state.update {
                it.copy(
                    currentSessionId = null,
                    messages = emptyList(),
                    chatError = null,
                    draft = "",
                    isStreaming = false,
                    streamingStatus = null,
                    inputPredictions = emptyList(),
                    inputPredictionLoading = false,
                    pendingQuestion = null,
                    pendingImages = if (clearPending) emptyList() else it.pendingImages,
                )
            }
        }
    }

    private fun loadDesktopSessionDetail(localSessionId: String, remoteSessionId: String) {
        desktopHistoryJob?.cancel()
        desktopHistoryJob = viewModelScope.launch {
            _state.update { it.copy(desktopHistoryLoading = true) }
            try {
                val history = container.remoteConversationGateway.readDesktopSessionHistory(localSessionId, remoteSessionId)
                    ?: throw RemoteConversationException("电脑暂时无法读取这段会话，请确认设备在线")
                val cachedMessageList = container.sessionStore.getMessages(localSessionId)
                val cachedMessages = cachedMessageList.associateBy { it.id }
                val matchedCachedMessageIds = mutableSetOf<String>()
                val remoteMessages = history.map { item ->
                    val messageId = "desktop-${remoteSessionId}-${item.id}"
                    val cached = cachedMessages[messageId]
                        ?: cachedMessageList.asSequence()
                            .filter { it.id !in matchedCachedMessageIds && it.role == item.role }
                            .filter {
                                it.content == item.text ||
                                    (it.role == ChatRole.User && it.images.isNotEmpty() && item.text.contains("[图片附件]"))
                            }
                            .sortedWith(
                                compareBy<LocalMessage> { kotlin.math.abs(it.createdAtEpochMs - item.timestamp) },
                            )
                            .firstOrNull()
                    cached?.let { matchedCachedMessageIds += it.id }
                    LocalMessage(
                        id = messageId,
                        sessionId = localSessionId,
                        role = item.role,
                        content = item.text,
                        status = item.status,
                        createdAtEpochMs = item.timestamp,
                        // Tool traces and usage arrive live and are cached locally; the
                        // compact remote history endpoint only returns text and timestamps.
                        images = cached?.images.orEmpty(),
                        toolEvents = cached?.toolEvents.orEmpty(),
                        usage = cached?.usage,
                        contextPercent = cached?.contextPercent,
                    )
                }
                val remoteMessageIds = remoteMessages.mapTo(mutableSetOf()) { it.id }
                // User messages stay Complete locally even when the paired Desktop
                // request fails. Detect the failed turn from its following assistant
                // message, and avoid duplicating a prompt that Desktop did receive.
                val unsyncedFailedTurnMessages = cachedMessageList.mapIndexedNotNull { index, userMessage ->
                    val assistantMessage = cachedMessageList.getOrNull(index + 1)
                    if (
                        userMessage.role != ChatRole.User ||
                        assistantMessage?.role != ChatRole.Assistant ||
                        assistantMessage.status !in setOf(MessageStatus.Error, MessageStatus.Aborted) ||
                        userMessage.id in remoteMessageIds
                    ) {
                        return@mapIndexedNotNull null
                    }
                    val echoedByDesktop = remoteMessages.any { remote ->
                        remote.role == ChatRole.User &&
                            kotlin.math.abs(remote.createdAtEpochMs - userMessage.createdAtEpochMs) <= 60_000L &&
                            (
                                userMessage.content.isNotBlank() && remote.content == userMessage.content ||
                                    userMessage.images.isNotEmpty() && remote.content.contains("[图片附件]")
                                )
                    }
                    if (echoedByDesktop) null else listOf(userMessage, assistantMessage)
                }
                val inFlightMessages = cachedMessageList.filter { message ->
                    message.status == MessageStatus.Streaming || message.status == MessageStatus.Pending
                }.flatMap { activeMessage ->
                    val index = cachedMessageList.indexOfFirst { it.id == activeMessage.id }
                    listOfNotNull(cachedMessageList.getOrNull(index - 1), activeMessage)
                }.distinctBy { it.id }.filter { local ->
                    remoteMessages.none { remote ->
                        remote.role == local.role &&
                            remote.content == local.content &&
                            kotlin.math.abs(remote.createdAtEpochMs - local.createdAtEpochMs) <= 60_000L
                    }
                }
                val messages = (remoteMessages + unsyncedFailedTurnMessages.flatten() + inFlightMessages)
                    .distinctBy { it.id }
                    .sortedBy { it.createdAtEpochMs }
                container.sessionStore.replaceMessages(localSessionId, messages)
                refreshDesktopSessionModels(localSessionId)
            } catch (error: Throwable) {
                if (error !is CancellationException) {
                    setSessionError(localSessionId, error, desktopOnly = true)
                }
            } finally {
                _state.update { it.copy(desktopHistoryLoading = false) }
            }
        }
    }

    fun openCloudChat(sessionId: String? = null) {
        openChat(sessionId = sessionId, surface = ChatSurface.Cloud, title = Str.channelCloud)
    }

    fun navigateBackFromSecondary() {
        val exitingSessionId = (_state.value.route as? AppRoute.Chat)?.sessionId
        // QR pairing is an independent entry path; a connected Desktop is enough to use the main shell.
        if (_state.value.mainAccessGranted || _state.value.user != null || _state.value.devices.isNotEmpty()) {
            navigate(AppRoute.Main(_state.value.mainTab))
        } else {
            navigate(AppRoute.Welcome)
        }
        if (exitingSessionId != null) deleteEmptyDraftSessionOnExit(exitingSessionId)
    }

    private fun deleteEmptyDraftSessionOnExit(sessionId: String) {
        if (streamJobs[sessionId]?.isActive == true ||
            (_state.value.currentSessionId == sessionId &&
                (_state.value.draft.isNotBlank() || _state.value.pendingImages.isNotEmpty()))
        ) return
        viewModelScope.launch {
            val session = container.sessionStore.getSession(sessionId) ?: return@launch
            // A remote Desktop session is owned by the computer. Only remove an
            // empty draft created from mobile, and delete its remote counterpart
            // before removing the local mirror. Existing Desktop sessions are
            // never inferred to be disposable from an empty local mirror.
            if (!isEmptyRemoteDraftStillDisposable(sessionId)) return@launch
            if (container.sessionStore.getMessages(sessionId).isNotEmpty()) return@launch
            if (session.origin == ConversationOrigin.Desktop && session.remoteSessionId != null) {
                if (!session.remoteSessionCreatedOnMobile) return@launch
                val deviceId = session.remoteDeviceId ?: return@launch
                val deviceOnline = container.remoteConversationGateway.devices.value.any {
                    it.id == deviceId && it.status == org.agent567.android.domain.device.DeviceStatus.Online
                }
                if (deviceOnline) {
                    val deleted = runCatching {
                        container.remoteConversationGateway.deleteEmptyDesktopSession(deviceId, session.remoteSessionId)
                    }.getOrNull()
                    if (deleted != true) return@launch
                    // The user may have reopened this chat while the remote delete
                    // was in flight. Preserve its local state and detach the deleted
                    // remote identity instead of erasing the user's new draft.
                    if (!isEmptyRemoteDraftStillDisposable(sessionId)) {
                        container.sessionStore.getSession(sessionId)?.let { latest ->
                            container.sessionStore.updateSession(latest.copy(remoteSessionId = null))
                        }
                        return@launch
                    }
                } else {
                    // Keep the empty mirror as a deletion tombstone. The next time
                    // the Desktop session list loads, it retries deleting the remote draft.
                    return@launch
                }
            } else if (session.remoteSessionId != null) {
                return@launch
            }
            if (!isEmptyRemoteDraftStillDisposable(sessionId)) return@launch
            container.sessionStore.deleteSession(sessionId)
            drafts.remove(sessionId)
            cancelInputPredictionsForSession(sessionId)
            if (container.preferences.lastSessionId == sessionId) container.preferences.lastSessionId = null
        }
    }

    private fun isEmptyRemoteDraftStillDisposable(sessionId: String): Boolean {
        val current = _state.value
        return streamJobs[sessionId]?.isActive != true &&
            drafts[sessionId].isNullOrBlank() &&
            (current.currentSessionId != sessionId || current.pendingImages.isEmpty()) &&
            (current.route as? AppRoute.Chat)?.sessionId != sessionId
    }

    private fun cancelInputPredictionsForSession(sessionId: String) {
        inputPredictionJobs.remove(sessionId)?.cancel()
        inputPredictionsBySession.remove(sessionId)
        inputPredictionLoadingSessions.remove(sessionId)
    }

    fun handleSystemBack() {
        if (_state.value.imagePickerOpen) {
            setImagePickerOpen(false)
            return
        }
        if (_state.value.groupPickerOpen) {
            setGroupPickerOpen(false)
            return
        }
        if (_state.value.modelPickerOpen) {
            setModelPicker(false)
            return
        }
        when (_state.value.route) {
            AppRoute.Login -> openWelcome()
            AppRoute.Boot,
            AppRoute.Welcome,
            is AppRoute.Main,
            -> Unit
            else -> navigateBackFromSecondary()
        }
    }

    private fun navigate(route: AppRoute) {
        _state.update {
            it.copy(
                route = route,
                authError = null,
                groupPickerOpen = false,
                imagePickerOpen = false,
            )
        }
    }

    fun setModelPicker(open: Boolean) {
        _state.update { it.copy(modelPickerOpen = open) }
        if (open && (_state.value.route as? AppRoute.Chat)?.surface == ChatSurface.Desktop) {
            refreshDesktopSessionModels()
        }
    }

    fun refreshDesktopSessionModels(sessionId: String? = _state.value.currentSessionId) {
        val localSessionId = sessionId ?: return
        viewModelScope.launch {
            _state.update { it.copy(catalogLoading = true) }
            try {
                ensureDesktopSessionModels(localSessionId)
                _state.update { it.copy(catalogLoading = false) }
            } catch (error: Throwable) {
                _state.update { it.copy(catalogLoading = false) }
                setSessionError(localSessionId, error, desktopOnly = true)
            }
        }
    }

    private suspend fun ensureDesktopSessionModels(localSessionId: String): Pair<String, RemoteSessionModelCatalog>? {
        val job = desktopSessionModelJobs[localSessionId] ?: viewModelScope.async {
            val session = container.sessionStore.getSession(localSessionId)
                ?: throw RemoteConversationException("找不到当前桌面会话")
            if (session.origin != ConversationOrigin.Desktop) return@async null
            val result = if (session.remoteSessionId != null) {
                val catalog = container.remoteConversationGateway.readDesktopSessionModels(
                    localSessionId,
                    session.remoteSessionId,
                ) ?: throw RemoteConversationException("无法读取电脑端模型列表")
                session.remoteSessionId to catalog
            } else {
                val deviceId = session.remoteDeviceId
                    ?: throw RemoteConversationException("此会话没有关联电脑设备")
                container.remoteConversationGateway.createDesktopSession(localSessionId, deviceId)
                    ?: return@async null
            }
            val (remoteSessionId, catalog) = result
            val current = catalog.models.firstOrNull { it.id == catalog.currentModelId }
            container.sessionStore.updateSession(
                session.copy(
                    remoteSessionId = remoteSessionId,
                    modelId = current?.id ?: session.modelId,
                    modelName = current?.name ?: session.modelName,
                ),
            )
            _state.update {
                it.copy(desktopModels = catalog.models, desktopSelectedModelId = catalog.currentModelId)
            }
            result
        }.also { created ->
            desktopSessionModelJobs[localSessionId] = created
            created.invokeOnCompletion {
                if (desktopSessionModelJobs[localSessionId] === created) desktopSessionModelJobs.remove(localSessionId)
            }
        }
        return job.await()
    }

    val sessionListItems: StateFlow<List<SessionListItem>> =
        combine(container.sessionStore.sessions, _state) { sessionList, s ->
            val localItems = sessionList.map { session ->
                val remoteDevice = session.remoteDeviceId?.let { id -> s.devices.firstOrNull { it.id == id } }
                SessionListItem(
                    id = session.id,
                    title = session.title,
                    subtitle =
                        if (session.origin == ConversationOrigin.Desktop) {
                            remoteDevice?.host.orEmpty()
                        } else {
                            session.modelName.orEmpty()
                        },
                    sourceLabel =
                        if (session.origin == ConversationOrigin.Desktop) {
                            remoteDevice?.name ?: Str.desktopDevice
                        } else {
                            session.modelName?.takeIf { it.isNotBlank() } ?: Str.filterCloud
                        },
                    timeLabel = relativeTime(session.updatedAtEpochMs),
                    isCloud = session.origin == ConversationOrigin.Cloud,
                    remoteSessionId = session.remoteSessionId,
                )
            }
            val knownRemoteIds = sessionList.mapNotNull { it.remoteSessionId }.toSet()
            val remoteItems = s.remoteDesktopSessions
                .filterNot { it.id in knownRemoteIds }
                .map { summary ->
                    SessionListItem(
                        id = "remote:${summary.id}",
                        title = summary.title,
                        subtitle = Str.desktopDevice,
                        sourceLabel = Str.desktopDevice,
                        timeLabel = relativeTime(summary.updatedAtEpochMs),
                        isCloud = false,
                        remoteSessionId = summary.id,
                    )
                }
            (localItems + remoteItems).sortedByDescending { item ->
                if (item.remoteSessionId != null) {
                    s.remoteDesktopSessions.firstOrNull { it.id == item.remoteSessionId }?.updatedAtEpochMs ?: 0L
                } else {
                    sessionList.firstOrNull { it.id == item.id }?.updatedAtEpochMs ?: 0L
                }
            }
        }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    fun sessionListItems(): List<SessionListItem> = sessionListItems.value

    private fun relativeTime(epochMs: Long): String {
        val delta = (nowEpochMs() - epochMs).coerceAtLeast(0)
        val minutes = delta / 60_000
        return when {
            minutes < 1 -> "刚刚"
            minutes < 60 -> "${minutes} 分钟前"
            minutes < 60 * 24 -> "${minutes / 60} 小时前"
            else -> "${minutes / (60 * 24)} 天前"
        }
    }

    fun setLoginModeEmail(email: Boolean) {
        _state.update { it.copy(loginModeEmail = email) }
    }

    fun setPasswordVisible(visible: Boolean) {
        _state.update { it.copy(passwordVisible = visible) }
    }

    fun clearAuthError() {
        _state.update { it.copy(authError = null) }
    }

    fun clearRemoteError() {
        _state.update { it.copy(remoteError = null) }
    }

    fun clearChatError() {
        _state.update { it.copy(chatError = null) }
    }

    fun onDraftChange(value: String) {
        val sid = _state.value.currentSessionId
        if (sid != null) {
            drafts[sid] = value
            if (value.isNotBlank()) {
                inputPredictionJobs.remove(sid)?.cancel()
                inputPredictionsBySession.remove(sid)
                inputPredictionLoadingSessions.remove(sid)
            }
        }
        _state.update {
            it.copy(
                draft = value,
                inputPredictions = if (value.isNotBlank()) emptyList() else sid?.let(inputPredictionsBySession::get).orEmpty(),
                inputPredictionLoading = sid != null && sid in inputPredictionLoadingSessions,
            )
        }
    }

    fun selectInputPrediction(value: String) {
        onDraftChange(value)
        _state.update { it.copy(inputPredictions = emptyList()) }
    }

    fun addPendingImages(images: List<MessageImage>) {
        if (images.isEmpty()) return
        _state.update { state ->
            state.copy(pendingImages = (state.pendingImages + images).distinctBy { it.id }.take(6))
        }
    }

    fun removePendingImage(id: String) {
        _state.update { it.copy(pendingImages = it.pendingImages.filterNot { img -> img.id == id }) }
    }

    fun setGroupPickerOpen(open: Boolean) {
        _state.update { it.copy(groupPickerOpen = open) }
    }

    fun setActive567Group(group: String?) {
        val oldGroup = _state.value.active567Group
        if (oldGroup != null && oldGroup != group) {
            viewModelScope.launch {
                runCatching { container.client.models.cleanupGroupToken(oldGroup) }
            }
        }
        container.preferences.active567Group = group
        val cached = container.preferences.getCachedGroupModels(group).map { id ->
            val isReasoning = id.contains("reasoner", ignoreCase = true) ||
                    id.contains("r1", ignoreCase = true) ||
                    id.contains("o1", ignoreCase = true) ||
                    id.contains("o3", ignoreCase = true) ||
                    id.contains("thinking", ignoreCase = true) ||
                    id.contains("sol", ignoreCase = true)
            LlmModel(id = id, modelId = id, name = id, providerName = group ?: "567 API", reasoning = isReasoning)
        }
        val immediateSelected = resolveModelId(container.preferences.lastModelId, cached) ?: cached.firstOrNull()?.id
        _state.update {
            it.copy(
                active567Group = group,
                catalogLoading = cached.isEmpty(),
                models = if (cached.isNotEmpty()) cached else it.models,
                selectedModelId = immediateSelected ?: it.selectedModelId,
            )
        }
        viewModelScope.launch {
            try {
                val models = container.client.models.listGoModels(group)
                val finalModels = if (models.isNotEmpty()) models else _state.value.models
                val selected = resolveModelId(container.preferences.lastModelId, finalModels) ?: finalModels.firstOrNull()?.id
                _state.update {
                    it.copy(models = finalModels, selectedModelId = selected, catalogLoading = false)
                }
            } catch (_: Throwable) {
                _state.update { it.copy(catalogLoading = false) }
            }
        }
    }


    fun setImagePickerOpen(open: Boolean) {
        _state.update {
            it.copy(
                imagePickerOpen = open,
                imageGroupExpanded = if (open && it.activeImageGroup == null) true else it.imageGroupExpanded,
            )
        }
        if (open && !_state.value.activeImageGroup.isNullOrBlank() && _state.value.availableImageModels.isEmpty()) {
            loadGroupImageModels(_state.value.activeImageGroup)
        }
    }

    fun setImageGroupExpanded(expanded: Boolean) {
        _state.update { it.copy(imageGroupExpanded = expanded) }
    }

    fun setImageGenEnabled(enabled: Boolean) {
        container.preferences.imageGenEnabled = enabled
        _state.update { it.copy(imageGenEnabled = enabled) }
    }

    fun setActiveImageGroup(group: String?) {
        val oldGroup = _state.value.activeImageGroup
        if (oldGroup != null && oldGroup != group) {
            viewModelScope.launch {
                runCatching { container.client.models.cleanupGroupToken(oldGroup) }
            }
        }
        container.preferences.activeImageGroup = group
        // 选中分组后关键步骤：立即自动折叠收起分组列表，展现对应模型
        _state.update {
            it.copy(
                activeImageGroup = group,
                imageGroupExpanded = false,
                imageModelsLoading = true,
            )
        }
        loadGroupImageModels(group)
    }

    fun setActiveImageModel(model: String?) {
        container.preferences.activeImageModel = model
        _state.update {
            it.copy(
                activeImageModel = model,
                imagePickerOpen = false,
            )
        }
    }

    private fun loadGroupImageModels(group: String?) {
        if (group.isNullOrBlank()) {
            _state.update { it.copy(availableImageModels = emptyList(), imageModelsLoading = false) }
            return
        }
        viewModelScope.launch {
            try {
                val models = container.client.models.fetchGroupImageModels(group)
                val current = _state.value.activeImageModel
                val selected = if (current != null && models.contains(current)) {
                    current
                } else {
                    models.find { it == "gemini-3.1-flash-image" } ?: models.firstOrNull()
                }
                if (selected != null) {
                    container.preferences.activeImageModel = selected
                }
                _state.update {
                    it.copy(
                        availableImageModels = models,
                        activeImageModel = selected,
                        imageModelsLoading = false,
                    )
                }
            } catch (_: Throwable) {
                _state.update { it.copy(imageModelsLoading = false) }
            }
        }
    }

    fun selectModel(model: LlmModel) {
        val sid = _state.value.currentSessionId
        if (sid != null) {
            viewModelScope.launch {
                val session = container.sessionStore.getSession(sid) ?: return@launch
                if (session.origin == ConversationOrigin.Desktop) {
                    try {
                        val ready = ensureDesktopSessionModels(sid)
                            ?: throw RemoteConversationException("电脑会话尚未准备好，请稍后重试")
                        val catalog = container.remoteConversationGateway.selectDesktopSessionModel(
                            sid,
                            ready.first,
                            model.id,
                        ) ?: throw RemoteConversationException("无法切换电脑端模型，请确认电脑仍在线")
                        val selected = catalog.models.firstOrNull { it.id == catalog.currentModelId } ?: model
                        // ensureDesktopSessionModels may have just persisted the remote session id.
                        // Re-read before updating model metadata so this copy does not overwrite it.
                        val latestSession = container.sessionStore.getSession(sid) ?: session
                        container.sessionStore.updateSession(latestSession.copy(modelId = selected.id, modelName = selected.name))
                        _state.update {
                            it.copy(
                                desktopModels = catalog.models,
                                desktopSelectedModelId = catalog.currentModelId ?: selected.id,
                                modelPickerOpen = false,
                            )
                        }
                    } catch (error: Throwable) {
                        setSessionError(sid, error, desktopOnly = true)
                    }
                    return@launch
                }
                container.preferences.lastModelId = model.id
                _state.update { it.copy(selectedModelId = model.id, modelPickerOpen = false) }
                container.sessionStore.updateSession(session.copy(modelId = model.id, modelName = model.name))
            }
            return
        }
        container.preferences.lastModelId = model.id
        _state.update { it.copy(selectedModelId = model.id, modelPickerOpen = false) }
    }

    fun setThemeMode(mode: ThemeMode) {
        container.preferences.setThemeMode(mode)
    }

    fun setAutoResumeLastSession(enabled: Boolean) {
        container.preferences.setAutoResumeLastSession(enabled)
    }

    fun setMotionEnabled(enabled: Boolean) {
        container.preferences.setMotionEnabled(enabled)
    }

    fun setInputPredictionEnabled(enabled: Boolean) {
        container.preferences.setInputPredictionEnabled(enabled)
        if (!enabled) {
            inputPredictionJobs.values.forEach(Job::cancel)
            inputPredictionJobs.clear()
            inputPredictionsBySession.clear()
            inputPredictionLoadingSessions.clear()
            _state.update { it.copy(inputPredictions = emptyList(), inputPredictionLoading = false) }
        }
    }

    fun setConfirmBeforeDelete(enabled: Boolean) {
        container.preferences.setConfirmBeforeDelete(enabled)
    }

    fun setMigrationBackupLimitMb(limitMb: Int) {
        container.preferences.setMigrationBackupLimitMb(limitMb)
    }

    fun clearLocalSessions() {
        viewModelScope.launch {
            cancelAllStreams()
            messagesCollectJob?.cancel()
            messagesCollectJob = null
            container.sessionStore.sessions.value.map { it.id }.forEach { id ->
                container.sessionStore.deleteSession(id)
            }
            drafts.clear()
            container.preferences.lastSessionId = null
            _state.update {
                it.copy(
                    currentSessionId = null,
                    messages = emptyList(),
                    draft = "",
                    pendingImages = emptyList(),
                    pendingQuestion = null,
                    isStreaming = false,
                    streamingStatus = null,
                    modelPickerOpen = false,
                )
            }
        }
    }

    fun exportSessionMigration(
        passphrase: String,
        onProgress: (String) -> Unit = {},
        onComplete: (ByteArray?, String?) -> Unit,
    ) {
        viewModelScope.launch {
            val limitMb = container.preferences.migrationBackupLimitMb.value
            val result = runCatching {
                withContext(Dispatchers.Default) {
                    SessionMigrationBackup(container.sessionStore).export(passphrase, limitMb) { progress ->
                        val message = when (progress.stage) {
                            org.agent567.android.data.session.MigrationBackupProgress.Stage.Collecting ->
                                if (progress.total > 0) "正在读取会话 ${progress.completed}/${progress.total}…" else Str.migrationProgressCollecting
                            org.agent567.android.data.session.MigrationBackupProgress.Stage.Encrypting -> Str.migrationProgressEncrypting
                            else -> Str.migrationProgressCollecting
                        }
                        viewModelScope.launch { onProgress(message) }
                    }
                }
            }
            val error = result.exceptionOrNull()
            val message = when (error) {
                is MigrationBackupTooLargeException ->
                    Str.migrationBackupTooLarge
                        .replace("{actual}", formatBackupSizeMb(error.actualBytes))
                        .replace("{limit}", formatBackupSizeMb(error.limitBytes))
                null -> null
                else -> Str.migrationExportFailure
            }
            onComplete(result.getOrNull(), message)
        }
    }

    fun importSessionMigration(
        archive: ByteArray,
        passphrase: String,
        onProgress: (String) -> Unit = {},
        onComplete: (Int?, String?) -> Unit,
    ) {
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.Default) {
                    SessionMigrationBackup(container.sessionStore).import(archive, passphrase) { progress ->
                        val message = when (progress.stage) {
                            org.agent567.android.data.session.MigrationBackupProgress.Stage.Decrypting -> Str.migrationProgressDecrypting
                            org.agent567.android.data.session.MigrationBackupProgress.Stage.Importing -> Str.migrationProgressImporting
                            else -> Str.migrationProgressImporting
                        }
                        viewModelScope.launch { onProgress(message) }
                    }
                }
            }
            val error = result.exceptionOrNull()
            onComplete(
                result.getOrNull(),
                when (error) {
                    is MigrationBackupTooLargeException -> Str.migrationImportTooLarge
                        .replace("{limit}", formatBackupSizeMb(error.limitBytes))
                    else -> error?.message
                },
            )
        }
    }

    fun login(accountOrEmail: String, password: String) {
        viewModelScope.launch {
            _state.update { it.copy(authLoading = true, authError = null) }
            try {
                val session = if (password.isBlank()) {
                    container.client.auth.loginWithAccessToken(accountOrEmail.trim())
                } else if (_state.value.loginModeEmail) {
                    container.client.auth.loginWithEmailPassword(accountOrEmail.trim(), password)
                } else {
                    container.client.auth.loginWithAccount(accountOrEmail.trim(), password)
                }
                container.preferences.authLoginType = if (password.isBlank()) "token" else "account"
                container.preferences.authAccount = accountOrEmail.trim()
                container.preferences.authPassword = if (password.isBlank()) null else password
                container.preferences.authToken = session.accessToken
                container.preferences.authRefreshToken = session.refreshToken
                container.preferences.authUsername = session.user.nickname.ifBlank { session.user.username }
                container.preferences.authQuotaUsd = session.user.quotaUsd
                container.preferences.authUserId = session.user.id

                val pendingAction = pendingLoginAction
                pendingLoginAction = null
                loadWorkspace(openLastSession = true)
                if (pendingAction == PendingLoginAction.CloudConversation) {
                    newChat()
                }
            } catch (t: Throwable) {
                _state.update {
                    it.copy(authLoading = false, authError = ErrorMapper.from(t))
                }
                return@launch
            }
            _state.update { it.copy(authLoading = false) }
        }
    }

    private enum class PendingLoginAction {
        CloudConversation,
    }

    fun sendVerificationCode(email: String, onResult: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            try {
                val msg = container.client.auth.sendVerificationCode(email)
                onResult(true, msg)
            } catch (t: Throwable) {
                onResult(false, t.message ?: "发送验证码失败")
            }
        }
    }

    fun register(
        username: String,
        password: String,
        email: String,
        code: String,
        affCode: String?,
        onResult: (Boolean, String?) -> Unit,
    ) {
        viewModelScope.launch {
            _state.update { it.copy(authLoading = true, authError = null) }
            try {
                val session = container.client.auth.register(username, password, email, code, affCode)
                container.preferences.authLoginType = "account"
                container.preferences.authAccount = username.trim()
                container.preferences.authPassword = password
                container.preferences.authToken = session.accessToken
                container.preferences.authRefreshToken = session.refreshToken
                container.preferences.authUsername = session.user.nickname.ifBlank { session.user.username }
                container.preferences.authQuotaUsd = session.user.quotaUsd
                container.preferences.authUserId = session.user.id

                val pendingAction = pendingLoginAction
                pendingLoginAction = null
                loadWorkspace(openLastSession = true)
                if (pendingAction == PendingLoginAction.CloudConversation) {
                    newChat()
                }
                onResult(true, null)
            } catch (t: Throwable) {
                val err = ErrorMapper.from(t)
                _state.update {
                    it.copy(authLoading = false, authError = err)
                }
                onResult(false, err.message)
                return@launch
            }
            _state.update { it.copy(authLoading = false) }
        }
    }

    fun setTopupDialogOpen(open: Boolean) {
        _state.update { it.copy(topupDialogOpen = open, topupLoading = false, topupMessage = null) }
    }

    fun topupWithKey(key: String, onResult: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(topupLoading = true, topupMessage = null) }
            try {
                val msg = container.client.subscription.topupWithKey(key)
                refreshCatalog()
                _state.update { it.copy(topupLoading = false, topupMessage = msg) }
                onResult(true, msg)
            } catch (t: Throwable) {
                val err = t.message ?: "兑换失败"
                _state.update { it.copy(topupLoading = false, topupMessage = err) }
                onResult(false, err)
            }
        }
    }

    fun createPayOrder(
        amount: Int,
        method: String,
        onUrlReady: (org.agent567.android.core.PayOrderResult, Double) -> Unit,
        onError: (String) -> Unit,
    ) {
        viewModelScope.launch {
            _state.update { it.copy(topupLoading = true, topupMessage = null) }
            try {
                val freshUser = container.client.auth.me()
                container.preferences.authUsername = freshUser.nickname.ifBlank { freshUser.username }
                container.preferences.authQuotaUsd = freshUser.quotaUsd
                container.preferences.authUserId = freshUser.id
                _state.update { it.copy(user = freshUser) }
                val payResult = container.client.subscription.createPayOrder(amount, method)
                _state.update { it.copy(topupLoading = false) }
                onUrlReady(payResult, freshUser.quotaUsd)
            } catch (t: Throwable) {
                val err = t.message ?: "创建支付订单失败"
                _state.update { it.copy(topupLoading = false, topupMessage = err) }
                onError(err)
            }
        }
    }

    fun logout(clearLocalSessions: Boolean) {
        viewModelScope.launch {
            cancelAllStreams()
            runCatching { container.client.auth.logout() }
            container.preferences.clearAuthSnapshot()
            forceLogout(keepLocalSessions = !clearLocalSessions)
        }
    }

    private suspend fun forceLogout(keepLocalSessions: Boolean, message: String? = null) {
        cancelAllStreams()
        container.client.auth.clearLocalSession()
        container.preferences.clearAuthSnapshot()
        if (!keepLocalSessions) {
            container.sessionStore.sessions.value.map { it.id }.forEach {
                container.sessionStore.deleteSession(it)
            }
        }
        drafts.clear()
        container.preferences.lastSessionId = null
        _state.update {
            it.copy(
                mainAccessGranted = false,
                user = null,
                subscription = null,
                subscriptionLoadFailed = false,
                models = emptyList(),
                selectedModelId = null,
                currentSessionId = null,
                messages = emptyList(),
                draft = "",
                pendingImages = emptyList(),
                isStreaming = false,
                streamingStatus = null,
                pendingQuestion = null,
                route = AppRoute.Login,
                mainTab = MainTab.Home,
                modelPickerOpen = false,
                authError =
                    message?.let {
                        UiError(title = "已退出", message = it, action = UiErrorAction.None)
                    },
            )
        }
    }

    fun refreshCatalog() {
        viewModelScope.launch {
            _state.update { it.copy(catalogLoading = true) }
            try {
                val sub = runCatching { container.client.subscription.me() }.getOrNull()
                _state.update {
                    it.copy(
                        subscription = sub,
                        subscriptionLoadFailed = sub == null,
                    )
                }
                val groups = runCatching { container.client.models.getAvailableGroups() }.getOrDefault(emptyMap())
                val currentGroup = _state.value.active567Group
                val models = container.client.models.listGoModels(currentGroup)
                val finalModels = if (models.isNotEmpty()) models else _state.value.models
                val selected =
                    resolveModelId(_state.value.selectedModelId ?: container.preferences.lastModelId, finalModels)
                        ?: finalModels.firstOrNull()?.id
                _state.update {
                    it.copy(
                        subscription = sub,
                        subscriptionLoadFailed = sub == null,
                        available567Groups = if (groups.isNotEmpty()) groups else it.available567Groups,
                        models = finalModels,
                        selectedModelId = selected,
                        catalogLoading = false,
                    )
                }
            } catch (t: Throwable) {
                _state.update {
                    it.copy(
                        catalogLoading = false,
                    )
                }
            }
        }
    }

    fun refreshQuota() {
        viewModelScope.launch {
            _state.update { it.copy(quotaRefreshing = true) }
            try {
                val user = container.client.auth.me()
                container.preferences.authUsername = user.nickname.ifBlank { user.username }
                container.preferences.authQuotaUsd = user.quotaUsd
                container.preferences.authUserId = user.id
                _state.update { it.copy(user = user) }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                // Keep current account data; do not broadcast refresh failures into chat.
            } finally {
                _state.update { it.copy(quotaRefreshing = false) }
            }
        }
    }

    fun newChat() {
        if (container.tokenStore.accessToken == null) {
            openLogin()
            return
        }
        viewModelScope.launch {
            val model = currentModel() ?: _state.value.models.firstOrNull()
            val session =
                container.sessionStore.createSession(
                    title = SessionStore.DEFAULT_TITLE,
                    modelId = model?.id,
                    modelName = model?.name,
                )
            if (_state.value.selectedModelId == null && model != null) {
                _state.update { it.copy(selectedModelId = model.id) }
            }
            container.preferences.lastSessionId = session.id
            drafts[session.id] = ""
            _state.update { it.copy(pendingImages = emptyList()) }
            openChat(
                sessionId = session.id,
                surface = ChatSurface.Cloud,
                title = session.title,
            )
        }
    }

    fun startDesktopConversation(deviceId: String) {
        viewModelScope.launch {
            val device = _state.value.devices.firstOrNull { it.id == deviceId }
            if (device == null) {
                _state.update {
                    it.copy(
                        remoteError =
                            UiError(
                                title = Str.desktopUnavailable,
                                message = Str.desktopUnavailableHint,
                                action = UiErrorAction.None,
                            ),
                    )
                }
                return@launch
            }
            _state.update { it.copy(mainAccessGranted = true) }
            val session =
                container.sessionStore.createSession(
                    title = Str.conversationWith.replace("%s", device.name),
                    origin = ConversationOrigin.Desktop,
                    remoteDeviceId = deviceId,
                    remoteSessionCreatedOnMobile = true,
                )
            openChat(
                sessionId = session.id,
                surface = ChatSurface.Desktop,
                title = session.title,
                deviceId = deviceId,
            )
        }
    }

    fun deleteSession(sessionId: String) {
        viewModelScope.launch {
            val session = container.sessionStore.sessions.value.firstOrNull { it.id == sessionId }
            val remoteSessionId = session?.remoteSessionId
                ?: sessionId.removePrefix("remote:").takeIf { sessionId.startsWith("remote:") }
            if (remoteSessionId != null) {
                val deviceId = session?.remoteDeviceId ?: container.remoteConversationGateway.devices.value
                    .firstOrNull { it.status == org.agent567.android.domain.device.DeviceStatus.Online }
                    ?.id
                if (deviceId == null) {
                    _state.update { it.copy(remoteError = ErrorMapper.from(RemoteConversationException("请先连接电脑再删除电脑会话"))) }
                    return@launch
                }
                try {
                    val deleted = container.remoteConversationGateway.deleteDesktopSession(deviceId, remoteSessionId)
                    if (deleted != true) throw RemoteConversationException("电脑暂时无法删除这段会话，请确认设备在线")
                } catch (error: Throwable) {
                    if (error !is CancellationException) {
                        _state.update { it.copy(remoteError = ErrorMapper.from(error)) }
                    }
                    return@launch
                }
                session?.let {
                    cancelStream(it.id)
                    if (_state.value.currentSessionId == it.id) {
                        navigateBackFromSecondary()
                    }
                    container.sessionStore.deleteSession(it.id)
                    drafts.remove(it.id)
                    if (container.preferences.lastSessionId == it.id) {
                        container.preferences.lastSessionId = null
                    }
                }
                _state.update { state ->
                    state.copy(
                        remoteDesktopSessions = state.remoteDesktopSessions.filterNot { it.id == remoteSessionId },
                        pendingQuestion = state.pendingQuestion?.takeIf { it.sessionId != sessionId },
                    )
                }
                return@launch
            }
            cancelStream(sessionId)
            container.sessionStore.deleteSession(sessionId)
            drafts.remove(sessionId)
            if (container.preferences.lastSessionId == sessionId) {
                container.preferences.lastSessionId = null
            }
            if (_state.value.currentSessionId == sessionId) {
                navigateBackFromSecondary()
            }
            _state.update { state ->
                state.copy(pendingQuestion = state.pendingQuestion?.takeIf { it.sessionId != sessionId })
            }
        }
    }

    fun renameSession(sessionId: String, title: String) {
        viewModelScope.launch {
            val session = container.sessionStore.getSession(sessionId) ?: return@launch
            val cleaned = title.trim().ifBlank { SessionStore.DEFAULT_TITLE }
            container.sessionStore.updateSession(session.copy(title = cleaned, titleManuallyEdited = true))
        }
    }

    private suspend fun generatePhoneSessionTitle(
        sessionId: String,
        firstMessage: String,
        modelId: String,
        groupName: String?,
    ) {
        val session = container.sessionStore.getSession(sessionId) ?: return
        if (session.titleManuallyEdited || session.title != SessionStore.DEFAULT_TITLE) return
        try {
            val title = buildString {
                container.client.chat.stream(
                    model = modelId,
                    messages = listOf(
                        ChatMessage(
                            ChatRole.System,
                            "为这段对话起一个简短、具体的标题，遵循电脑端对话列表的命名风格。使用用户消息的语言；中文控制在 2 到 12 个字，其他语言不超过 8 个词。只输出标题，不要引号、解释或 Markdown。",
                        ),
                        ChatMessage(ChatRole.User, firstMessage),
                    ),
                    temperature = 0.2,
                    groupName = groupName,
                ).collect { event ->
                    if (event is ChatStreamEvent.Delta && length < 160) append(event.text.take(160 - length))
                    if (event is ChatStreamEvent.Error) throw event.exception
                }
            }.trim().trim('"', '\'', '`', '“', '”', '「', '」').replace(Regex("\\s+"), " ")
                .removePrefix("标题：")
                .removePrefix("标题:")
                .take(80)
                .trim()
            updatePhoneAutoTitle(sessionId, title.ifBlank { firstMessage.take(40) })
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            updatePhoneAutoTitle(sessionId, firstMessage.take(40))
        }
    }

    private suspend fun updatePhoneAutoTitle(sessionId: String, title: String) {
        if (title.isBlank()) return
        val latest = container.sessionStore.getSession(sessionId) ?: return
        if (!latest.titleManuallyEdited && latest.title == SessionStore.DEFAULT_TITLE) {
            container.sessionStore.updateSession(latest.copy(title = title.trim()))
        }
    }

    private suspend fun generateInputPredictions(
        modelId: String,
        groupName: String?,
        conversation: String,
    ): List<String> {
        if (conversation.isBlank()) return emptyList()
        return try {
            val output = buildString {
                container.client.chat.stream(
                    model = modelId,
                    messages = listOf(
                        ChatMessage(
                            ChatRole.System,
                            "根据最近对话，预测用户接下来最可能发送的 0 到 3 条短消息。使用用户的第一人称和对话语言，只输出建议内容，每条单独一行，不要解释。没有自然后续时不输出内容。",
                        ),
                        ChatMessage(ChatRole.User, conversation),
                    ),
                    temperature = 0.5,
                    groupName = groupName,
                ).collect { event ->
                    if (event is ChatStreamEvent.Delta && length < 1200) append(event.text.take(1200 - length))
                    if (event is ChatStreamEvent.Error) throw event.exception
                }
            }
            output.lineSequence()
                .map { it.trim().replace(Regex("^(?:[-*•]|\\d+[.、)])\\s*"), "").trim('"', '\'', '`') }
                .filter { it.length in 2..120 }
                .distinct()
                .take(3)
                .toList()
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            emptyList()
        }
    }

    fun sendMessage() = sendMessage(retryPreviousTurn = false)

    private fun sendMessage(retryPreviousTurn: Boolean) {
        val text = _state.value.draft.trim()
        val images = _state.value.pendingImages
        val activeSessionId = _state.value.currentSessionId
        if ((text.isEmpty() && images.isEmpty()) || activeSessionId?.let {
                streamJobs[it]?.isActive == true || it in retryPreparingSessions
            } == true
        ) return
        val sendReservation = activeSessionId ?: NEW_SESSION_SEND_RESERVATION
        if (NEW_SESSION_SEND_RESERVATION in pendingSendReservations || !pendingSendReservations.add(sendReservation)) return
        activeSessionId?.let { inputPredictionJobs.remove(it)?.cancel() }

        viewModelScope.launch {
            val route = _state.value.route as? AppRoute.Chat
            val isDesktop = route?.surface == ChatSurface.Desktop ||
                _state.value.currentSessionId?.let { container.sessionStore.getSession(it)?.origin == ConversationOrigin.Desktop } == true
            if (!isDesktop && container.tokenStore.accessToken.isNullOrBlank()) {
                openLogin()
                return@launch
            }
            val model = currentModel()
            var sessionId = _state.value.currentSessionId
            if (sessionId == null) {
                val route = _state.value.route as? AppRoute.Chat
                val origin =
                    if (route?.surface == ChatSurface.Desktop) {
                        ConversationOrigin.Desktop
                    } else {
                        ConversationOrigin.Cloud
                    }
                if (origin == ConversationOrigin.Cloud && model == null) {
                    showNoModelError()
                    return@launch
                }
                if (origin == ConversationOrigin.Desktop && route?.deviceId == null) {
                    _state.update {
                        if (it.route != route || it.currentSessionId != null) it else it.copy(
                            chatError =
                                UiError(
                                    title = Str.desktopUnavailable,
                                    message = Str.desktopSessionMissingHint,
                                    action = UiErrorAction.None,
                                ),
                        )
                    }
                    return@launch
                }
                val session =
                    container.sessionStore.createSession(
                        modelId = model?.id,
                        modelName = model?.name,
                        origin = origin,
                        remoteDeviceId = route?.deviceId,
                    )
                sessionId = session.id
                container.preferences.lastSessionId = sessionId
                attachSession(sessionId)
                val surface =
                    (_state.value.route as? AppRoute.Chat)?.surface ?: ChatSurface.Cloud
                _state.update {
                    it.copy(
                        currentSessionId = sessionId,
                        route =
                            AppRoute.Chat(
                                sessionId = sessionId,
                                surface = surface,
                                title = (_state.value.route as? AppRoute.Chat)?.title.orEmpty(),
                                deviceId = (_state.value.route as? AppRoute.Chat)?.deviceId,
                            ),
                    )
                }
            }

            val sid = sessionId
            var session = container.sessionStore.getSession(sid) ?: return@launch
            if (session.origin == ConversationOrigin.Desktop &&
                (session.remoteSessionId == null || desktopSessionModelJobs.containsKey(sid))
            ) {
                try {
                    ensureDesktopSessionModels(sid)
                    session = container.sessionStore.getSession(sid) ?: return@launch
                } catch (error: Throwable) {
                        setSessionError(sid, error, desktopOnly = true)
                    return@launch
                }
            }
            if (session.origin == ConversationOrigin.Cloud && model == null && session.modelId == null) {
                showNoModelError()
                return@launch
            }
            val persistedImages = try {
                container.sessionStore.persistMessageImages(images)
            } catch (error: Exception) {
                pendingSendReservations.remove(sendReservation)
                setSessionError(sid, error)
                return@launch
            }
            val userMsg =
                LocalMessage(
                    id = newMessageId(),
                    sessionId = sid,
                    role = ChatRole.User,
                    content = text,
                    status = MessageStatus.Complete,
                    createdAtEpochMs = nowEpochMs(),
                    images = persistedImages,
                )
            val isFirstUserMessage = !retryPreviousTurn && container.sessionStore.getMessages(sid).none { it.role == ChatRole.User }
            val titleModelId = model?.id ?: session.modelId
            val titleGroupName = _state.value.active567Group
            val titlePrompt = text.take(1200).ifBlank { if (images.isNotEmpty()) "用户发送了一张图片" else "" }
            val assistantId = newMessageId()
            val assistantMsg =
                LocalMessage(
                    id = assistantId,
                    sessionId = sid,
                    role = ChatRole.Assistant,
                    content = "",
                    status = MessageStatus.Streaming,
                    createdAtEpochMs = nowEpochMs() + 1,
                )
            container.sessionStore.upsertMessage(userMsg)
            container.sessionStore.upsertMessage(assistantMsg)
            drafts[sid] = ""
            inputPredictionsBySession.remove(sid)
            inputPredictionLoadingSessions.remove(sid)
            streamStatuses[sid] = "running"
            updateVisibleSession(sid) {
                it.copy(
                    draft = "",
                    pendingImages = emptyList(),
                    isStreaming = true,
                    streamingStatus = "running",
                    inputPredictions = emptyList(),
                    inputPredictionLoading = false,
                    chatError = null,
                )
            }

            val historyMessages =
                container.sessionStore
                    .getMessages(sid)
                    .filter {
                        it.id != assistantId &&
                            it.status != MessageStatus.Error &&
                            it.hasVisualContent
                    }
            val history = buildChatHistory(historyMessages)

            val streamJob = viewModelScope.launch(start = CoroutineStart.LAZY) {
                    var assembled = ""
                    var toolEvents = emptyList<ToolTrace>()
                    var assistantImages = assistantMsg.images
                    var usage: TokenUsage? = null
                    var contextPercent: Int? = null
                    var pendingQuestion: PendingQuestion? = null
                    var hasPublishedDelta = false
                    var responseTruncated = false
                    var pendingPersist: Job? = null

                    suspend fun persistAssistant(status: MessageStatus = MessageStatus.Streaming) {
                        val snapshot = assistantMsg.copy(
                            content = assembled,
                            status = status,
                            images = assistantImages,
                            toolEvents = toolEvents,
                            usage = usage,
                            contextPercent = contextPercent,
                            pendingQuestion = pendingQuestion,
                        )
                        if (status == MessageStatus.Streaming) {
                            container.sessionStore.upsertStreamingMessage(snapshot)
                        } else {
                            container.sessionStore.upsertMessage(snapshot)
                        }
                    }

                    suspend fun flushPendingPersist() {
                        pendingPersist?.cancelAndJoin()
                        pendingPersist = null
                        persistAssistant()
                    }

                    fun schedulePersist() {
                        if (pendingPersist != null) return
                        pendingPersist = launch {
                            delay(STREAMING_PERSIST_INTERVAL_MS)
                            persistAssistant()
                            pendingPersist = null
                        }
                    }

                    try {
                        container.conversationRouter
                            .stream(
                                session = session,
                                selectedModelId = model?.id,
                                messages = history,
                                groupName = _state.value.active567Group,
                                imageGenModel = if (_state.value.imageGenEnabled) _state.value.activeImageModel else null,
                                retryPreviousTurn = retryPreviousTurn,
                            )
                            .collect { event ->
                                when (event) {
                                    is ChatStreamEvent.Delta -> {
                                        val remaining = MAX_ASSISTANT_MESSAGE_CHARS - assembled.length
                                        if (remaining > 0) {
                                            assembled += event.text.take(remaining)
                                        }
                                        if (event.text.length > remaining && !responseTruncated) {
                                            assembled += "\n\n[回复过长，后续内容已省略]"
                                            responseTruncated = true
                                        }
                                        if (!hasPublishedDelta) {
                                            hasPublishedDelta = true
                                            persistAssistant()
                                        } else {
                                            schedulePersist()
                                        }
                                    }
                                    is ChatStreamEvent.Tool -> {
                                        flushPendingPersist()
                                        // A response to a pending question may resume with a tool event.
                                        // The tool event is the durable boundary that clears the prompt.
                                        val isImageGen = event.toolName == "generate_image"
                                        pendingQuestion = null
                                        if (event.phase in setOf("call", "generating", "started", "updated", "phase", "arguments")) {
                                            val activity = event.phaseLabel
                                                ?.replace(Regex("[\\r\\n\\t]"), " ")
                                                ?.trim()
                                                ?.take(48)
                                                ?.takeIf(String::isNotBlank)
                                                ?: event.toolName.take(48)
                                            setStreamStatus(
                                                sid,
                                                if (isImageGen && event.phase == "call") "tool:generate_image" else "tool:$activity",
                                            )
                                        } else if (streamStatuses[sid]?.startsWith("tool:") == true) {
                                            setStreamStatus(sid, "running")
                                        }
                                        if (
                                            event.images.isNotEmpty() &&
                                            event.phase in setOf("completed", "complete") &&
                                            session.origin == ConversationOrigin.Desktop
                                        ) {
                                            fetchDesktopGeneratedImages(
                                                localSessionId = sid,
                                                assistantMessageId = assistantId,
                                                remoteSessionId = session.remoteSessionId
                                                    ?: container.conversationRouter.resolvedRemoteSessionId(session.id),
                                                images = event.images,
                                            )
                                        }
                                        if (isImageGen && event.phase == "call") {
                                            var promptArg = event.arguments.orEmpty()
                                            var isEdit = false
                                            try {
                                                val argsObj = org.agent567.android.core.net.VettaJson.parseToJsonElement(event.arguments.orEmpty()) as? kotlinx.serialization.json.JsonObject
                                                promptArg = (argsObj?.get("prompt") as? kotlinx.serialization.json.JsonPrimitive)?.content ?: promptArg
                                                val actionStr = (argsObj?.get("action") as? kotlinx.serialization.json.JsonPrimitive)?.content
                                                isEdit = actionStr == "edit"
                                            } catch (_: Exception) {
                                            }

                                            // 自动溯源上下文历史图片：优先匹配用户本轮上传，支持单图修改与多图融合创作
                                            val allSessionMsgs = container.sessionStore.getMessages(sid)
                                            val lastUserMsg = allSessionMsgs.filter { it.role == ChatRole.User }.lastOrNull()
                                            val userAttachedImages = lastUserMsg?.images.orEmpty()

                                            val refImages = if (userAttachedImages.isNotEmpty()) {
                                                // 用户本条消息直接附带了图片（例如上传2张图并要求融合），严格以用户本次上传的图片为准！
                                                loadImageBase64WithinBudget(userAttachedImages)
                                            } else {
                                                // 用户未在本次发送附带图片，从会话历史中追溯生成或上传的图片
                                                val historyImages = allSessionMsgs.flatMap { it.images }
                                                val editKeywords = listOf("改", "换", "修改", "替换", "参考", "融合", "结合", "加上", "去掉", "调成", "edit", "modify", "change", "replace", "fuse", "combine")
                                                val shouldAttachRef = isEdit || (historyImages.isNotEmpty() && editKeywords.any { promptArg.contains(it) })
                                                if (shouldAttachRef) {
                                                    loadImageBase64WithinBudget(historyImages.takeLast(3))
                                                } else {
                                                    emptyList()
                                                }
                                            }

                                            val displayLabel = if (refImages.size > 1) {
                                                "正在融合 ${refImages.size} 张参考图重绘..."
                                            } else if (refImages.isNotEmpty()) {
                                                "正在基于原图修改画面..."
                                            } else {
                                                "正在绘制画面..."
                                            }

                                            toolEvents = mergeToolTrace(
                                                toolEvents,
                                                ToolTrace(
                                                    phase = event.phase,
                                                    toolCallId = event.toolCallId,
                                                    toolName = event.toolName,
                                                    detail = event.detail,
                                                    durationMs = event.durationMs,
                                                    arguments = event.arguments,
                                                    result = event.result,
                                                    phaseLabel = displayLabel,
                                                ),
                                            )
                                            persistAssistant()

                                            val imgModel = _state.value.activeImageModel ?: "gemini-3.1-flash-image"
                                            val imgGroup = _state.value.activeImageGroup
                                            try {
                                                val res = container.client.models.generateImage(
                                                    prompt = promptArg,
                                                    model = imgModel,
                                                    groupName = imgGroup,
                                                    referenceImages = refImages,
                                                )
                                                val b64 = res.b64Json
                                                val url = res.url
                                                val finalB64 = if (!b64.isNullOrBlank()) {
                                                    b64.trim()
                                                } else if (!url.isNullOrBlank()) {
                                                    try {
                                                        val bytes = container.client.models.downloadImageBytesDirect(url)
                                                        @OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)
                                                        kotlin.io.encoding.Base64.encode(bytes)
                                                    } catch (cancelled: CancellationException) {
                                                        throw cancelled
                                                    } catch (_: Throwable) {
                                                        ""
                                                    }
                                                } else {
                                                    ""
                                                }

                                                val hasValidImage = finalB64.isNotBlank()
                                                val cleanText = res.textContent?.trim()?.takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) }
                                                val resultDesc = if (hasValidImage) {
                                                    "成功生成图片"
                                                } else if (cleanText != null) {
                                                    cleanText
                                                } else {
                                                    "未检测到图片数据，建议在右下角切换为 DALL-E 3 或 FLUX 等生图模型重试"
                                                }

                                                val doneLabel = if (hasValidImage) {
                                                    if (refImages.size > 1) "多图融合重绘完成" else if (refImages.isNotEmpty()) "基于原图修改完成" else "画面绘制完成"
                                                } else {
                                                    "生图完成"
                                                }
                                                val updatedTools = mergeToolTrace(
                                                    toolEvents,
                                                    ToolTrace(
                                                        phase = "completed",
                                                        toolCallId = event.toolCallId,
                                                        toolName = "generate_image",
                                                        detail = if (hasValidImage) doneLabel else resultDesc,
                                                        arguments = promptArg,
                                                        result = resultDesc,
                                                        phaseLabel = doneLabel,
                                                    ),
                                                )
                                                toolEvents = updatedTools

                                                val newImages = if (hasValidImage) {
                                                    listOf(
                                                        MessageImage(
                                                            id = "gen-${newMessageId()}",
                                                            mimeType = "image/png",
                                                            fileName = "generated.png",
                                                            base64Data = finalB64,
                                                        )
                                                    )
                                                } else {
                                                    emptyList()
                                                }

                                                val currentMsg = container.sessionStore.getMessages(sid).firstOrNull { it.id == assistantId }
                                                val currentImages = (currentMsg?.images ?: assistantMsg.images) + newImages
                                                val descSuffix = if (cleanText != null) "\n\n" + cleanText else ""
                                                val finalContent = if (assembled.isBlank()) {
                                                    if (hasValidImage) "画面绘制完成$descSuffix" else resultDesc
                                                } else {
                                                    assembled + descSuffix
                                                }

                                                container.sessionStore.upsertMessage(
                                                    (currentMsg ?: assistantMsg).copy(
                                                        content = finalContent,
                                                        status = MessageStatus.Complete,
                                                        images = currentImages,
                                                        toolEvents = updatedTools,
                                                    )
                                                )
                                                assistantImages = container.sessionStore
                                                    .getMessages(sid)
                                                    .firstOrNull { it.id == assistantId }
                                                    ?.images
                                                    ?: currentImages
                                            } catch (e: Throwable) {
                                                if (e is CancellationException) throw e
                                                val failMsg = e.message ?: "请求失败"
                                                val failTools = mergeToolTrace(
                                                    toolEvents,
                                                    ToolTrace(
                                                        phase = "error",
                                                        toolCallId = event.toolCallId,
                                                        toolName = "generate_image",
                                                        detail = "生图失败: $failMsg",
                                                        phaseLabel = "生图失败",
                                                    ),
                                                )
                                                toolEvents = failTools
                                                val currentMsg = container.sessionStore.getMessages(sid).firstOrNull { it.id == assistantId }
                                                container.sessionStore.upsertMessage(
                                                    (currentMsg ?: assistantMsg).copy(
                                                        status = MessageStatus.Complete,
                                                        toolEvents = failTools,
                                                        errorMessage = failMsg,
                                                    )
                                                )
                                                updateVisibleSession(sid) {
                                                    it.copy(
                                                        chatError = UiError(
                                                            title = "生图失败",
                                                            message = failMsg,
                                                            action = UiErrorAction.None,
                                                        )
                                                    )
                                                }
                                            }
                                        } else {
                                            toolEvents = mergeToolTrace(
                                                toolEvents,
                                                ToolTrace(
                                                    phase = event.phase,
                                                    toolCallId = event.toolCallId,
                                                    toolName = event.toolName,
                                                    detail = event.detail?.take(1200),
                                                    durationMs = event.durationMs,
                                                    arguments = event.arguments?.take(1200),
                                                    result = event.result?.take(1200),
                                                    phaseLabel = event.phaseLabel?.take(160),
                                                ),
                                            )
                                            persistAssistant()
                                        }
                                    }
                                    is ChatStreamEvent.UserInputRequired -> {
                                        flushPendingPersist()
                                        container.conversationRouter.resolvedRemoteSessionId(session.id)?.let { remoteId ->
                                            container.sessionStore.updateSession(session.copy(remoteSessionId = remoteId))
                                        }
                                        pendingQuestion = PendingQuestion(sid, event.requestId, event.questions)
                                        persistAssistant()
                                        updateVisibleSession(sid) { it.copy(pendingQuestion = pendingQuestion) }
                                    }
                                    is ChatStreamEvent.State -> {
                                        when (event.value) {
                                            "usage" -> {
                                                flushPendingPersist()
                                                usage = event.usage
                                                contextPercent = event.contextPercent
                                                persistAssistant()
                                            }
                                            "error" -> {
                                                setStreamStatus(sid, null)
                                                updateVisibleDesktopSession(sid) {
                                                    it.copy(
                                                        chatError = UiError(
                                                            title = "桌面执行失败",
                                                            message = event.detail ?: "请在电脑端检查模型配置和运行日志后重试",
                                                        ),
                                                    )
                                                }
                                            }
                                            "thinking", "running", "reconnecting" -> setStreamStatus(sid, event.value)
                                            "retrying", "compacting", "preparing", "background" -> setStreamStatus(sid, event.value)
                                            "completed", "aborted" -> setStreamStatus(sid, null)
                                        }
                                    }
                                    is ChatStreamEvent.Finished -> Unit
                                    ChatStreamEvent.Done -> {
                                        flushPendingPersist()
                                        pendingQuestion = null
                                        persistAssistant(MessageStatus.Complete)
                                        updateVisibleSession(sid) { it.copy(pendingQuestion = null) }
                                        setStreamStatus(sid, null)
                                        val predictionModelId = model?.id ?: session.modelId
                                        if (
                                            container.preferences.inputPredictionEnabled.value &&
                                            session.origin == ConversationOrigin.Cloud &&
                                            predictionModelId != null &&
                                            assembled.isNotBlank()
                                        ) {
                                            val conversation = buildString {
                                                history.takeLast(6).forEach { message ->
                                                    val role = if (message.role == ChatRole.User) "用户" else "助手"
                                                    append(role).append("：").append(message.textContent.take(700)).append('\n')
                                                }
                                                append("助手：").append(assembled.take(1600))
                                            }.takeLast(4000)
                                            val predictionSessionId = sid
                                            val predictionGroup = titleGroupName
                                            inputPredictionJobs.remove(predictionSessionId)?.cancel()
                                            inputPredictionsBySession.remove(predictionSessionId)
                                            inputPredictionLoadingSessions.add(predictionSessionId)
                                            updateVisibleSession(predictionSessionId) {
                                                it.copy(inputPredictionLoading = true, inputPredictions = emptyList())
                                            }
                                            val predictionJob = viewModelScope.launch(start = CoroutineStart.LAZY) {
                                                try {
                                                    val suggestions = generateInputPredictions(
                                                        predictionModelId,
                                                        predictionGroup,
                                                        conversation,
                                                    )
                                                    val draftIsBlank = drafts[predictionSessionId].orEmpty().isBlank()
                                                    if (container.preferences.inputPredictionEnabled.value && draftIsBlank) {
                                                        inputPredictionsBySession[predictionSessionId] = suggestions
                                                    }
                                                    updateVisibleSession(predictionSessionId) {
                                                        it.copy(inputPredictions = if (draftIsBlank) suggestions else emptyList())
                                                    }
                                                } finally {
                                                    inputPredictionLoadingSessions.remove(predictionSessionId)
                                                    if (inputPredictionJobs[predictionSessionId] === currentCoroutineContext()[Job]) {
                                                        inputPredictionJobs.remove(predictionSessionId)
                                                    }
                                                    updateVisibleSession(predictionSessionId) {
                                                        it.copy(inputPredictionLoading = false)
                                                    }
                                                }
                                            }
                                            inputPredictionJobs[predictionSessionId] = predictionJob
                                            predictionJob.start()
                                        } else if (
                                            container.preferences.inputPredictionEnabled.value &&
                                            session.origin == ConversationOrigin.Desktop &&
                                            assembled.isNotBlank()
                                        ) {
                                            val remoteSessionId = session.remoteSessionId
                                                ?: container.conversationRouter.resolvedRemoteSessionId(session.id)
                                            val desktopDeviceId = session.remoteDeviceId
                                            if (remoteSessionId != null && desktopDeviceId != null) {
                                                val predictionSessionId = sid
                                                inputPredictionJobs.remove(predictionSessionId)?.cancel()
                                                inputPredictionsBySession.remove(predictionSessionId)
                                                inputPredictionLoadingSessions.add(predictionSessionId)
                                                updateVisibleSession(predictionSessionId) {
                                                    it.copy(inputPredictionLoading = true, inputPredictions = emptyList())
                                                }
                                                val predictionJob = viewModelScope.launch(start = CoroutineStart.LAZY) {
                                                    try {
                                                        val suggestions = try {
                                                            container.remoteConversationGateway
                                                                .readDesktopPromptSuggestions(predictionSessionId, remoteSessionId)
                                                                .orEmpty()
                                                        } catch (cancelled: CancellationException) {
                                                            throw cancelled
                                                        } catch (_: Throwable) {
                                                            emptyList()
                                                        }
                                                        val draftIsBlank = drafts[predictionSessionId].orEmpty().isBlank()
                                                        if (container.preferences.inputPredictionEnabled.value && draftIsBlank) {
                                                            inputPredictionsBySession[predictionSessionId] = suggestions
                                                        }
                                                        updateVisibleSession(predictionSessionId) {
                                                            it.copy(inputPredictions = if (draftIsBlank) suggestions else emptyList())
                                                        }
                                                    } finally {
                                                        inputPredictionLoadingSessions.remove(predictionSessionId)
                                                        if (inputPredictionJobs[predictionSessionId] === currentCoroutineContext()[Job]) {
                                                            inputPredictionJobs.remove(predictionSessionId)
                                                        }
                                                        updateVisibleSession(predictionSessionId) {
                                                            it.copy(inputPredictionLoading = false)
                                                        }
                                                    }
                                                }
                                                inputPredictionJobs[predictionSessionId] = predictionJob
                                                predictionJob.start()
                                            }
                                        }
                                    }
                                    is ChatStreamEvent.Error -> {
                                        flushPendingPersist()
                                        pendingQuestion = null
                                        val ui = ErrorMapper.from(event.exception)
                                        container.sessionStore.upsertMessage(
                                            assistantMsg.copy(
                                                content = assembled,
                                                status = MessageStatus.Error,
                                                images = assistantImages,
                                                errorMessage = ui.message,
                                                toolEvents = toolEvents,
                                                usage = usage,
                                                contextPercent = contextPercent,
                                            ),
                                        )
                                        setSessionError(sid, event.exception)
                                    }
                                }
                            }
                        if (session.origin == ConversationOrigin.Desktop) {
                            val remoteId = session.remoteSessionId
                                ?: container.conversationRouter.resolvedRemoteSessionId(session.id)
                            if (remoteId != null) {
                                val syncedTitle = session.remoteDeviceId?.let { deviceId ->
                                    runCatching {
                                        container.remoteConversationGateway.listDesktopSessions(deviceId)
                                            ?.firstOrNull { it.id == remoteId }?.title
                                    }.getOrNull()
                                }
                                val latestSession = container.sessionStore.getSession(sid) ?: session
                                container.sessionStore.updateSession(
                                    latestSession.copy(
                                        remoteSessionId = remoteId,
                                        title = syncedTitle?.takeIf { it.isNotBlank() }
                                            ?.takeUnless { latestSession.titleManuallyEdited }
                                            ?: latestSession.title,
                                    ),
                                )
                            }
                        }
                        if (session.origin == ConversationOrigin.Cloud && isFirstUserMessage && titlePrompt.isNotBlank() && titleModelId != null) {
                            viewModelScope.launch {
                                generatePhoneSessionTitle(sid, titlePrompt, titleModelId, titleGroupName)
                            }
                        }
                        // 正常结束后若仍 streaming 则 complete
                        val latest =
                            container.sessionStore.getMessages(sid).firstOrNull { it.id == assistantId }
                        if (latest?.status == MessageStatus.Streaming) {
                            container.sessionStore.upsertMessage(
                                latest.copy(status = MessageStatus.Complete, pendingQuestion = null),
                            )
                        }
                    } catch (t: Throwable) {
                        pendingPersist?.cancelAndJoin()
                        pendingPersist = null
                        val ui = ErrorMapper.from(t)
                        val latest =
                            container.sessionStore.getMessages(sid).firstOrNull { it.id == assistantId }
                        if (latest != null) {
                            container.sessionStore.upsertMessage(
                                assistantMsg.copy(
                                    content = assembled,
                                    images = assistantImages,
                                    status =
                                        if (t is kotlinx.coroutines.CancellationException) {
                                            MessageStatus.Aborted
                                        } else {
                                            MessageStatus.Error
                                        },
                                    errorMessage = if (t is kotlinx.coroutines.CancellationException) null else ui.message,
                                    toolEvents = toolEvents,
                                    usage = usage,
                                    contextPercent = contextPercent,
                                    pendingQuestion = null,
                                ),
                            )
                        }
                        if (t !is kotlinx.coroutines.CancellationException) {
                            setSessionError(sid, t)
                        }
                    } finally {
                        pendingPersist?.cancel()
                        if (streamJobs[sid] === currentCoroutineContext()[Job]) streamJobs.remove(sid)
                        streamStatuses.remove(sid)
                        updateVisibleSession(sid) { it.copy(isStreaming = false, streamingStatus = null) }
                    }
                }
            streamJobs[sid] = streamJob
            pendingSendReservations.remove(sendReservation)
            streamJob.start()
        }.invokeOnCompletion { pendingSendReservations.remove(sendReservation) }
    }

    fun toggleQuestionOption(question: String, label: String) {
        val pending = _state.value.pendingQuestion ?: return
        val item = pending.questions.firstOrNull { it.question == question } ?: return
        val current = pending.selections[question].orEmpty()
        val next = if (label in current) current - label else if (item.multiSelect) current + label else listOf(label)
        val updated = pending.copy(selections = pending.selections + (question to next))
        _state.update { it.copy(pendingQuestion = updated) }
        viewModelScope.launch {
            val message = container.sessionStore.getMessages(pending.sessionId).lastOrNull { it.pendingQuestion?.requestId == pending.requestId }
            if (message != null) container.sessionStore.upsertMessage(message.copy(pendingQuestion = updated))
        }
    }

    private fun mergeToolTrace(existing: List<ToolTrace>, next: ToolTrace): List<ToolTrace> {
        val bounded = next.copy(
            detail = next.detail?.boundedForStorage(),
            arguments = next.arguments?.boundedForStorage(),
            result = next.result?.boundedForStorage(),
            phaseLabel = next.phaseLabel?.boundedForStorage(256),
        )
        val index = existing.indexOfFirst { it.toolCallId == bounded.toolCallId }
        if (index < 0) return (existing + bounded).takeLast(MAX_TOOL_TRACE_EVENTS)
        return existing.toMutableList().also {
            val previous = it[index]
            it[index] =
                bounded.copy(
                    detail = bounded.detail ?: previous.detail,
                    durationMs = bounded.durationMs ?: previous.durationMs,
                    arguments = bounded.arguments ?: previous.arguments,
                    result = bounded.result ?: previous.result,
                    phaseLabel = bounded.phaseLabel ?: previous.phaseLabel,
                )
        }
    }

    private suspend fun buildChatHistory(messages: List<LocalMessage>): List<ChatMessage> {
        val selectedImageData = mutableMapOf<String, String>()
        var totalImageBytes = 0
        val candidates = messages.flatMap { message -> message.images.map { message.id to it } }.asReversed()
        for ((messageId, image) in candidates) {
            if (selectedImageData.size >= 3 || totalImageBytes >= MAX_REQUEST_IMAGE_CONTEXT_BYTES) break
            val bytes = container.sessionStore.readMessageImageBytes(image) ?: continue
            if (bytes.isEmpty() || bytes.size > MAX_REQUEST_IMAGE_CONTEXT_BYTES - totalImageBytes) continue
            selectedImageData["$messageId:${image.storageKey ?: image.id}"] = encodeImageBytes(bytes)
            totalImageBytes += bytes.size
        }
        return messages.map { message ->
            val resolvedImages = message.images.mapNotNull { image ->
                val encoded = selectedImageData["${message.id}:${image.storageKey ?: image.id}"] ?: return@mapNotNull null
                image.copy(base64Data = encoded, pendingBytes = null)
            }
            message.copy(images = resolvedImages).toChatMessage()
        }
    }

    private suspend fun loadImageBase64WithinBudget(images: List<MessageImage>): List<String> {
        val loaded = mutableListOf<Pair<Int, String>>()
        var totalBytes = 0
        for (index in images.indices.reversed()) {
            if (loaded.size >= 3 || totalBytes >= MAX_REQUEST_IMAGE_CONTEXT_BYTES) break
            val bytes = container.sessionStore.readMessageImageBytes(images[index]) ?: continue
            if (bytes.isEmpty() || bytes.size > MAX_REQUEST_IMAGE_CONTEXT_BYTES - totalBytes) continue
            loaded += index to encodeImageBytes(bytes)
            totalBytes += bytes.size
        }
        return loaded.sortedBy { it.first }.map { it.second }
    }

    @OptIn(ExperimentalEncodingApi::class)
    private fun encodeImageBytes(bytes: ByteArray): String = Base64.encode(bytes)

    private fun String.boundedForStorage(limit: Int = MAX_TOOL_TRACE_FIELD_CHARS): String =
        if (length <= limit) this else take(limit) + "\n[内容过长，已截断]"

    private fun fetchDesktopGeneratedImages(
        localSessionId: String,
        assistantMessageId: String,
        remoteSessionId: String?,
        images: List<org.agent567.android.core.model.RemoteGeneratedImageRef>,
    ) {
        val targetRemoteId = remoteSessionId ?: return
        images.take(4).forEach { ref ->
            val fetchKey = "$localSessionId:$assistantMessageId:${ref.id}"
            if (!remoteImageFetches.add(fetchKey)) return@forEach
            viewModelScope.launch {
                try {
                    val encoded = StringBuilder()
                    var offset = 0
                    var expectedSize = -1
                    var mimeType = ref.mimeType
                    var transferFailed = false
                    while (offset < REMOTE_GENERATED_IMAGE_MAX_BYTES) {
                        val chunk = container.remoteConversationGateway.readDesktopGeneratedImageChunk(
                            localSessionId = localSessionId,
                            remoteSessionId = targetRemoteId,
                            imageId = ref.id,
                            offset = offset,
                            length = REMOTE_GENERATED_IMAGE_CHUNK_BYTES,
                        )
                        if (chunk == null) {
                            transferFailed = true
                            break
                        }
                        if (expectedSize < 0) expectedSize = chunk.sizeBytes
                        if (chunk.sizeBytes != expectedSize || chunk.sizeBytes > REMOTE_GENERATED_IMAGE_MAX_BYTES) {
                            transferFailed = true
                            break
                        }
                        mimeType = chunk.mimeType
                        encoded.append(chunk.dataBase64)
                        @OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)
                        val bytesRead = kotlin.io.encoding.Base64.decode(chunk.dataBase64).size
                        if (bytesRead <= 0) {
                            transferFailed = true
                            break
                        }
                        offset += bytesRead
                        if (offset >= expectedSize) break
                    }
                    if (transferFailed || expectedSize <= 0 || offset != expectedSize) {
                        updateVisibleDesktopSession(localSessionId) {
                            it.copy(chatError = UiError(
                                title = "图片暂时无法加载",
                                message = "电脑端图片传输未完成，请确认设备在线后重新打开会话。",
                                action = UiErrorAction.None,
                            ))
                        }
                        return@launch
                    }
                    val image = org.agent567.android.domain.session.MessageImage(
                        id = "gen-remote-${ref.id}",
                        mimeType = mimeType,
                        fileName = "generated-${ref.id.take(8)}.${imageExtension(mimeType)}",
                        base64Data = encoded.toString(),
                    )
                    val message = container.sessionStore.getMessages(localSessionId)
                        .firstOrNull { it.id == assistantMessageId } ?: return@launch
                    if (message.images.none { it.id == image.id }) {
                        container.sessionStore.upsertMessage(message.copy(images = message.images + image))
                    }
                } catch (error: Throwable) {
                    if (error is CancellationException) throw error
                    updateVisibleDesktopSession(localSessionId) {
                        it.copy(chatError = UiError(
                            title = "图片暂时无法加载",
                            message = "请确认电脑仍在线后重新打开会话。",
                            action = UiErrorAction.None,
                        ))
                    }
                } finally {
                    remoteImageFetches.remove(fetchKey)
                }
            }
        }
    }

    private fun imageExtension(mimeType: String): String = when (mimeType.lowercase()) {
        "image/jpeg", "image/jpg" -> "jpg"
        "image/webp" -> "webp"
        "image/gif" -> "gif"
        else -> "png"
    }

    fun submitQuestion() {
        val pending = _state.value.pendingQuestion ?: return
        if (_state.value.isQuestionSubmitting) return
        val sessionId = pending.sessionId.ifBlank { _state.value.currentSessionId ?: return }
        _state.update { it.copy(isQuestionSubmitting = true) }
        viewModelScope.launch {
            try {
                val session = container.sessionStore.getSession(sessionId) ?: return@launch
                runCatching {
                    container.remoteConversationGateway.respond(
                        localSessionId = session.id,
                        deviceId = session.remoteDeviceId.orEmpty(),
                        remoteSessionId = session.remoteSessionId,
                        requestId = pending.requestId,
                        answers = pending.selections.map { it.key to it.value },
                    )
                }.onSuccess {
                    val message = container.sessionStore.getMessages(session.id).lastOrNull { it.pendingQuestion?.requestId == pending.requestId }
                    if (message != null) container.sessionStore.upsertMessage(message.copy(pendingQuestion = null))
                    _state.update { state -> state.copy(pendingQuestion = state.pendingQuestion?.takeIf { it.requestId != pending.requestId }) }
                }
                    .onFailure { error -> setSessionError(session.id, error, desktopOnly = true) }
            } finally {
                _state.update { it.copy(isQuestionSubmitting = false) }
            }
        }
    }

    fun stopStreaming() {
        val sid = _state.value.currentSessionId ?: return
        cancelStream(sid)
        viewModelScope.launch {
            container.sessionStore.getSession(sid)?.let { session ->
                runCatching { container.conversationRouter.abort(session) }
            }
            val streaming =
                container.sessionStore.getMessages(sid).lastOrNull {
                    it.role == ChatRole.Assistant && it.status == MessageStatus.Streaming
                }
            if (streaming != null) {
                container.sessionStore.upsertMessage(streaming.copy(status = MessageStatus.Aborted, pendingQuestion = null))
            }
            updateVisibleSession(sid) { state ->
                state.copy(
                    pendingQuestion = state.pendingQuestion?.takeIf { it.sessionId != sid },
                )
            }
        }
    }

    fun retryLastError(assistantMessageId: String? = null) {
        val sid = _state.value.currentSessionId ?: return
        if (streamJobs[sid]?.isActive == true || sid in pendingSendReservations || !retryPreparingSessions.add(sid)) return
        viewModelScope.launch {
            try {
                if (streamJobs[sid]?.isActive == true) return@launch
                val messages = container.sessionStore.getMessages(sid)
                val turn = prepareRetryTurn(messages, assistantMessageId) ?: return@launch
                val retryImages = turn.images.map { image ->
                    if (image.storageKey == null || image.pendingBytes != null || image.base64Data.isNotBlank()) {
                        image
                    } else {
                        val bytes = container.sessionStore.readMessageImageBytes(image)
                        if (bytes == null) {
                            updateVisibleSession(sid) {
                                it.copy(chatError = UiError(
                                    title = "无法重试这条消息",
                                    message = "原消息的图片文件已缺失。为避免丢失原记录，请先检查聊天记录后再重试。",
                                ))
                            }
                            return@launch
                        }
                        image.copy(storageKey = null, pendingBytes = bytes)
                    }
                }
                container.sessionStore.replaceMessages(sid, turn.remainingMessages)
                drafts[sid] = turn.draft
                // 必须同时恢复图片；否则纯图重试会变成 no-op，图文重试会丢图
                _state.update {
                    it.copy(
                        draft = turn.draft,
                        pendingImages = retryImages,
                        chatError = null,
                    )
                }
                retryPreparingSessions.remove(sid)
                sendMessage(retryPreviousTurn = true)
            } finally {
                retryPreparingSessions.remove(sid)
            }
        }
    }

    fun handleErrorAction(action: UiErrorAction) {
        when (action) {
            UiErrorAction.Retry -> {
                clearChatError()
                if (_state.value.route is AppRoute.Chat) retryLastError() else refreshCatalog()
            }
            UiErrorAction.OpenPlan -> {
                clearChatError()
                openPlan()
            }
            UiErrorAction.ReLogin -> {
                clearChatError()
                viewModelScope.launch { forceLogout(keepLocalSessions = true) }
            }
            UiErrorAction.OpenSettings -> {
                clearChatError()
                openSettings()
            }
            UiErrorAction.None -> clearChatError()
        }
    }

    val sessions =
        container.sessionStore.sessions
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    private fun attachSession(
        sessionId: String,
        clearPendingImages: Boolean = true,
    ) {
        messagesCollectJob?.cancel()
        container.preferences.lastSessionId = sessionId
        val draft = drafts[sessionId].orEmpty()
        _state.update {
            it.copy(
                currentSessionId = sessionId,
                chatError = null,
                draft = draft,
                isStreaming = streamJobs[sessionId]?.isActive == true,
                streamingStatus = streamStatuses[sessionId],
                inputPredictions = if (draft.isBlank()) inputPredictionsBySession[sessionId].orEmpty() else emptyList(),
                inputPredictionLoading = sessionId in inputPredictionLoadingSessions && draft.isBlank(),
                pendingQuestion = null,
                pendingImages = if (clearPendingImages) emptyList() else it.pendingImages,
            )
        }
        messagesCollectJob =
            viewModelScope.launch {
                container.sessionStore.observeMessages(sessionId).collect { list ->
                    val persistedPending = list.asReversed().firstNotNullOfOrNull { message ->
                        message.pendingQuestion?.takeIf { it.sessionId == sessionId }
                    }
                    _state.update { state ->
                        state.copy(
                            messages = list,
                            pendingQuestion = persistedPending ?: state.pendingQuestion?.takeIf { it.sessionId != sessionId },
                        )
                    }
                }
            }
    }

    private fun detachSessionMessages() {
        messagesCollectJob?.cancel()
        messagesCollectJob = null
    }

    private fun updateVisibleSession(sessionId: String, transform: (AppUiState) -> AppUiState) {
        _state.update { state -> if (state.currentSessionId == sessionId) transform(state) else state }
    }

    private suspend fun setSessionError(sessionId: String, error: Throwable, desktopOnly: Boolean = false) {
        val session = container.sessionStore.getSession(sessionId) ?: return
        if (desktopOnly && session.origin != ConversationOrigin.Desktop) return
        if (error is RemoteConversationException && session.origin != ConversationOrigin.Desktop) return
        val uiError = ErrorMapper.from(error)
        updateVisibleSession(sessionId) { it.copy(chatError = uiError) }
    }

    private suspend fun updateVisibleDesktopSession(sessionId: String, transform: (AppUiState) -> AppUiState) {
        val session = container.sessionStore.getSession(sessionId) ?: return
        if (session.origin != ConversationOrigin.Desktop) return
        updateVisibleSession(sessionId, transform)
    }

    private fun setStreamStatus(sessionId: String, status: String?) {
        if (status == null) streamStatuses.remove(sessionId) else streamStatuses[sessionId] = status
        updateVisibleSession(sessionId) { it.copy(streamingStatus = status) }
    }

    private fun cancelStream(sessionId: String) {
        streamJobs.remove(sessionId)?.cancel()
        streamStatuses.remove(sessionId)
        updateVisibleSession(sessionId) { it.copy(isStreaming = false, streamingStatus = null) }
    }

    private fun cancelAllStreams() {
        val jobs = streamJobs.values.toList()
        streamJobs.clear()
        streamStatuses.clear()
        jobs.forEach(Job::cancel)
        _state.update { it.copy(isStreaming = false, streamingStatus = null) }
    }

    private fun currentModel(): LlmModel? {
        val id = _state.value.selectedModelId
        return _state.value.models.firstOrNull { it.id == id } ?: _state.value.models.firstOrNull()
    }

    private fun showNoModelError() {
        _state.update {
            it.copy(
                chatError =
                    UiError(
                        title = Str.noModels,
                        message = Str.noModelsHint,
                        action = UiErrorAction.OpenPlan,
                    ),
            )
        }
    }

    private fun resolveModelId(preferred: String?, models: List<LlmModel>): String? {
        if (models.isEmpty()) return null
        if (preferred != null && models.any { it.id == preferred }) return preferred

        val sorted = models.sortedWith(compareByDescending<LlmModel> { model ->
            val id = model.id.lowercase()
            when {
                id == "gemini-3.8-flash-high" -> 120
                id.contains("3.8") -> 100
                id.contains("3.7") -> 95
                id.contains("3.5") -> 90
                id.contains("3-") || id.contains("3.") -> 85
                id.contains("2.5") -> 80
                id.contains("2.0") || id.contains("2-") -> 75
                id.contains("4o") -> 70
                id.contains("r1") || id.contains("reasoner") -> 65
                id.contains("deepseek") -> 60
                else -> 10
            }
        })
        return sorted.first().id
    }

    private fun newMessageId(): String =
        "${nowEpochMs().toString(16)}-${Random.nextInt(0, Int.MAX_VALUE).toString(16)}"
}

private fun pickDefaultGroup(available: Map<String, org.agent567.android.core.api.ApiGroupInfoDto>): String? {
    val priorityGroups = listOf(
        "反重力Gemini",
        "画图",
        "chat GPT 特价",
        "chat GPT 满血",
        "deepseek官",
        "Google Gemini",
        "chat GPT pro",
        "xAI grok",
        "国模特价组1",
        "福利特价",
    )
    for (p in priorityGroups) {
        if (available.containsKey(p)) return p
    }
    return available.keys.firstOrNull { !it.contains("kiro", ignoreCase = true) } ?: available.keys.firstOrNull()
}

private fun pickDefaultImageGroup(available: Map<String, org.agent567.android.core.api.ApiGroupInfoDto>): String? {
    val priorityGroups = listOf("画图", "画图模型", "chat GPT 备用2")
    for (p in priorityGroups) {
        if (available.containsKey(p)) return p
    }
    return available.keys.firstOrNull {
        it.contains("画图") || it.contains("绘图") || it.contains("生图") || it.contains("image", ignoreCase = true)
    }
}
