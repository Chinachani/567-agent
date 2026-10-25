package org.agent567.android.ui

import org.agent567.android.AppVersion

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
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
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
import org.agent567.android.core.net.NetworkAvailability
import org.agent567.android.core.net.ChatNetworkLostException
import org.agent567.android.core.net.isChatNetworkLoss
import org.agent567.android.core.net.RefreshOutcome
import kotlinx.coroutines.withTimeout
import org.agent567.android.domain.chat.MobileContextException
import org.agent567.android.domain.remote.connection.RemoteRequestException
import kotlinx.coroutines.TimeoutCancellationException
import org.agent567.android.domain.chat.MobileContextManager
import org.agent567.android.domain.session.ChatContextSnapshot
import org.agent567.android.domain.chat.prepareRetryTurn
import org.agent567.android.domain.chat.shouldClearPendingImagesOnSessionChange
import org.agent567.android.domain.conversation.RemoteSessionModelCatalog
import org.agent567.android.domain.conversation.RemotePromptFileAttachment
import org.agent567.android.domain.conversation.RemoteDesktopSessionSummary
import org.agent567.android.domain.conversation.RemoteToolboxAbility
import org.agent567.android.domain.conversation.RemoteConversationException
import org.agent567.android.domain.error.ErrorMapper
import org.agent567.android.domain.error.UiError
import org.agent567.android.domain.error.UiErrorAction
import org.agent567.android.domain.remote.createSecureRemoteResumeSecret
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
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
import org.agent567.android.domain.session.PendingFileAttachment
import org.agent567.android.domain.session.MessageFileAttachment
import org.agent567.android.ui.media.MAX_MESSAGE_IMAGE_TOTAL_BYTES
import org.agent567.android.ui.media.MAX_MESSAGE_FILE_COUNT
import org.agent567.android.ui.media.MAX_MESSAGE_FILE_TOTAL_BYTES
import org.agent567.android.ui.media.MAX_PICKED_IMAGE_COUNT
import org.agent567.android.ui.media.byteSize
import org.agent567.android.ui.media.pickedByteSize
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
    val autoRequestDesktopScreen: Boolean = false,
    val showBottomNavLabels: Boolean = true,
    val confirmBeforeDelete: Boolean = true,
    val migrationBackupLimitMb: Int = 50,
    val downloadSource: String = org.agent567.android.app.AppPreferences.DOWNLOAD_SOURCE_GITHUB,
    val customDownloadPrefix: String = "",
    val serverUrl: String = "",
	val serviceRoutePickerOpen: Boolean = false,
	val serviceRoutePending: org.agent567.android.core.ServiceRoute? = null,
	val serviceRouteResults: Map<org.agent567.android.core.ServiceRoute, org.agent567.android.core.ServiceRouteResult> = emptyMap(),
	val serviceRouteChanged: Boolean = false,
	val serviceRouteCatalog: org.agent567.android.core.ServiceRouteCatalog = org.agent567.android.core.ServiceRouteCatalog(),
	val serviceRouteCatalogRefreshing: Boolean = false,
    val user: User? = null,
    val subscription: SubscriptionStatus? = null,
    val subscriptionLoadFailed: Boolean = false,
    val models: List<LlmModel> = emptyList(),
    val selectedModelId: String? = null,
    val desktopModels: List<LlmModel> = emptyList(),
    val desktopSelectedModelId: String? = null,
    val desktopServiceRoute: String? = null,
    val desktopServiceRouteSessionId: String? = null,
    val currentSessionId: String? = null,
    val messages: List<LocalMessage> = emptyList(),
    val draft: String = "",
    val pendingImages: List<MessageImage> = emptyList(),
    val pendingFiles: List<PendingFileAttachment> = emptyList(),
    val isStreaming: Boolean = false,
    /** 面向用户的短状态，不透传 Desktop 内部思考文本或异常原文。 */
    val streamingStatus: String? = null,
    val inputPredictions: List<String> = emptyList(),
    val inputPredictionLoading: Boolean = false,
    val contextPanelOpen: Boolean = false,
    val contextSnapshot: ChatContextSnapshot? = null,
    val workbenchSnapshot: org.agent567.android.domain.session.SessionWorkbenchSnapshot? = null,
    val workbenchDetail: org.agent567.android.domain.session.SessionWorkbenchDetail? = null,
    val workbenchLoading: Boolean = false,
    val workbenchOpen: Boolean = false,
    val workbenchError: String? = null,
    val projectCollaborationSnapshot: org.agent567.android.domain.session.ProjectCollaborationSnapshot? = null,
    val projectCollaborationLoading: Boolean = false,
    val projectCollaborationError: String? = null,
    val contextLoading: Boolean = false,
    val contextBusy: Boolean = false,
    val contextError: String? = null,
    val contextNotice: String? = null,
    val modelPickerOpen: Boolean = false,
    val available567Groups: Map<String, org.agent567.android.core.api.ApiGroupInfoDto> = emptyMap(),
    val active567Group: String? = null,
    val groupPickerOpen: Boolean = false,
    val activeImageGroup: String? = null,
    val activeImageModel: String? = null,
    val imageGenEnabled: Boolean = true,
    val imagePickerOpen: Boolean = false,
    val availableImageModels: List<String> = emptyList(),
    val imageModelsLoading: Boolean = false,
    val imageGroupExpanded: Boolean = false,
    val remoteConnecting: Boolean = false,
    val desktopSessionsLoading: Boolean = false,
    val desktopSessionsError: String? = null,
    val desktopSessionsWarning: String? = null,
    /** 配对与设备管理错误，只在连接相关页面展示。 */
    val remoteError: UiError? = null,
    val sessionDeletionError: UiError? = null,
    /** 当前聊天的错误提示；切换会话时清空，后台任务不得写入。 */
    val chatError: UiError? = null,
    val authError: UiError? = null,
    val authLoading: Boolean = false,
    val loggingOut: Boolean = false,
    val loginModeEmail: Boolean = false,
    val catalogLoading: Boolean = false,
    val accountVerifying: Boolean = false,
    val accountVerificationMessage: String? = null,
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
    val toolboxAbilities: List<RemoteToolboxAbility> = emptyList(),
    val toolboxLoading: Boolean = false,
    val toolboxError: String? = null,
    val toolboxQuery: String = "",
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
private const val MAX_REQUEST_IMAGE_COUNT = 6
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
                serviceRouteCatalog = container.preferences.serviceRouteCatalog(),
                autoResumeLastSession = container.preferences.autoResumeLastSession.value,
                motionEnabled = container.preferences.motionEnabled.value,
                inputPredictionEnabled = container.preferences.inputPredictionEnabled.value,
                autoRequestDesktopScreen = container.preferences.autoRequestDesktopScreen.value,
                showBottomNavLabels = container.preferences.showBottomNavLabels.value,
                confirmBeforeDelete = container.preferences.confirmBeforeDelete.value,
                migrationBackupLimitMb = container.preferences.migrationBackupLimitMb.value,
                downloadSource = container.preferences.downloadSource,
                customDownloadPrefix = container.preferences.customPrefix,
            ),
        )
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    private val authPersistence = Mutex()
    private var authRevision = 0L
    private var authJob: Job? = null
    private var workspaceJob: Job? = null
    private var serviceRouteJob: Job? = null
    private var serviceRouteRevision = 0L
    private var serviceRouteCatalogJob: Job? = null
    private var serviceRouteCatalogRevision = 0L

    fun setServiceRoutePickerOpen(open: Boolean) {
        if (!open) { serviceRouteRevision++; serviceRouteJob?.cancel(); serviceRouteJob = null; serviceRouteCatalogRevision++; serviceRouteCatalogJob?.cancel(); serviceRouteCatalogJob = null }
        _state.update { it.copy(serviceRoutePickerOpen = open, serviceRoutePending = null, serviceRouteChanged = false, serviceRouteCatalog = container.preferences.serviceRouteCatalog(), serviceRouteCatalogRefreshing = false) }
        if (open) refreshServiceRouteCatalog()
    }

    fun refreshServiceRouteCatalog(force: Boolean = false) {
        if (serviceRouteCatalogJob?.isActive == true) return
        val revision = ++serviceRouteCatalogRevision
        _state.update { it.copy(serviceRouteCatalogRefreshing = true) }
        serviceRouteCatalogJob = viewModelScope.launch {
            try {
                val catalog = container.refreshServiceRoutes(force)
                if (revision == serviceRouteCatalogRevision) _state.update { it.copy(serviceRouteCatalog = catalog) }
            } finally {
                if (revision == serviceRouteCatalogRevision) _state.update { it.copy(serviceRouteCatalogRefreshing = false) }
            }
        }
    }

    fun checkServiceRoute(route: org.agent567.android.core.ServiceRoute, select: Boolean) {
        if (serviceRouteJob?.isActive == true) return
        val revision = ++serviceRouteRevision
        _state.update { it.copy(serviceRoutePending = route, serviceRouteChanged = false) }
        serviceRouteJob = viewModelScope.launch {
            try {
                val result = if (select) container.selectServiceRoute(route) else container.probeServiceRoute(route)
                if (revision != serviceRouteRevision) return@launch
                _state.update { it.copy(serverUrl = container.preferences.serverUrl.value, serviceRouteResults = it.serviceRouteResults + (route to result), serviceRouteChanged = select && result.ok) }
                if (select && result.ok && container.tokenStore.accessToken != null) refreshCatalog()
            } finally {
                if (revision == serviceRouteRevision) _state.update { it.copy(serviceRoutePending = null) }
            }
        }
    }

    private val contextOperations = mutableMapOf<String, Job>()
    private var workbenchReadJob: Job? = null
    private var projectCollaborationJob: Job? = null
    private var contextReadJob: Job? = null
    private val mobileContext = MobileContextManager(container.sessionStore) { modelId, messages, group ->
        try {
            withTimeout(180_000) {
                val result = StringBuilder()
                val requestClient = kotlin.coroutines.coroutineContext[org.agent567.android.app.RequestClientContext]?.client ?: container.client
                requestClient.chat.stream(modelId, messages, groupName = group, imageGenModel = null).collect { event ->
                    when (event) {
                        is ChatStreamEvent.Delta -> {
                            result.append(event.text)
                            if (result.length > 12_000) throw MobileContextException("摘要过长，原上下文已保留")
                        }
                        is ChatStreamEvent.Error -> throw event.exception
                        is ChatStreamEvent.Finished -> if (event.finishReason == "length") throw MobileContextException("摘要被截断，原上下文已保留")
                        else -> Unit
                    }
                }
                result.toString()
            }
        } catch (error: TimeoutCancellationException) {
            throw MobileContextException("摘要生成超时，原上下文已保留，请重试")
        }
    }

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
    private val composerDrafts = mutableMapOf<String, org.agent567.android.domain.session.SessionDraft>()
    private val draftPersistence = Mutex()
    private var draftReadJob: Job? = null

    private fun composerOwner(): String? = container.preferences.authUserId.takeIf { it > 0 }?.toString()
        ?: if (container.tokenStore.accessToken == null) container.preferences.remotePairingId?.let { "paired:$it" } ?: "local" else null

    private fun persistCurrentDraft() {
        val state = _state.value
        val sid = state.currentSessionId ?: return
        saveComposerDraft(sid, org.agent567.android.domain.session.SessionDraft(state.draft, state.pendingImages, state.pendingFiles))
    }

    private fun saveComposerDraft(sid: String, draft: org.agent567.android.domain.session.SessionDraft): Job? {
        composerDrafts[sid] = draft
        drafts[sid] = draft.text
        val owner = composerOwner() ?: run {
            _state.update { it.copy(chatError = UiError(Str.draftAccountPending, Str.draftAccountPendingHint, UiErrorAction.None)) }
            return null
        }
        return viewModelScope.launch {
            try {
                draftPersistence.withLock { container.sessionStore.saveDraft(sid, owner, draft) }
                if (_state.value.currentSessionId == sid && _state.value.chatError?.title == Str.draftAccountPending) _state.update { it.copy(chatError = null) }
                if (_state.value.currentSessionId != sid && composerDrafts[sid] === draft) composerDrafts.remove(sid)
            } catch (error: CancellationException) { throw error }
            catch (_: Throwable) {
                if (_state.value.currentSessionId == sid) _state.update { it.copy(chatError = UiError(Str.draftSaveFailed, Str.draftSaveFailedHint, UiErrorAction.None)) }
            }
        }
    }
    private var pendingLoginAction: PendingLoginAction? = null
    private var pendingNewChatDraft = ""

    init {
        viewModelScope.launch {
            _state.map { it.user?.id }.distinctUntilChanged().collect { id ->
                if (id != null && id > 0) {
                    val sid = _state.value.currentSessionId
                    if (sid != null) {
                        if (composerDrafts.containsKey(sid)) persistCurrentDraft()
                        else attachSession(sid, clearPendingImages = false)
                    }
                }
            }
        }
        viewModelScope.launch {
            container.networkAvailability.collect { availability ->
                if (availability == NetworkAvailability.Unavailable) {
                    val phoneSessions = container.sessionStore.sessions.value
                        .filter { it.origin == ConversationOrigin.Cloud }.map { it.id }.toSet()
                    streamJobs.filterKeys { it in phoneSessions }.values.toList()
                        .forEach { it.cancel(ChatNetworkLostException()) }
                    contextOperations.filterKeys { it in phoneSessions }.values.toList()
                        .forEach { it.cancel(ChatNetworkLostException()) }
                }
            }
        }
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
            container.preferences.autoRequestDesktopScreen.collect { enabled ->
                _state.update { it.copy(autoRequestDesktopScreen = enabled) }
            }
        }
        viewModelScope.launch {
            container.preferences.showBottomNavLabels.collect { enabled ->
                _state.update { it.copy(showBottomNavLabels = enabled) }
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
                    activeImageModel = savedImageModel ?: DEFAULT_IMAGE_MODEL,
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
        val route = lastSession?.let { session ->
            AppRoute.Chat(
                sessionId = session.id,
                surface = if (session.origin == ConversationOrigin.Desktop) ChatSurface.Desktop else ChatSurface.Cloud,
                title = session.title,
                deviceId = session.remoteDeviceId,
            )
        } ?: AppRoute.Main(MainTab.Home)

        _state.update {
            it.copy(
                bootstrapped = true,
                mainAccessGranted = true,
                route = route,
                currentSessionId = lastSession?.id,
                catalogLoading = true,
            )
        }
        if (lastSession != null) attachSession(lastSession.id)
        restorePendingQuestion()

        workspaceJob?.cancel()
        val client = container.client
        val revision = authRevision
        workspaceJob = viewModelScope.launch(org.agent567.android.app.RequestClientContext(client)) {
            refreshWorkspaceSnapshot(client, revision)
        }
    }

    private fun isCurrentAccount(client: org.agent567.android.core.Agent567Client, revision: Long): Boolean {
        return authRevision == revision && container.client === client && container.tokenStore.accessToken != null
    }

    private suspend fun refreshWorkspaceSnapshot(client: org.agent567.android.core.Agent567Client, revision: Long) {
        try {
            if (!isCurrentAccount(client, revision)) return
            _state.update { it.copy(accountVerifying = true, accountVerificationMessage = null) }
            val user = try {
                client.auth.me()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                if (isCurrentAccount(client, revision)) _state.update { it.copy(
                    accountVerifying = false,
                    accountVerificationMessage = if (error is org.agent567.android.core.error.Agent567Exception.Unauthorized)
                        "登录凭据暂时无法恢复，请在账号页重新验证登录" else Str.accountVerificationUnavailable,
                    catalogLoading = false,
                ) }
                return
            }
            if (!isCurrentAccount(client, revision)) return
            _state.update { it.copy(accountVerifying = false, accountVerificationMessage = null) }
            container.preferences.authUsername = user.nickname.ifBlank { user.username }
            container.preferences.authQuotaUsd = user.quotaUsd
            container.preferences.authUserId = user.id
            if (!isCurrentAccount(client, revision)) return
            _state.update { it.copy(user = user) }
            val sub = runCatching { client.subscription.me() }.getOrNull()
            val groups = runCatching { client.models.getAvailableGroups() }.getOrDefault(emptyMap())
            if (!isCurrentAccount(client, revision)) return
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
                    runCatching { client.models.listGoModels(currentGroup) }.getOrElse { emptyList() }
                } else {
                    runCatching { client.models.listGoModels(null) }.getOrElse { emptyList() }
                }
            if (!isCurrentAccount(client, revision)) return
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
        } catch (error: CancellationException) { throw error }
        catch (t: Throwable) {
            if (!isCurrentAccount(client, revision)) return
            _state.update {
                it.copy(
                    catalogLoading = false,
                )
            }
        }
    }

    fun openWelcome() {
        if (_state.value.loggingOut) return
        if (_state.value.route == AppRoute.Login) {
            pendingLoginAction = null
            pendingNewChatDraft = ""
        }
        navigate(AppRoute.Welcome)
    }

    fun openLogin() { if (!_state.value.loggingOut) navigate(AppRoute.Login) }

    fun skipWelcome() {
        if (_state.value.loggingOut) return
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


    private val updateController = org.agent567.android.ui.updates.AppUpdateController(container.preferences, { container.client.models.checkAppUpdate() })
    val appUpdates = updateController.state

    fun checkAppUpdateAutomatically() { viewModelScope.launch { updateController.check(automatic = true) } }
    fun dismissUpdateNotice() = updateController.dismiss()
    fun checkAppUpdate(onResult: (org.agent567.android.core.api.AppUpdateCheckResult) -> Unit) {
        viewModelScope.launch { updateController.check(automatic = false)?.let(onResult) }
    }

    fun openAbout() = navigate(AppRoute.About)
    fun openAccount() = navigate(AppRoute.Account)

    fun saveProfileName(name: String, onComplete: (String?) -> Unit) {
        val user = _state.value.user ?: return
        val revision = authRevision
        val client = container.client
        viewModelScope.launch(org.agent567.android.app.RequestClientContext(client)) {
            try {
                val updated = withContext(Dispatchers.IO) { client.auth.updateDisplayName(user, name) }
                if (!isCurrentAccount(client, revision) || _state.value.user?.id != user.id) {
                    onComplete("账号或线路已变化，请刷新个人资料")
                    return@launch
                }
                withContext(Dispatchers.IO) { authPersistence.withLock {
                    if (isCurrentAccount(client, revision)) container.preferences.authUsername = updated.nickname.ifBlank { updated.username }
                } }
                if (!isCurrentAccount(client, revision)) return@launch
                _state.update { it.copy(user = updated) }
                onComplete(null)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { onComplete(ErrorMapper.from(error).message) }
        }
    }

    fun changeProfilePassword(original: String, password: String, onComplete: (String?) -> Unit) =
        runProfileAction(onComplete, afterSuccess = {
            if (container.preferences.authLoginType == "account") container.preferences.authPassword = password
            container.preferences.authToken = container.tokenStore.accessToken
            container.preferences.authRefreshToken = container.tokenStore.refreshToken
        }) { client, user -> client.auth.updatePassword(user, original, password); null }

    fun sendProfileEmailCode(email: String, onComplete: (String?) -> Unit) =
        runProfileAction(onComplete) { client, user -> client.auth.sendBindingEmailCode(user, email); null }

    fun bindProfileEmail(email: String, code: String, onComplete: (String?) -> Unit) =
        runProfileAction(onComplete) { client, user -> client.auth.bindEmail(user, email, code) }

    private fun runProfileAction(
        onComplete: (String?) -> Unit,
        afterSuccess: () -> Unit = {},
        action: suspend (org.agent567.android.core.Agent567Client, User) -> User?,
    ) {
        val user = _state.value.user ?: return onComplete("请先登录")
        val client = container.client
        val revision = authRevision
        viewModelScope.launch(org.agent567.android.app.RequestClientContext(client)) {
            try {
                val updated = withContext(Dispatchers.IO) { action(client, user) }
                if (!isCurrentAccount(client, revision) || _state.value.user?.id != user.id) {
                    onComplete("账号或线路已变化，请重新打开个人资料")
                    return@launch
                }
                withContext(Dispatchers.IO) { authPersistence.withLock {
                    if (isCurrentAccount(client, revision)) afterSuccess()
                } }
                if (!isCurrentAccount(client, revision)) return@launch
                if (updated != null) _state.update { it.copy(user = updated) }
                onComplete(null)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { onComplete(ErrorMapper.from(error).message) }
        }
    }

    /** 登录后继续用户刚刚发起的高意图操作，避免登录成功后把用户丢回首页。 */
    fun openCloudConversation() {
        if (container.tokenStore.accessToken.isNullOrBlank()) {
            pendingLoginAction = PendingLoginAction.CloudConversation
            openLogin()
        } else {
            newChat(pendingNewChatDraft.also { pendingNewChatDraft = "" })
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

    fun setToolboxQuery(query: String) {
        _state.update { it.copy(toolboxQuery = query) }
    }

    fun refreshToolbox(deviceId: String? = null) {
        val devices = container.remoteConversationGateway.devices.value
        val device = devices.firstOrNull { it.id == deviceId && it.status == DeviceStatus.Online }
            ?: if (deviceId == null) devices.firstOrNull { it.status == DeviceStatus.Online } else null
        if (device == null) {
            _state.update { it.copy(toolboxAbilities = emptyList(), toolboxLoading = false, toolboxError = "请先连接一台电脑") }
            return
        }
        if (_state.value.toolboxLoading) return
        _state.update { it.copy(toolboxLoading = true, toolboxError = null) }
        viewModelScope.launch {
            try {
                val abilities = container.remoteConversationGateway.readDesktopToolbox(device.id)
                    ?: throw RemoteConversationException("电脑连接已断开，请重新连接后刷新")
                _state.update { it.copy(toolboxAbilities = abilities, toolboxLoading = false, toolboxError = null) }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                _state.update { it.copy(toolboxLoading = false, toolboxError = ErrorMapper.from(error).message) }
            }
        }
    }

    fun installToolboxAbility(ability: RemoteToolboxAbility) {
        if (!ability.installable || ability.installed || ability.type !in setOf("skill", "scene", "plugin")) return
        val targetDeviceId = (_state.value.route as? AppRoute.DeviceCapabilities)?.deviceId
        val devices = container.remoteConversationGateway.devices.value
        val device = devices.firstOrNull { it.id == targetDeviceId && it.status == DeviceStatus.Online }
            ?: (if (targetDeviceId == null) devices.firstOrNull { it.status == DeviceStatus.Online } else null)
            ?: run {
                _state.update { it.copy(toolboxError = "请先连接一台电脑") }
                return
            }
        viewModelScope.launch {
            _state.update { it.copy(toolboxLoading = true, toolboxError = null) }
            try {
                container.remoteConversationGateway.installDesktopToolboxAbility(device.id, ability.type, ability.slug)
                    ?: throw RemoteConversationException("电脑连接已断开，请重新连接后重试")
                val abilities = container.remoteConversationGateway.readDesktopToolbox(device.id).orEmpty()
                _state.update { it.copy(toolboxAbilities = abilities, toolboxLoading = false, toolboxError = null) }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                _state.update { it.copy(toolboxLoading = false, toolboxError = ErrorMapper.from(error).message) }
            }
        }
    }

    fun openDeviceDetail(deviceId: String) = navigate(AppRoute.DeviceDetail(deviceId))

    fun openDeviceCapabilities(deviceId: String) = navigate(AppRoute.DeviceCapabilities(deviceId))

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
                    val restoredRoute = _state.value.route as? AppRoute.Chat
                    if (restoredRoute?.surface == ChatSurface.Desktop && restoredRoute.sessionId != null) {
                        val session = container.sessionStore.getSession(restoredRoute.sessionId)
                        if (session?.remoteSessionId != null) {
                            loadDesktopSessionDetail(session.id, session.remoteSessionId)
                        }
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
                        desktopSessionsWarning = null,
                    )
                }
                return@launch
            }
            _state.update { it.copy(desktopSessionsLoading = true, desktopSessionsError = null, desktopSessionsWarning = null) }
            try {
                val catalog = container.remoteConversationGateway.readDesktopSessionCatalog(device.id)
                    ?: throw RemoteConversationException("电脑暂时无法读取会话列表，请确认设备在线")
                val summaries = catalog.sessions
                val summaryIds = summaries.mapTo(mutableSetOf()) { it.id }
                val emptyRemoteDrafts = container.sessionStore.sessions.value.filter { session ->
                    session.origin == ConversationOrigin.Desktop &&
                        session.remoteSessionCreatedOnMobile &&
                        session.remoteDeviceId == device.id &&
                        session.remoteSessionId != null &&
                        session.remoteSessionId in summaryIds &&
                        drafts[session.id].isNullOrBlank() &&
                        streamJobs[session.id]?.isActive != true &&
                        (_state.value.currentSessionId != session.id || (_state.value.pendingImages.isEmpty() && _state.value.pendingFiles.isEmpty())) &&
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
                        composerDrafts.remove(draft.id)
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
                    it.copy(
                        remoteDesktopSessions = visibleSummaries,
                        desktopSessionsLoading = false,
                        desktopSessionsError = null,
                        desktopSessionsWarning = if (catalog.failedDirectoryCount > 0) {
                            Str.desktopSessionPartialLoadWarning
                        } else null,
                    )
                }
            } catch (error: Throwable) {
                val stillOnline = container.remoteConversationGateway.devices.value.any {
                    it.id == device.id && it.status == org.agent567.android.domain.device.DeviceStatus.Online
                }
                _state.update {
                    it.copy(
                        desktopSessionsLoading = false,
                        desktopSessionsWarning = null,
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
        contextReadJob?.cancel()
        workbenchReadJob?.cancel()
        projectCollaborationJob?.cancel()
        _state.update {
            it.copy(
                contextPanelOpen = false,
                workbenchOpen = false,
                workbenchSnapshot = null,
                workbenchDetail = null,
                workbenchLoading = false,
                workbenchError = null,
                projectCollaborationSnapshot = null,
                projectCollaborationLoading = false,
                projectCollaborationError = null,
                contextSnapshot = null,
                contextLoading = false,
                contextError = null,
                contextNotice = null,
                contextBusy = sessionId in contextOperations,
            )
        }
        val previousSessionId = _state.value.currentSessionId
        if (previousSessionId != sessionId) persistCurrentDraft()
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
                    pendingFiles = if (clearPending) emptyList() else it.pendingFiles,
                )
            }
        }
    }

    fun setWorkbenchOpen(open: Boolean) {
        _state.update { it.copy(workbenchOpen = open, contextPanelOpen = false) }
        if (open) {
            refreshChatContext()
            loadSessionWorkbench()
            if ((_state.value.route as? AppRoute.Chat)?.surface == ChatSurface.Desktop) loadProjectCollaboration()
        } else {
            workbenchReadJob?.cancel()
            projectCollaborationJob?.cancel()
        }
    }

    fun loadSessionWorkbench() {
        val sid = _state.value.currentSessionId ?: return
        workbenchReadJob?.cancel()
        workbenchReadJob = viewModelScope.launch(start = CoroutineStart.LAZY) {
            updateVisibleSession(sid) { it.copy(workbenchLoading = true, workbenchError = null, workbenchDetail = null) }
            try {
                val session = container.sessionStore.getSession(sid) ?: return@launch
                val data = if (session.origin == ConversationOrigin.Desktop) {
                    requireDesktopContextDevice(session)
                    session.remoteSessionId?.let { container.remoteConversationGateway.readDesktopWorkbench(sid, it) } ?: throw RemoteConversationException(Str.contextDesktopUnsupported)
                } else org.agent567.android.domain.chat.localSessionWorkbench(container.sessionStore.getMessages(sid), streamJobs[sid]?.isCompleted == false)
                if (workbenchReadJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(workbenchSnapshot = data) }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (workbenchReadJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(workbenchError = contextOperationError(error)) }
            } finally { if (workbenchReadJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(workbenchLoading = false) } }
        }
        workbenchReadJob?.start()
    }

    fun loadProjectCollaboration() {
        val sid = _state.value.currentSessionId ?: return
        projectCollaborationJob?.cancel()
        projectCollaborationJob = viewModelScope.launch(start = CoroutineStart.LAZY) {
            updateVisibleSession(sid) { it.copy(projectCollaborationSnapshot = null, projectCollaborationLoading = true, projectCollaborationError = null) }
            try {
                val session = container.sessionStore.getSession(sid) ?: return@launch
                require(session.origin == ConversationOrigin.Desktop) { "协作只适用于电脑会话" }
                requireDesktopContextDevice(session)
                val remoteId = session.remoteSessionId ?: throw RemoteConversationException(Str.contextDesktopUnsupported)
                val snapshot = container.remoteConversationGateway.readDesktopProjectCollaboration(sid, remoteId)
                    ?: throw RemoteConversationException(Str.contextDesktopUnsupported)
                if (projectCollaborationJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(projectCollaborationSnapshot = snapshot) }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (projectCollaborationJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(projectCollaborationError = contextOperationError(error)) }
            } finally {
                if (projectCollaborationJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(projectCollaborationLoading = false) }
            }
        }
        projectCollaborationJob?.start()
    }

    fun controlProjectCollaboration(control: org.agent567.android.domain.session.ProjectCollaborationControl) {
        val sid = _state.value.currentSessionId ?: return
        projectCollaborationJob?.cancel()
        projectCollaborationJob = viewModelScope.launch(start = CoroutineStart.LAZY) {
            updateVisibleSession(sid) { it.copy(projectCollaborationLoading = true, projectCollaborationError = null) }
            try {
                val session = container.sessionStore.getSession(sid) ?: return@launch
                require(session.origin == ConversationOrigin.Desktop) { "协作只适用于电脑会话" }
                requireDesktopContextDevice(session)
                val remoteId = session.remoteSessionId ?: throw RemoteConversationException(Str.contextDesktopUnsupported)
                val snapshot = container.remoteConversationGateway.controlDesktopProjectCollaboration(sid, remoteId, control)
                    ?: throw RemoteConversationException(Str.contextDesktopUnsupported)
                if (projectCollaborationJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(projectCollaborationSnapshot = snapshot) }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (projectCollaborationJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(projectCollaborationError = contextOperationError(error)) }
            } finally {
                if (projectCollaborationJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(projectCollaborationLoading = false) }
            }
        }
        projectCollaborationJob?.start()
    }

    fun loadSessionWorkbenchDetail(kind: String, id: String) {
        val sid = _state.value.currentSessionId ?: return
        workbenchReadJob?.cancel()
        workbenchReadJob = viewModelScope.launch(start = CoroutineStart.LAZY) {
            updateVisibleSession(sid) { it.copy(workbenchLoading = true, workbenchError = null, workbenchDetail = null) }
            try {
                val session = container.sessionStore.getSession(sid) ?: return@launch
                val detail = if (session.origin == ConversationOrigin.Desktop) {
                    requireDesktopContextDevice(session)
                    session.remoteSessionId?.let { container.remoteConversationGateway.readDesktopWorkbenchDetail(sid, it, kind, id) } ?: throw RemoteConversationException(Str.contextDesktopUnsupported)
                } else org.agent567.android.domain.chat.localSessionWorkbenchDetail(container.sessionStore.getMessages(sid), kind, id)
                if (workbenchReadJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(workbenchDetail = detail) }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (workbenchReadJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(workbenchError = contextOperationError(error)) }
            } finally { if (workbenchReadJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(workbenchLoading = false) } }
        }
        workbenchReadJob?.start()
    }

    private val workbenchPreviewSlots = kotlinx.coroutines.sync.Semaphore(2)

    suspend fun readWorkbenchThumbnail(sid: String, id: String): String? {
        workbenchPreviewSlots.acquire()
        try {
            if (_state.value.currentSessionId != sid || !_state.value.workbenchOpen) return null
            val session = container.sessionStore.getSession(sid) ?: return null
            requireDesktopContextDevice(session)
            val remoteId = session.remoteSessionId ?: return null
            val detail = container.remoteConversationGateway.readDesktopWorkbenchDetail(sid, remoteId, "attachment", id)
            return org.agent567.android.domain.session.validatedWorkbenchThumbnail(detail?.thumbnailDataUrl)
        } finally { workbenchPreviewSlots.release() }
    }

    suspend fun readWorkbenchAttachment(sid: String, id: String): ByteArray {
        val session = container.sessionStore.getSession(sid) ?: error("会话已删除")
        requireDesktopContextDevice(session)
        val remoteId = session.remoteSessionId ?: error("电脑会话未建立")
        return org.agent567.android.domain.session.readWorkbenchAttachmentChunks { offset, limit ->
            requireDesktopContextDevice(session)
            container.remoteConversationGateway.readDesktopAttachmentChunk(sid, remoteId, id, offset, limit)
        }
    }

    fun setContextPanelOpen(open: Boolean) {
        _state.update { it.copy(contextPanelOpen = open, contextError = null, contextNotice = null) }
        if (open) refreshChatContext() else contextReadJob?.cancel()
    }

    fun refreshChatContext() = loadChatContext()

    private fun loadChatContext(preserveError: Boolean = false) {
        val stateAtRead = _state.value
        val sid = stateAtRead.currentSessionId
        val modelAtRead = currentModel()
        val manualAtRead = modelAtRead?.let { container.preferences.getModelContextOverride(stateAtRead.active567Group, it.id) }
        val automaticAtRead = modelAtRead?.let { container.client.models.resolveContext(it, stateAtRead.active567Group, useManual = false) }
        val reference = modelAtRead?.let { org.agent567.android.core.model.modelContextReference(it) }
        val modelDetails = ChatContextSnapshot(
            contextWindowSource = modelAtRead?.contextWindowSource ?: "unknown", manualContextWindow = manualAtRead,
            modelKey = modelAtRead?.let { kotlinx.serialization.json.JsonArray(listOf(kotlinx.serialization.json.JsonPrimitive(stateAtRead.active567Group), kotlinx.serialization.json.JsonPrimitive(it.id))).toString() },
            modelName = modelAtRead?.name, automaticContextWindow = automaticAtRead?.contextWindow,
            referenceModel = reference?.modelId, referenceUrl = reference?.sourceUrl, referenceCheckedAt = reference?.checkedAt,
            referenceIsAlias = reference?.alias == true,
            referenceContextWindow = reference?.capacity, referenceMaxOutput = reference?.maxOutputTokens,
            referenceMaxInput = reference?.maxInputTokens, referenceCapabilities = reference?.capabilities,
        )
        if (sid == null) {
            if ((stateAtRead.route as? AppRoute.Chat)?.surface != ChatSurface.Desktop && modelAtRead != null) _state.update {
                it.copy(contextSnapshot = modelDetails.copy(tokens = 0, contextWindow = modelAtRead.contextWindow), contextLoading = false)
            }
            return
        }
        contextReadJob?.cancel()
        contextReadJob = viewModelScope.launch(start = CoroutineStart.LAZY) {
            updateVisibleSession(sid) { it.copy(contextLoading = true, contextError = if (preserveError) it.contextError else null) }
            try {
                val session = container.sessionStore.getSession(sid) ?: return@launch
                val snapshot = if (session.origin == ConversationOrigin.Desktop) {
                    requireDesktopContextDevice(session)
                    session.remoteSessionId?.let { container.remoteConversationGateway.readDesktopContext(sid, it) }
                        ?: throw RemoteConversationException(Str.contextDesktopUnsupported)
                } else {
                    val messages = container.sessionStore.getMessages(sid)
                    withContext(Dispatchers.Default) {
                        val usage = mobileContext.snapshot(session, messages, modelAtRead?.contextWindow)
                        modelDetails.copy(workspace = usage.workspace, tokens = usage.tokens, contextWindow = usage.contextWindow, estimated = usage.estimated,
                            messageCount = usage.messageCount, autoCompactionEnabled = usage.autoCompactionEnabled, summary = usage.summary)
                    }
                }
                if (contextReadJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) {
                    it.copy(contextSnapshot = snapshot.copy(busy = snapshot.busy || streamJobs[sid]?.isCompleted == false || sid in pendingSendReservations), contextBusy = sid in contextOperations)
                }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (contextReadJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(contextSnapshot = null, contextError = contextOperationError(error)) }
            } finally {
                if (contextReadJob === currentCoroutineContext()[Job]) updateVisibleSession(sid) { it.copy(contextLoading = false) }
            }
        }
        contextReadJob?.start()
    }

    fun compactChatContext() = runContextOperation { session, modelId, window, group ->
        if (session.origin == ConversationOrigin.Desktop) {
            requireDesktopContextDevice(session)
            val snapshot = session.remoteSessionId?.let { container.remoteConversationGateway.compactDesktopContext(session.id, it) }
                ?: throw RemoteConversationException(Str.contextDesktopUnsupported)
            updateVisibleSession(session.id) { it.copy(contextSnapshot = snapshot, contextNotice = Str.contextCompacted) }
        } else {
            val compacted = mobileContext.compact(session.id, modelId ?: throw MobileContextException(Str.contextNoModel), window, group, manual = true)
            updateVisibleSession(session.id) { it.copy(contextNotice = if (compacted) Str.contextCompacted else Str.contextTooShort) }
        }
    }

    fun updateChatContextSelection(selection: org.agent567.android.domain.session.ContextWorkspaceSnapshot) = runContextOperation { session, _, _, _ ->
        if (session.origin == ConversationOrigin.Desktop) {
            requireDesktopContextDevice(session)
            val snapshot = session.remoteSessionId?.let { container.remoteConversationGateway.updateDesktopContextSelection(session.id, it, selection) }
                ?: throw RemoteConversationException(Str.contextDesktopUnsupported)
            updateVisibleSession(session.id) { it.copy(contextSnapshot = snapshot) }
        } else mobileContext.updateSelection(session.id, selection)
    }

    fun setChatContextCapacity(capacity: Long?) {
        val current = _state.value
        val route = current.route as? AppRoute.Chat ?: return
        if (route.surface == ChatSurface.Desktop || current.isStreaming || current.contextBusy) return
        val model = currentModel() ?: return
        if (capacity != null && org.agent567.android.core.model.validModelContext(capacity) == null) {
            _state.update { it.copy(contextError = Str.contextCapacityInvalid) }
            return
        }
        container.preferences.setModelContextOverride(current.active567Group, model.id, capacity)
        _state.update { it.copy(contextNotice = Str.contextCapacitySaved, contextError = null) }
        refreshChatContext()
    }

    fun setChatAutoCompaction(enabled: Boolean) = runContextOperation { session, _, _, _ ->
        if (session.origin == ConversationOrigin.Desktop) {
            requireDesktopContextDevice(session)
            val snapshot = session.remoteSessionId?.let { container.remoteConversationGateway.setDesktopAutoCompaction(session.id, it, enabled) }
                ?: throw RemoteConversationException(Str.contextDesktopUnsupported)
            updateVisibleSession(session.id) { it.copy(contextSnapshot = snapshot) }
        } else mobileContext.setAuto(session.id, enabled)
    }

    fun resetChatContext() = runContextOperation { session, _, _, _ ->
        if (session.origin == ConversationOrigin.Desktop) {
            requireDesktopContextDevice(session)
            if (_state.value.pendingImages.isNotEmpty() || _state.value.pendingFiles.isNotEmpty()) throw MobileContextException(Str.contextPendingAttachments)
            if (_state.value.currentSessionId == session.id) {
                openChat(null, ChatSurface.Desktop, deviceId = session.remoteDeviceId)
            }
        } else {
            mobileContext.reset(session.id)
            inputPredictionsBySession.remove(session.id)
            updateVisibleSession(session.id) { it.copy(inputPredictions = emptyList(), contextNotice = Str.contextResetDone) }
        }
    }

    fun cancelChatContextOperation() {
        _state.value.currentSessionId?.let { sid ->
            contextOperations[sid]?.cancel()
            updateVisibleSession(sid) { it.copy(contextNotice = Str.contextCancelRequested) }
        }
    }

    private fun requireDesktopContextDevice(session: org.agent567.android.domain.session.ChatSession) {
        if (_state.value.devices.none { it.id == session.remoteDeviceId && it.status == DeviceStatus.Online }) throw RemoteConversationException("电脑连接已断开，请重新连接")
    }

    private fun contextOperationError(error: Throwable): String = when (error) {
        is MobileContextException -> error.message.orEmpty()
        is RemoteRequestException -> error.remoteError.message.take(300)
        else -> ErrorMapper.from(error).message
    }

    private fun runContextOperation(action: suspend (org.agent567.android.domain.session.ChatSession, String?, Long?, String?) -> Unit) {
        val state = _state.value
        val sid = state.currentSessionId ?: return
        if (sid in contextOperations || NEW_SESSION_SEND_RESERVATION in pendingSendReservations || sid in pendingSendReservations || streamJobs[sid]?.isCompleted == false || sid in retryPreparingSessions || state.desktopHistoryLoading) return
        val selected = if ((state.route as? AppRoute.Chat)?.surface == ChatSurface.Desktop) state.desktopModels.firstOrNull { it.id == state.desktopSelectedModelId } else currentModel()
        val job = viewModelScope.launch(org.agent567.android.app.RequestClientContext(container.client), start = CoroutineStart.LAZY) {
            updateVisibleSession(sid) { it.copy(contextBusy = true, contextError = null, contextNotice = null) }
            inputPredictionJobs.remove(sid)?.cancel()
            inputPredictionLoadingSessions.remove(sid)
            inputPredictionsBySession.remove(sid)
            updateVisibleSession(sid) { it.copy(inputPredictionLoading = false, inputPredictions = emptyList()) }
            try {
                val session = container.sessionStore.getSession(sid) ?: return@launch
                action(session, selected?.id ?: session.modelId, selected?.contextWindow, state.active567Group)
            } catch (error: Throwable) {
                if (error is CancellationException && !error.isChatNetworkLoss()) throw error
                updateVisibleSession(sid) { it.copy(contextError = contextOperationError(if (error.isChatNetworkLoss()) ChatNetworkLostException() else error)) }
            } finally {
                if (contextOperations[sid] === currentCoroutineContext()[Job]) contextOperations.remove(sid)
                updateVisibleSession(sid) { it.copy(contextBusy = sid in contextOperations) }
                if (_state.value.currentSessionId == sid && (_state.value.contextPanelOpen || _state.value.workbenchOpen)) loadChatContext(preserveError = true)
            }
        }
        contextOperations[sid] = job
        job.start()
    }

    private fun loadDesktopSessionDetail(localSessionId: String, remoteSessionId: String, recoveredMessageId: String? = null) {
        desktopHistoryJob?.cancel()
        desktopHistoryJob = viewModelScope.launch {
            _state.update { it.copy(desktopHistoryLoading = true) }
            try {
                val history = container.remoteConversationGateway.readDesktopSessionHistory(localSessionId, remoteSessionId)
                    ?: throw RemoteConversationException("电脑暂时无法读取这段会话，请确认设备在线")
                val cachedMessageList = container.sessionStore.getMessages(localSessionId)
                val cachedMessages = cachedMessageList.associateBy { it.id }
                val matchedCachedMessageIds = mutableSetOf<String>()
                val recovered = cachedMessages[recoveredMessageId]
                val recoveredPrefix = recovered?.content?.removeSuffix("\n\n[恢复内容较长，任务结束后将读取完整记录]")
                val recoveredRemoteId = if (!recoveredPrefix.isNullOrBlank()) {
                    history.singleOrNull { it.role == ChatRole.Assistant && it.text.startsWith(recoveredPrefix) }?.id
                } else null
                val remoteMessages = history.map { item ->
                    val messageId = "desktop-${remoteSessionId}-${item.id}"
                    val cached = cachedMessages[messageId]
                        ?: recovered?.takeIf { item.id == recoveredRemoteId }
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
                        processingDurationMs = cached?.processingDurationMs,
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
                (_state.value.draft.isNotBlank() || _state.value.pendingImages.isNotEmpty() || _state.value.pendingFiles.isNotEmpty()))
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
            composerDrafts.remove(sessionId)
            cancelInputPredictionsForSession(sessionId)
            if (container.preferences.lastSessionId == sessionId) container.preferences.lastSessionId = null
        }
    }

    private suspend fun isEmptyRemoteDraftStillDisposable(sessionId: String): Boolean {
        if (runCatching { container.sessionStore.hasDraft(sessionId) }.getOrDefault(true)) return false
        val current = _state.value
        return streamJobs[sessionId]?.isActive != true &&
            drafts[sessionId].isNullOrBlank() &&
            (current.currentSessionId != sessionId || (current.pendingImages.isEmpty() && current.pendingFiles.isEmpty())) &&
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
            is AppRoute.DeviceCapabilities -> {
                val deviceId = (_state.value.route as AppRoute.DeviceCapabilities).deviceId
                openDeviceDetail(deviceId)
            }
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
                it.copy(desktopModels = catalog.models, desktopSelectedModelId = catalog.currentModelId, desktopServiceRoute = catalog.serviceRoute, desktopServiceRouteSessionId = localSessionId)
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
                    timeLabel = org.agent567.android.ui.formatting.formatRelativeTime(session.updatedAtEpochMs, nowEpochMs()),
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
                        timeLabel = org.agent567.android.ui.formatting.formatRelativeTime(summary.updatedAtEpochMs, nowEpochMs()),
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


    fun setLoginModeEmail(email: Boolean) {
        _state.update { it.copy(loginModeEmail = email) }
    }

    fun setPasswordVisible(visible: Boolean) {
        _state.update { it.copy(passwordVisible = visible) }
    }

    fun clearAuthError() {
        _state.update { it.copy(authError = null) }
    }

    private var failedSessionDeletion: String? = null

    fun retryFailedSessionDeletion() { failedSessionDeletion?.let(::deleteSession) }

    fun clearSessionDeletionError() {
        failedSessionDeletion = null
        _state.update { it.copy(sessionDeletionError = null) }
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
        persistCurrentDraft()
    }

    fun selectInputPrediction(value: String) {
        onDraftChange(value)
        _state.update { it.copy(inputPredictions = emptyList()) }
    }

    fun addPendingImages(images: List<MessageImage>) {
        if (images.isEmpty()) return
        _state.update { state ->
            val accepted = state.pendingImages.toMutableList()
            val existingIds = accepted.mapTo(mutableSetOf()) { it.id }
            var remainingBytes = (MAX_MESSAGE_IMAGE_TOTAL_BYTES - accepted.sumOf { it.pickedByteSize() }).coerceAtLeast(0)
            for (image in images) {
                if (accepted.size >= MAX_PICKED_IMAGE_COUNT || !existingIds.add(image.id)) continue
                val size = image.pickedByteSize()
                if (size > remainingBytes) continue
                accepted += image
                remainingBytes -= size
            }
            state.copy(pendingImages = accepted)
        }
        persistCurrentDraft()
    }

    fun removePendingImage(id: String) {
        _state.update { it.copy(pendingImages = it.pendingImages.filterNot { img -> img.id == id }) }
        persistCurrentDraft()
    }

    fun addPendingDocument(document: PendingFileAttachment) {
        _state.update { current ->
            if (
                current.pendingFiles.any { it.id == document.id } ||
                document.byteSize() !in 1..org.agent567.android.ui.media.MAX_MESSAGE_FILE_BYTES ||
                current.pendingFiles.size >= MAX_MESSAGE_FILE_COUNT ||
                current.pendingFiles.sumOf { it.byteSize() } + document.byteSize() > MAX_MESSAGE_FILE_TOTAL_BYTES
            ) current
            else current.copy(pendingFiles = current.pendingFiles + document)
        }
        persistCurrentDraft()
    }

    fun setPendingDocumentScope(id: String, scope: String) {
        if (scope.length > 300) return
        _state.update { it.copy(pendingFiles = it.pendingFiles.map { file -> if (file.id == id) file.copy(readScope = scope) else file }) }
        persistCurrentDraft()
    }

    fun removePendingDocument(id: String) {
        _state.update { it.copy(pendingFiles = it.pendingFiles.filterNot { document -> document.id == id }) }
        persistCurrentDraft()
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
                                desktopServiceRoute = catalog.serviceRoute,
                                desktopServiceRouteSessionId = sid,
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

    fun setAutoRequestDesktopScreen(enabled: Boolean) {
        container.preferences.setAutoRequestDesktopScreen(enabled)
    }

    fun setShowBottomNavLabels(enabled: Boolean) {
        container.preferences.setShowBottomNavLabels(enabled)
    }

    fun setConfirmBeforeDelete(enabled: Boolean) {
        container.preferences.setConfirmBeforeDelete(enabled)
    }

    fun setMigrationBackupLimitMb(limitMb: Int) {
        container.preferences.setMigrationBackupLimitMb(limitMb)
    }

    fun setGitHubDownloadSource(source: String, customPrefix: String): Boolean {
        return runCatching {
            if (source == org.agent567.android.app.AppPreferences.DOWNLOAD_SOURCE_CUSTOM) {
                container.preferences.customPrefix = customPrefix
            }
            container.preferences.downloadSource = source
            _state.update { it.copy(downloadSource = source, customDownloadPrefix = container.preferences.customPrefix) }
        }.isSuccess
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
            composerDrafts.clear()
            draftReadJob?.cancel()
            container.preferences.lastSessionId = null
            _state.update {
                it.copy(
                    currentSessionId = null,
                    messages = emptyList(),
                    draft = "",
                    pendingImages = emptyList(),
                    pendingFiles = emptyList(),
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

    fun sendSessionMigrationToDesktop(
        passphrase: String,
        onProgress: (String) -> Unit = {},
        onComplete: (Boolean, String?) -> Unit,
    ) {
        viewModelScope.launch {
            val device = container.remoteConversationGateway.devices.value.firstOrNull {
                it.status == DeviceStatus.Online
            }
            if (device == null) {
                onComplete(false, Str.migrationSendNoDevice)
                return@launch
            }
            val limitMb = container.preferences.migrationBackupLimitMb.value
            val result = runCatching {
                val archive = withContext(Dispatchers.Default) {
                    SessionMigrationBackup(container.sessionStore).export(passphrase, limitMb)
                }
                try {
                    val sent = container.remoteConversationGateway.sendEncryptedSessionMigrationArchive(
                        device.id,
                        archive,
                        passphrase,
                        onAwaitingApproval = { onProgress(Str.migrationSendAwaitingApproval) },
                    ) { completed, total ->
                        onProgress("${Str.migrationSendProgress} $completed/$total")
                    }
                    when (sent) {
                        true -> true
                        false -> throw IllegalStateException(Str.migrationSendUnsupported)
                        null -> throw IllegalStateException(Str.migrationSendNoDevice)
                    }
                } finally {
                    archive.fill(0)
                }
            }
            val error = result.exceptionOrNull()
            onComplete(result.getOrDefault(false), error?.message)
        }
    }

    private companion object {
        const val DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image"
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
        if (_state.value.authLoading) return
        _state.update { it.copy(authLoading = true, authError = null) }
        val revision = ++authRevision
        workspaceJob?.cancel()
        authJob = viewModelScope.launch {
            try {
                val session = withContext(Dispatchers.IO) { if (password.isBlank()) {
                    container.client.auth.loginWithAccessToken(accountOrEmail.trim())
                } else if (_state.value.loginModeEmail) {
                    container.client.auth.loginWithEmailPassword(accountOrEmail.trim(), password)
                } else {
                    container.client.auth.loginWithAccount(accountOrEmail.trim(), password)
                } }
                if (revision != authRevision) return@launch
                withContext(Dispatchers.IO) { authPersistence.withLock {
                if (revision != authRevision) return@withLock
                container.preferences.authLoginType = if (password.isBlank()) "token" else "account"
                container.preferences.authAccount = accountOrEmail.trim()
                container.preferences.authPassword = if (password.isBlank()) null else password
                container.preferences.authToken = session.accessToken
                container.preferences.authRefreshToken = session.refreshToken
                container.preferences.authUsername = session.user.nickname.ifBlank { session.user.username }
                container.preferences.authQuotaUsd = session.user.quotaUsd
                container.preferences.authUserId = session.user.id
                } }
                if (revision != authRevision) return@launch
                _state.update { it.copy(user = session.user, authLoading = false) }

                val pendingAction = pendingLoginAction
                pendingLoginAction = null
                loadWorkspace(openLastSession = true)
                if (pendingAction == PendingLoginAction.CloudConversation) {
                    newChat()
                }
            } catch (error: CancellationException) { throw error }
            catch (t: Throwable) {
                if (revision != authRevision) return@launch
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
        if (_state.value.authLoading) return
        _state.update { it.copy(authLoading = true, authError = null) }
        val revision = ++authRevision
        workspaceJob?.cancel()
        authJob = viewModelScope.launch {
            try {
                val session = withContext(Dispatchers.IO) { container.client.auth.register(username, password, email, code, affCode) }
                if (revision != authRevision) return@launch
                withContext(Dispatchers.IO) { authPersistence.withLock {
                if (revision != authRevision) return@withLock
                container.preferences.authLoginType = "account"
                container.preferences.authAccount = username.trim()
                container.preferences.authPassword = password
                container.preferences.authToken = session.accessToken
                container.preferences.authRefreshToken = session.refreshToken
                container.preferences.authUsername = session.user.nickname.ifBlank { session.user.username }
                container.preferences.authQuotaUsd = session.user.quotaUsd
                container.preferences.authUserId = session.user.id
                } }
                if (revision != authRevision) return@launch

                _state.update { it.copy(user = session.user, authLoading = false) }
                val pendingAction = pendingLoginAction
                pendingLoginAction = null
                loadWorkspace(openLastSession = true)
                if (pendingAction == PendingLoginAction.CloudConversation) {
                    newChat()
                }
                onResult(true, null)
            } catch (error: CancellationException) { throw error }
            catch (t: Throwable) {
                if (revision != authRevision) return@launch
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
                val err = t.message ?: Str.topupCreateFailed
                _state.update { it.copy(topupLoading = false, topupMessage = err) }
                onError(err)
            }
        }
    }

    fun logout(clearLocalSessions: Boolean) {
        if (_state.value.authLoading) return
        _state.update { it.copy(authLoading = true) }
        viewModelScope.launch { forceLogout(keepLocalSessions = !clearLocalSessions) }
    }

    private suspend fun forceLogout(keepLocalSessions: Boolean, message: String? = null) {
        val revision = ++authRevision
        failedSessionDeletion = null
        _state.update { it.copy(sessionDeletionError = null) }
        authJob?.cancel()
        workspaceJob?.cancel()
        cancelAllStreams()
        _state.update {
            it.copy(
                mainAccessGranted = false,
                authLoading = true,
                loggingOut = true,
                catalogLoading = false,
                quotaRefreshing = false,
                accountVerifying = false,
                accountVerificationMessage = null,
                user = null,
                subscription = null,
                subscriptionLoadFailed = false,
                models = emptyList(),
                selectedModelId = null,
                currentSessionId = null,
                messages = emptyList(),
                draft = "",
                pendingImages = emptyList(),
                pendingFiles = emptyList(),
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
        try {
            withContext(Dispatchers.IO) { authPersistence.withLock {
                container.client.auth.clearLocalSession()
                container.preferences.clearAuthSnapshot()
                if (!keepLocalSessions) {
                    container.sessionStore.sessions.value.map { it.id }.forEach { container.sessionStore.deleteSession(it) }
                }
                container.preferences.lastSessionId = null
            } }
            drafts.clear()
            composerDrafts.clear()
            draftReadJob?.cancel()
        } finally {
            if (authRevision == revision) _state.update { it.copy(authLoading = false, loggingOut = false) }
        }
    }

    fun refreshCatalog() {
        val client = container.client
        val revision = authRevision
        viewModelScope.launch(org.agent567.android.app.RequestClientContext(client)) {
            _state.update { it.copy(catalogLoading = true) }
            try {
                val sub = runCatching { client.subscription.me() }.getOrNull()
                if (!isCurrentAccount(client, revision)) return@launch
                _state.update {
                    it.copy(
                        subscription = sub,
                        subscriptionLoadFailed = sub == null,
                    )
                }
                val groups = runCatching { client.models.getAvailableGroups() }.getOrDefault(emptyMap())
                val currentGroup = _state.value.active567Group
                val models = client.models.listGoModels(currentGroup)
                if (!isCurrentAccount(client, revision)) return@launch
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
            } catch (error: CancellationException) { throw error }
            catch (t: Throwable) {
                if (!isCurrentAccount(client, revision)) return@launch
                _state.update {
                    it.copy(
                        catalogLoading = false,
                    )
                }
            }
        }
    }

    fun refreshQuota() {
        if (_state.value.quotaRefreshing || _state.value.user == null) return
        val client = container.client
        val revision = authRevision
        _state.update { it.copy(quotaRefreshing = true) }
        viewModelScope.launch(org.agent567.android.app.RequestClientContext(client)) {
            _state.update { it.copy(quotaRefreshing = true) }
            try {
                val user = withContext(Dispatchers.IO) { client.auth.me() }
                if (!isCurrentAccount(client, revision)) return@launch
                container.preferences.authUsername = user.nickname.ifBlank { user.username }
                container.preferences.authQuotaUsd = user.quotaUsd
                container.preferences.authUserId = user.id
                _state.update { it.copy(user = user, accountVerificationMessage = null) }
                refreshWorkspaceSnapshot(client, revision)
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (isCurrentAccount(client, revision)) _state.update { it.copy(accountVerificationMessage = Str.accountVerificationUnavailable) }
            } finally {
                if (authRevision == revision) _state.update { it.copy(quotaRefreshing = false) }
            }
        }
    }

    fun newChat(initialDraft: String = pendingNewChatDraft.also { pendingNewChatDraft = "" }) {
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
            saveComposerDraft(session.id, org.agent567.android.domain.session.SessionDraft(initialDraft))
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
        failedSessionDeletion = sessionId
        _state.update { it.copy(sessionDeletionError = null) }
        viewModelScope.launch {
            val session = container.sessionStore.sessions.value.firstOrNull { it.id == sessionId }
            val remoteSessionId = session?.remoteSessionId
                ?: sessionId.removePrefix("remote:").takeIf { sessionId.startsWith("remote:") }
            if (remoteSessionId != null) {
                val deviceId = session?.remoteDeviceId ?: container.remoteConversationGateway.devices.value
                    .firstOrNull { it.status == org.agent567.android.domain.device.DeviceStatus.Online }
                    ?.id
                if (deviceId == null) {
                    _state.update { it.copy(sessionDeletionError = ErrorMapper.from(RemoteConversationException(Str.deleteRemoteConnectFirst))) }
                    return@launch
                }
                try {
                    val deleted = container.remoteConversationGateway.deleteDesktopSession(deviceId, remoteSessionId)
                    if (deleted != true) throw RemoteConversationException(Str.deleteRemoteUnavailable)
                } catch (error: Throwable) {
                    if (error !is CancellationException) {
                        _state.update { it.copy(sessionDeletionError = ErrorMapper.from(error)) }
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
                    composerDrafts.remove(it.id)
                    if (container.preferences.lastSessionId == it.id) {
                        container.preferences.lastSessionId = null
                    }
                }
                _state.update { state ->
                    state.copy(
                        remoteDesktopSessions = state.remoteDesktopSessions.filterNot { it.id == remoteSessionId },
                        sessionDeletionError = null,
                        pendingQuestion = state.pendingQuestion?.takeIf { it.sessionId != sessionId },
                    )
                }
                return@launch
            }
            cancelStream(sessionId)
            container.sessionStore.deleteSession(sessionId)
            drafts.remove(sessionId)
            composerDrafts.remove(sessionId)
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
        val stateAtSend = _state.value
        val requestClient = container.client
        val requestRouter = container.conversationRouterFor(requestClient)
        val documents = stateAtSend.pendingFiles
        val text = stateAtSend.draft
        val images = stateAtSend.pendingImages
        val activeSessionId = stateAtSend.currentSessionId
        if ((text.isEmpty() && images.isEmpty() && documents.isEmpty()) || activeSessionId?.let {
                streamJobs[it]?.isCompleted == false || it in retryPreparingSessions || it in contextOperations
            } == true
        ) return
        val sendReservation = activeSessionId ?: NEW_SESSION_SEND_RESERVATION
        if (NEW_SESSION_SEND_RESERVATION in pendingSendReservations || !pendingSendReservations.add(sendReservation)) return
        activeSessionId?.let { inputPredictionJobs.remove(it)?.cancel() }

        viewModelScope.launch(org.agent567.android.app.RequestClientContext(requestClient)) {
            val route = stateAtSend.route as? AppRoute.Chat ?: return@launch
            if (_state.value.route != route || _state.value.currentSessionId != activeSessionId) return@launch
            val isDesktop = route.surface == ChatSurface.Desktop ||
                activeSessionId?.let { container.sessionStore.getSession(it)?.origin == ConversationOrigin.Desktop } == true
            if (documents.isNotEmpty() && !isDesktop) {
                val error = UiError(
                    title = Str.sendFileUnsupportedTitle,
                    message = Str.sendFileUnsupportedMessage,
                    action = UiErrorAction.None,
                )
                if (activeSessionId == null) _state.update {
                    if (it.route == route && it.currentSessionId == null) it.copy(chatError = error) else it
                } else updateVisibleSession(activeSessionId) { it.copy(chatError = error) }
                pendingSendReservations.remove(sendReservation)
                return@launch
            }
            if (!isDesktop && container.tokenStore.accessToken.isNullOrBlank()) {
                openLogin()
                return@launch
            }
            val model = (stateAtSend.models.firstOrNull { it.id == stateAtSend.selectedModelId }
                ?: stateAtSend.models.firstOrNull())?.let { requestClient.models.resolveContext(it, stateAtSend.active567Group) }
            if (!isDesktop && container.networkAvailability.value == NetworkAvailability.Unavailable) {
                val error = UiError("网络已断开", "网络恢复后再发送，草稿和附件已保留。")
                if (activeSessionId != null) updateVisibleSession(activeSessionId) { it.copy(chatError = error) }
                else _state.update { if (it.route == stateAtSend.route && it.currentSessionId == null) it.copy(chatError = error) else it }
                return@launch
            }
            var sessionId = activeSessionId
            if (sessionId == null) {
                val origin =
                    if (route.surface == ChatSurface.Desktop) {
                        ConversationOrigin.Desktop
                    } else {
                        ConversationOrigin.Cloud
                    }
                if (origin == ConversationOrigin.Cloud && model == null) {
                    showNoModelError()
                    return@launch
                }
                if (origin == ConversationOrigin.Desktop && route.deviceId == null) {
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
                        remoteDeviceId = route.deviceId,
                    )
                sessionId = session.id
                if (_state.value.route == route && _state.value.currentSessionId == null) {
                    attachSession(sessionId)
                    _state.update {
                        it.copy(
                            route = route.copy(sessionId = sessionId),
                        )
                    }
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
            val modelWindow = model?.contextWindow?.takeIf { it > 0 }
            if (session.origin == ConversationOrigin.Cloud && session.context.autoCompactionEnabled && model != null && modelWindow != null) {
                val newInputTokens = MobileContextManager.estimateText(text) + images.size * 2048L + 32L
                val outputReserve = minOf(model.maxTokens ?: maxOf(1024L, modelWindow / 5), modelWindow / 4).coerceAtLeast(128L)
                val inputBudget = (modelWindow - outputReserve).coerceAtLeast(1L)
                try {
                    if (newInputTokens >= inputBudget) throw MobileContextException("本次输入已接近设置的上下文容量，请减少内容、附件或核对模型容量；草稿已保留。")
                    val messages = container.sessionStore.getMessages(sid)
                    val snapshot = withContext(Dispatchers.Default) { mobileContext.snapshot(session, messages, modelWindow) }
                    if ((snapshot.tokens ?: 0L) + newInputTokens >= minOf(modelWindow * 8 / 10, inputBudget)) {
                        contextOperations[sid] = requireNotNull(currentCoroutineContext()[Job])
                        updateVisibleSession(sid) { it.copy(contextBusy = true, streamingStatus = "compacting") }
                        mobileContext.compact(sid, model.id, modelWindow, stateAtSend.active567Group, newInputTokens)
                        session = container.sessionStore.getSession(sid) ?: return@launch
                        val compacted = withContext(Dispatchers.Default) { mobileContext.snapshot(session, container.sessionStore.getMessages(sid), modelWindow) }
                        if ((compacted.tokens ?: 0L) + newInputTokens >= inputBudget) throw MobileContextException("压缩后仍超出设置的上下文预算。请减少本次输入，核对容量或开始新上下文；聊天记录和草稿已保留。")
                    }
                } catch (error: Throwable) {
                    if (error is CancellationException && !error.isChatNetworkLoss()) throw error
                    withContext(NonCancellable) {
                        val cause = if (error.isChatNetworkLoss()) ChatNetworkLostException() else error
                        updateVisibleSession(sid) { it.copy(chatError = UiError(Str.contextManage, contextOperationError(cause))) }
                    }
                    return@launch
                } finally {
                    if (contextOperations[sid] === currentCoroutineContext()[Job]) contextOperations.remove(sid)
                    updateVisibleSession(sid) { it.copy(contextBusy = false, streamingStatus = null) }
                }
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
                    files = documents.map { file ->
                        MessageFileAttachment(file.id, file.fileName, file.mimeType, file.bytes.size.toLong())
                    },
                )
            val isFirstUserMessage = !retryPreviousTurn && container.sessionStore.getMessages(sid).none { it.role == ChatRole.User }
            val titleModelId = model?.id ?: session.modelId
            val titleGroupName = stateAtSend.active567Group
            val titlePrompt = text.take(1200).ifBlank {
                when {
                    images.isNotEmpty() -> "用户发送了图片"
                    documents.isNotEmpty() -> "用户发送了文件：${documents.take(3).joinToString { it.fileName }}"
                    else -> ""
                }
            }
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
            val latestDraft = composerDrafts[sid]
            val consumeDraft = latestDraft == null || (latestDraft.text == text && latestDraft.images.map { it.id } == images.map { it.id } && latestDraft.files.map { it.id } == documents.map { it.id })
            if (consumeDraft) saveComposerDraft(sid, org.agent567.android.domain.session.SessionDraft())
            inputPredictionsBySession.remove(sid)
            inputPredictionLoadingSessions.remove(sid)
            streamStatuses[sid] = "waiting_response"
            updateVisibleSession(sid) {
                it.copy(
                    draft = if (consumeDraft) "" else it.draft,
                    pendingImages = if (consumeDraft) emptyList() else it.pendingImages,
                    pendingFiles = if (consumeDraft) emptyList() else it.pendingFiles,
                    isStreaming = true,
                    streamingStatus = "waiting_response",
                    inputPredictions = emptyList(),
                    inputPredictionLoading = false,
                    chatError = null,
                )
            }

            val context = container.sessionStore.getSession(sid)?.context ?: session.context
            answeredQuestionRequests.removeAll { it.first == sid }

            val streamJob = viewModelScope.launch(start = CoroutineStart.LAZY) {
                    var assembled = ""
                    var toolEvents = emptyList<ToolTrace>()
                    var assistantImages = assistantMsg.images
                    var usage: TokenUsage? = null
                    var contextPercent: Int? = null
                    var pendingQuestion: PendingQuestion? = null
                    var hasPublishedDelta = false
                    var responseTruncated = false
                    var recoveryNeedsHistory = false
                    var pendingPersist: Job? = null

                    suspend fun persistAssistant(status: MessageStatus = MessageStatus.Streaming) {
                        val snapshot = assistantMsg.copy(
                            content = assembled,
                            status = status,
                            processingDurationMs = if (status == MessageStatus.Streaming) null else elapsedSince(assistantMsg.createdAtEpochMs),
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

                    var history = emptyList<ChatMessage>()
                    try {
                        if (session.origin == ConversationOrigin.Cloud && container.networkAvailability.value == NetworkAvailability.Unavailable) {
                            throw ChatNetworkLostException()
                        }
                        val storedHistory = container.sessionStore.getMessages(sid)
                        val historyMessages = storedHistory.filter {
                            it.id != assistantId &&
                                it.status != MessageStatus.Error &&
                                it.hasVisualContent
                        }
                        val selectedHistory = if (session.origin == ConversationOrigin.Cloud) {
                            mobileContext.selectForPrompt(storedHistory.filterNot { it.id == assistantId }, context, userMsg)
                        } else historyMessages
                        val builtHistory = buildChatHistory(selectedHistory)
                        history = if (session.origin == ConversationOrigin.Cloud) mobileContext.referenceMessages(context) + builtHistory else builtHistory
                        requestRouter
                            .stream(
                                session = session,
                                selectedModelId = model?.id,
                                messages = history,
                                groupName = stateAtSend.active567Group,
                                imageGenModel = if (stateAtSend.imageGenEnabled) stateAtSend.activeImageModel else null,
                                retryPreviousTurn = retryPreviousTurn,
                                desktopPromptText = buildString {
                                    append(stateAtSend.draft)
                                    documents.filter { it.readScope.isNotBlank() }.forEach { document -> append("\n\n[Attachment reading scope requested by user] ").append(document.fileName).append(": ").append(document.readScope) }
                                },
                                desktopFiles = documents.map { document ->
                                    RemotePromptFileAttachment(
                                        fileName = document.fileName,
                                        mimeType = document.mimeType,
                                        bytes = document.bytes,
                                    )
                                },
                            )
                            .collect { event ->
                                when (event) {
                                    is ChatStreamEvent.Snapshot -> {
                                        pendingPersist?.cancelAndJoin()
                                        pendingPersist = null
                                        recoveryNeedsHistory = event.truncated
                                        assembled = event.text.take(MAX_ASSISTANT_MESSAGE_CHARS)
                                        if (event.truncated) assembled += "\n\n[恢复内容较长，任务结束后将读取完整记录]"
                                        hasPublishedDelta = assembled.isNotBlank()
                                        toolEvents = event.tools.map { tool ->
                                            ToolTrace(tool.phase, tool.toolCallId, tool.toolName, tool.detail?.boundedForStorage(), tool.durationMs, tool.arguments?.boundedForStorage(), tool.result?.boundedForStorage(), tool.phaseLabel)
                                        }
                                        val localQuestion = _state.value.pendingQuestion?.takeIf { it.sessionId == sid }
                                            ?: container.sessionStore.getMessages(sid).lastOrNull { it.id == assistantId }?.pendingQuestion
                                        pendingQuestion = event.input?.takeIf { event.state !in setOf("completed", "error", "aborted") && (sid to it.requestId) !in answeredQuestionRequests }?.let {
                                            if (localQuestion?.requestId == it.requestId && localQuestion.questions == it.questions) localQuestion
                                            else PendingQuestion(sid, it.requestId, it.questions)
                                        }
                                        event.usage?.let { usage = it.usage; contextPercent = it.contextPercent }
                                        persistAssistant()
                                        // Fetch once the recovered turn stops changing this message.
                                        // Polling a running snapshot must not overwrite downloaded images.
                                        if (event.state in setOf("completed", "error", "aborted")) {
                                            event.tools.flatMap { it.images }.takeIf { it.isNotEmpty() }?.let { refs ->
                                                fetchDesktopGeneratedImages(sid, assistantId, session.remoteSessionId ?: container.conversationRouter.resolvedRemoteSessionId(sid), refs)
                                            }
                                        }
                                        setStreamStatus(sid, if (event.state == "running") { if (hasPublishedDelta) "running" else "waiting_response" } else event.state)
                                        updateVisibleSession(sid) { it.copy(pendingQuestion = pendingQuestion, chatError = null) }
                                    }
                                    is ChatStreamEvent.Delta -> {
                                        setStreamStatus(sid, "running")
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
                                        if (isImageGen && event.phase == "call" && session.origin == ConversationOrigin.Cloud) {
                                            var promptArg = event.arguments.orEmpty()
                                            var isEdit = false
                                            try {
                                                val argsObj = org.agent567.android.core.net.Agent567Json.parseToJsonElement(event.arguments.orEmpty()) as? kotlinx.serialization.json.JsonObject
                                                promptArg = (argsObj?.get("prompt") as? kotlinx.serialization.json.JsonPrimitive)?.content ?: promptArg
                                                val actionStr = (argsObj?.get("action") as? kotlinx.serialization.json.JsonPrimitive)?.content
                                                isEdit = actionStr == "edit"
                                            } catch (_: Exception) {
                                            }

                                            // 自动溯源上下文历史图片：优先匹配用户本轮上传，支持单图修改与多图融合创作
                                            val allSessionMsgs = mobileContext.select(container.sessionStore.getMessages(sid), container.sessionStore.getSession(sid)?.context ?: context)
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

                                            val imgModel = stateAtSend.activeImageModel ?: "gemini-3.1-flash-image"
                                            val imgGroup = stateAtSend.activeImageGroup
                                            try {
                                                val res = requestClient.models.generateImage(
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
                                                        val bytes = requestClient.models.downloadImageBytesDirect(url)
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
                                            "thinking", "reconnecting", "waiting_response" -> setStreamStatus(sid, event.value)
                                            "running" -> setStreamStatus(sid, if (hasPublishedDelta) "running" else "waiting_response")
                                            "retrying", "compacting", "preparing", "background" -> setStreamStatus(sid, event.value)
                                            "aborted" -> {
                                                flushPendingPersist()
                                                pendingQuestion = null
                                                persistAssistant(MessageStatus.Aborted)
                                                updateVisibleSession(sid) { it.copy(pendingQuestion = null) }
                                                setStreamStatus(sid, null)
                                            }
                                            "completed" -> setStreamStatus(sid, null)
                                        }
                                    }
                                    is ChatStreamEvent.Finished -> event.usage?.let {
                                        flushPendingPersist()
                                        usage = it
                                        persistAssistant()
                                    }
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
                                                processingDurationMs = elapsedSince(assistantMsg.createdAtEpochMs),
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
                        if (latest != null && latest.status in setOf(MessageStatus.Streaming, MessageStatus.Complete)) {
                            container.sessionStore.upsertMessage(
                                latest.copy(
                                    status = MessageStatus.Complete,
                                    processingDurationMs = elapsedSince(assistantMsg.createdAtEpochMs),
                                    pendingQuestion = null,
                                ),
                            )
                        }
                    } catch (t: Throwable) {
                        // Cancellation must still finish durable state before the send gate
                        // opens; otherwise a stale spinner or cleanup can affect the next turn.
                        withContext(NonCancellable) {
                            pendingPersist?.cancelAndJoin()
                            pendingPersist = null
                            val networkLost = t.isChatNetworkLoss()
                            val stopped = t is CancellationException && !networkLost
                            val ui = ErrorMapper.from(if (networkLost) ChatNetworkLostException() else t)
                            val latest =
                                container.sessionStore.getMessages(sid).firstOrNull { it.id == assistantId }
                            if (latest != null) {
                                container.sessionStore.upsertMessage(
                                    assistantMsg.copy(
                                        content = assembled,
                                        images = assistantImages,
                                        status =
                                            if (stopped) {
                                                MessageStatus.Aborted
                                            } else {
                                                MessageStatus.Error
                                            },
                                        processingDurationMs = elapsedSince(assistantMsg.createdAtEpochMs),
                                        errorMessage = if (stopped) null else ui.message,
                                        toolEvents = toolEvents,
                                        usage = usage,
                                        contextPercent = contextPercent,
                                        pendingQuestion = null,
                                    ),
                                )
                            }
                            if (!stopped) {
                                setSessionError(sid, if (networkLost) ChatNetworkLostException() else t)
                                if (documents.isNotEmpty()) {
                                    updateVisibleSession(sid) { it.copy(pendingFiles = documents) }
                                }
                            }
                        }
                    } finally {
                        pendingPersist?.cancel()
                        if (streamJobs[sid] === currentCoroutineContext()[Job]) {
                            streamJobs.remove(sid)
                            streamStatuses.remove(sid)
                            updateVisibleSession(sid) { it.copy(isStreaming = false, streamingStatus = null) }
                            if (recoveryNeedsHistory && _state.value.currentSessionId == sid) {
                                val remoteId = session.remoteSessionId ?: container.conversationRouter.resolvedRemoteSessionId(sid)
                                if (remoteId != null) loadDesktopSessionDetail(sid, remoteId, assistantId)
                            }
                        }
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
            if (selectedImageData.size >= MAX_REQUEST_IMAGE_COUNT || totalImageBytes >= MAX_REQUEST_IMAGE_CONTEXT_BYTES) break
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
            if (loaded.size >= MAX_REQUEST_IMAGE_COUNT || totalBytes >= MAX_REQUEST_IMAGE_CONTEXT_BYTES) break
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
                                title = Str.desktopImageLoadErrorTitle,
                                message = Str.desktopImageTransferIncomplete,
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
                            title = Str.desktopImageLoadErrorTitle,
                            message = Str.desktopImageDeviceOffline,
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

    private val answeredQuestionRequests = mutableSetOf<Pair<String, String>>()

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
                    answeredQuestionRequests.add(session.id to pending.requestId)
                    val message = container.sessionStore.getMessages(session.id).lastOrNull { it.pendingQuestion?.requestId == pending.requestId }
                    if (message != null) container.sessionStore.upsertMessage(message.copy(pendingQuestion = null))
                    updateVisibleSession(session.id) { state -> state.copy(pendingQuestion = state.pendingQuestion?.takeIf { it.requestId != pending.requestId }) }
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
                container.sessionStore.upsertMessage(
                    streaming.copy(
                        status = MessageStatus.Aborted,
                        processingDurationMs = elapsedSince(streaming.createdAtEpochMs),
                        pendingQuestion = null,
                    ),
                )
            }
            updateVisibleSession(sid) { state ->
                state.copy(
                    pendingQuestion = state.pendingQuestion?.takeIf { it.sessionId != sid },
                )
            }
        }
    }

    fun retryLastError(assistantMessageId: String? = null) {
        val retryRoute = _state.value.route
        val sid = _state.value.currentSessionId ?: return
        if (streamJobs[sid]?.isCompleted == false || sid in pendingSendReservations || sid in contextOperations || !retryPreparingSessions.add(sid)) return
        viewModelScope.launch {
            try {
                if (streamJobs[sid]?.isCompleted == false) return@launch
                val messages = container.sessionStore.getMessages(sid)
                val turn = prepareRetryTurn(messages, assistantMessageId) ?: return@launch
                if (turn.files.isNotEmpty()) {
                    updateVisibleSession(sid) {
                        it.copy(chatError = UiError(
                            title = Str.retryFileAttachmentUnavailableTitle,
                            message = Str.retryFileAttachmentUnavailableMessage,
                        ))
                    }
                    return@launch
                }
                val retryImages = turn.images.map { image ->
                    if (image.storageKey == null || image.pendingBytes != null || image.base64Data.isNotBlank()) {
                        image
                    } else {
                        val bytes = container.sessionStore.readMessageImageBytes(image)
                        if (bytes == null) {
                            updateVisibleSession(sid) {
                                it.copy(chatError = UiError(
                                    title = Str.retryMissingImageTitle,
                                    message = Str.retryMissingImageMessage,
                                ))
                            }
                            return@launch
                        }
                        image.copy(storageKey = null, pendingBytes = bytes)
                    }
                }
                if (_state.value.currentSessionId != sid || _state.value.route != retryRoute) return@launch
                val session = container.sessionStore.getSession(sid) ?: return@launch
                if (_state.value.currentSessionId != sid || _state.value.route != retryRoute) return@launch
                val boundary = messages.firstOrNull { it.id == session.context.throughMessageId }
                if (boundary != null && session.context.throughCreatedAtEpochMs == null) {
                    container.sessionStore.updateSession(session.copy(context = session.context.copy(throughCreatedAtEpochMs = boundary.createdAtEpochMs)))
                }
                if (_state.value.currentSessionId != sid || _state.value.route != retryRoute) return@launch
                container.sessionStore.replaceMessages(sid, turn.remainingMessages)
                if (_state.value.currentSessionId != sid || _state.value.route != retryRoute) {
                    // A navigation during the write cancels preparation; keep the original failed turn.
                    container.sessionStore.replaceMessages(sid, messages)
                    return@launch
                }
                saveComposerDraft(sid, org.agent567.android.domain.session.SessionDraft(turn.draft, retryImages))
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
        draftReadJob?.cancel()
        val cachedDraft = composerDrafts[sessionId]
        val draft = cachedDraft?.text ?: drafts[sessionId].orEmpty()
        _state.update {
            it.copy(
                currentSessionId = sessionId,
                messages = if (it.currentSessionId == sessionId) it.messages else emptyList(),
                chatError = null,
                draft = draft,
                contextBusy = sessionId in contextOperations,
                isStreaming = streamJobs[sessionId]?.isCompleted == false,
                streamingStatus = streamStatuses[sessionId],
                inputPredictions = if (draft.isBlank()) inputPredictionsBySession[sessionId].orEmpty() else emptyList(),
                inputPredictionLoading = sessionId in inputPredictionLoadingSessions && draft.isBlank(),
                pendingQuestion = null,
                pendingImages = if (clearPendingImages) cachedDraft?.images.orEmpty() else it.pendingImages,
                pendingFiles = if (clearPendingImages) cachedDraft?.files.orEmpty() else it.pendingFiles,
            )
        }
        if (cachedDraft == null) {
            val revision = authRevision
            val owner = composerOwner()
            if (owner != null) draftReadJob = viewModelScope.launch {
                try {
                    val restored = draftPersistence.withLock { container.sessionStore.getDraft(sessionId, owner) }
                    if (authRevision != revision || composerOwner() != owner || _state.value.currentSessionId != sessionId || composerDrafts.containsKey(sessionId)) return@launch
                    composerDrafts[sessionId] = restored
                    drafts[sessionId] = restored.text
                    _state.update { it.copy(draft = restored.text, pendingImages = restored.images, pendingFiles = restored.files) }
                } catch (error: CancellationException) { throw error }
                catch (_: Throwable) {
                    if (authRevision == revision && _state.value.currentSessionId == sessionId) _state.update {
                        it.copy(chatError = UiError(Str.draftRestoreFailed, Str.draftRestoreFailedHint, UiErrorAction.None))
                    }
                }
            }
        }
        messagesCollectJob =
            viewModelScope.launch {
                container.sessionStore.observeMessages(sessionId).collect { list ->
                    val persistedPending = list.asReversed().firstNotNullOfOrNull { message ->
                        message.pendingQuestion?.takeIf { it.sessionId == sessionId }
                    }
                    _state.update { state ->
                        if (state.currentSessionId != sessionId) state else state.copy(
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
        draftReadJob?.cancel()
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
        contextOperations.remove(sessionId)?.cancel()
        streamJobs[sessionId]?.cancel()
        streamStatuses.remove(sessionId)
        updateVisibleSession(sessionId) { it.copy(isStreaming = false, streamingStatus = null) }
    }

    private fun cancelAllStreams() {
        contextReadJob?.cancel()
        contextOperations.values.toList().forEach(Job::cancel)
        contextOperations.clear()
        val jobs = streamJobs.values.toList()
        streamJobs.clear()
        streamStatuses.clear()
        jobs.forEach(Job::cancel)
        _state.update { it.copy(isStreaming = false, streamingStatus = null, contextBusy = false) }
    }

    private fun currentModel(): LlmModel? {
        val id = _state.value.selectedModelId
        return (_state.value.models.firstOrNull { it.id == id } ?: _state.value.models.firstOrNull())
            ?.let { container.client.models.resolveContext(it, _state.value.active567Group) }
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

private fun elapsedSince(startedAtEpochMs: Long): Long = (nowEpochMs() - startedAtEpochMs).coerceAtLeast(0L)

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
