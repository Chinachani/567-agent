package org.vetta.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.vetta.android.app.AppContainer
import org.vetta.android.app.ThemeMode
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.core.model.LlmModel
import org.vetta.android.core.model.SubscriptionStatus
import org.vetta.android.core.model.TokenUsage
import org.vetta.android.core.model.User
import org.vetta.android.core.net.RefreshOutcome
import org.vetta.android.domain.chat.prepareRetryTurn
import org.vetta.android.domain.chat.shouldClearPendingImagesOnSessionChange
import org.vetta.android.domain.error.ErrorMapper
import org.vetta.android.domain.error.UiError
import org.vetta.android.domain.error.UiErrorAction
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.SessionListItem
import org.vetta.android.domain.session.ConversationOrigin
import org.vetta.android.domain.session.LocalMessage
import org.vetta.android.domain.session.MessageImage
import org.vetta.android.domain.session.MessageStatus
import org.vetta.android.domain.session.PendingQuestion
import org.vetta.android.domain.session.ToolTrace
import org.vetta.android.domain.session.SessionStore
import org.vetta.android.domain.session.nowEpochMs
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.navigation.AppRoute
import org.vetta.android.ui.navigation.ChatSurface
import org.vetta.android.ui.navigation.MainTab
import kotlin.random.Random

data class AppUiState(
    val bootstrapped: Boolean = false,
    val mainAccessGranted: Boolean = false,
    val route: AppRoute = AppRoute.Boot,
    val mainTab: MainTab = MainTab.Home,
    val themeMode: ThemeMode = ThemeMode.System,
    val autoResumeLastSession: Boolean = true,
    val motionEnabled: Boolean = true,
    val confirmBeforeDelete: Boolean = true,
    val serverUrl: String = "",
    val user: User? = null,
    val subscription: SubscriptionStatus? = null,
    val models: List<LlmModel> = emptyList(),
    val selectedModelId: String? = null,
    val currentSessionId: String? = null,
    val messages: List<LocalMessage> = emptyList(),
    val draft: String = "",
    val pendingImages: List<MessageImage> = emptyList(),
    val isStreaming: Boolean = false,
    /** 面向用户的短状态，不透传 Desktop 内部思考文本或异常原文。 */
    val streamingStatus: String? = null,
    val modelPickerOpen: Boolean = false,
    val available567Groups: Map<String, org.vetta.android.core.api.ApiGroupInfoDto> = emptyMap(),
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
    val globalError: UiError? = null,
    val authError: UiError? = null,
    val authLoading: Boolean = false,
    val loginModeEmail: Boolean = true,
    val catalogLoading: Boolean = false,
    val passwordVisible: Boolean = false,
    val sessionQuery: String = "",
    val sessionFilterIndex: Int = 0,
    val discoverChannelIndex: Int = 0,
    val newConversationChannelIndex: Int = 0,
    val devices: List<DesktopDevice> = emptyList(),
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

private const val STREAMING_PERSIST_INTERVAL_MS = 80L

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
                confirmBeforeDelete = container.preferences.confirmBeforeDelete.value,
            ),
        )
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    private var streamJob: Job? = null
    private var messagesCollectJob: Job? = null
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
            container.unauthorizedEpoch.collect { epoch ->
                if (epoch > 0) {
                    forceLogout(keepLocalSessions = true, message = "登录已失效，请重新登录")
                }
            }
        }
        viewModelScope.launch {
            container.remoteConversationGateway.devices.collect { devices ->
                _state.update { it.copy(devices = devices) }
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
                return@launch
            }
            if (container.tokenStore.accessToken.isNullOrBlank() || container.tokenStore.refreshToken.isNullOrBlank()) {
                container.tokenStore.save(token, refreshToken ?: token)
            }
            if (container.preferences.authToken.isNullOrBlank()) {
                container.preferences.authToken = token
            }
            if (container.preferences.authRefreshToken.isNullOrBlank() && !refreshToken.isNullOrBlank()) {
                container.preferences.authRefreshToken = refreshToken
            }
            val loginType = container.preferences.authLoginType
            val account = container.preferences.authAccount
            val password = container.preferences.authPassword

            if (loginType == "account" && !account.isNullOrBlank() && !password.isNullOrBlank()) {
                viewModelScope.launch {
                    try {
                        val session = container.client.auth.loginWithAccount(account, password)
                        container.preferences.authToken = session.accessToken
                        container.preferences.authRefreshToken = session.refreshToken
                        container.preferences.authUsername = session.user.nickname.ifBlank { session.user.username }
                        container.preferences.authQuotaUsd = session.user.quotaUsd
                        container.preferences.authUserId = session.user.id
                        _state.update { it.copy(user = session.user) }
                        loadWorkspace(openLastSession = false)
                    } catch (_: Throwable) {
                    }
                }
            } else if (loginType == "token" && !account.isNullOrBlank()) {
                viewModelScope.launch {
                    try {
                        val session = container.client.auth.loginWithAccessToken(account)
                        container.preferences.authToken = session.accessToken
                        container.preferences.authUsername = session.user.nickname.ifBlank { session.user.username }
                        container.preferences.authQuotaUsd = session.user.quotaUsd
                        container.preferences.authUserId = session.user.id
                        _state.update { it.copy(user = session.user) }
                        loadWorkspace(openLastSession = false)
                    } catch (_: Throwable) {
                    }
                }
            }

            loadWorkspace(openLastSession = container.preferences.autoResumeLastSession.value)
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
                globalError = null,
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
                    subscription = sub ?: it.subscription,
                    available567Groups = if (groups.isNotEmpty()) groups else it.available567Groups,
                    active567Group = currentGroup,
                    models = finalModels,
                    selectedModelId = selected,
                    catalogLoading = false,
                )
            }
        } catch (t: Throwable) {
            _state.update {
                it.copy(
                    catalogLoading = false,
                    globalError = ErrorMapper.from(t),
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
                globalError = null,
                authError = null,
            )
        }
        restorePendingQuestion()
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
        if (org.vetta.android.domain.remote.parsePairingInvite(target) == null) {
            _state.update {
                it.copy(
                    route = AppRoute.Welcome,
                    globalError =
                        UiError(
                            title = Str.invalidPairingInvite,
                            message = Str.invalidPairingInviteHint,
                            action = UiErrorAction.None,
                        ),
                )
            }
            return
        }
        navigate(AppRoute.Welcome)
        connectDesktop(target)
    }

    fun connectDesktop(target: String) {
        if (_state.value.remoteConnecting) return
        _state.update { it.copy(remoteConnecting = true, globalError = null) }
        viewModelScope.launch {
            try {
                val invite = org.vetta.android.domain.remote.parsePairingInvite(target)
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
                                    add(org.vetta.android.domain.remote.buildMobileResumeTarget(lanInvite, savedResume))
                                }
                                add(org.vetta.android.domain.remote.buildMobileBootstrapTarget(lanInvite, requireNotNull(resume)))
                            }
                            if (invite.relayBaseUrl.isNotBlank() && invite.relayBaseUrl != invite.lanBaseUrl) {
                                if (savedResume != null) {
                                    add(org.vetta.android.domain.remote.buildMobileResumeTarget(invite, savedResume))
                                }
                                add(org.vetta.android.domain.remote.buildMobileBootstrapTarget(invite, requireNotNull(resume)))
                            }
                        }
                    }
                var connected = false
                for (candidate in candidateTargets) {
                    if (runCatching { container.remoteConversationGateway.connect(candidate) }.getOrDefault(false)) {
                        connected = true
                        break
                    }
                }
                if (connected) {
                    _state.update { it.copy(mainAccessGranted = true) }
                    if (invite != null && resume != null) {
                        container.preferences.remotePairingId = invite.pairingId
                        container.preferences.remoteResumeSecret = resume
                    }
                    val device = container.remoteConversationGateway.devices.value.firstOrNull()
                    if (device != null) openDeviceDetail(device.id)
                    return@launch
                }
                _state.update {
                    it.copy(
                        globalError =
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

    private fun newRemoteResumeSecret(): String =
        buildString(43) {
            repeat(43) { append("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".random()) }
        }

    fun disconnectDesktop(deviceId: String) {
        viewModelScope.launch {
            runCatching { container.remoteConversationGateway.disconnect(deviceId) }
            navigateBackFromSecondary()
        }
    }

    fun setSessionQuery(query: String) {
        _state.update { it.copy(sessionQuery = query) }
    }

    fun setSessionFilter(index: Int) {
        _state.update { it.copy(sessionFilterIndex = index) }
    }

    fun openChat(
        sessionId: String?,
        surface: ChatSurface = ChatSurface.Cloud,
        title: String = "",
        deviceId: String? = null,
    ) {
        val previousSessionId = _state.value.currentSessionId
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
        } else {
            detachSessionMessages()
            _state.update {
                it.copy(
                    currentSessionId = null,
                    messages = emptyList(),
                    draft = "",
                    pendingImages = if (clearPending) emptyList() else it.pendingImages,
                )
            }
        }
    }

    fun openCloudChat(sessionId: String? = null) {
        openChat(sessionId = sessionId, surface = ChatSurface.Cloud, title = Str.channelCloud)
    }

    fun navigateBackFromSecondary() {
        // QR pairing is an independent entry path; a connected Desktop is enough to use the main shell.
        if (_state.value.mainAccessGranted || _state.value.user != null || _state.value.devices.isNotEmpty()) {
            navigate(AppRoute.Main(_state.value.mainTab))
        } else {
            navigate(AppRoute.Welcome)
        }
    }

    fun handleSystemBack() {
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
        _state.update { it.copy(route = route, authError = null) }
    }

    fun setModelPicker(open: Boolean) {
        _state.update { it.copy(modelPickerOpen = open) }
    }

    val sessionListItems: StateFlow<List<SessionListItem>> =
        combine(container.sessionStore.sessions, _state) { sessionList, s ->
            sessionList.map { session ->
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
                )
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

    fun clearGlobalError() {
        _state.update { it.copy(globalError = null) }
    }

    fun onDraftChange(value: String) {
        val sid = _state.value.currentSessionId
        if (sid != null) drafts[sid] = value
        _state.update { it.copy(draft = value) }
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
                groupPickerOpen = false,
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
                val selected = if (current != null && models.contains(current)) current else models.firstOrNull()
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
        container.preferences.lastModelId = model.id
        _state.update { it.copy(selectedModelId = model.id, modelPickerOpen = false) }
        val sid = _state.value.currentSessionId
        if (sid != null) {
            viewModelScope.launch {
                val session = container.sessionStore.getSession(sid) ?: return@launch
                if (session.origin != ConversationOrigin.Cloud) return@launch
                container.sessionStore.updateSession(
                    session.copy(modelId = model.id, modelName = model.name),
                )
            }
        }
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

    fun setConfirmBeforeDelete(enabled: Boolean) {
        container.preferences.setConfirmBeforeDelete(enabled)
    }

    fun clearLocalSessions() {
        viewModelScope.launch {
            streamJob?.cancel()
            streamJob = null
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

    fun logout(clearLocalSessions: Boolean) {
        viewModelScope.launch {
            streamJob?.cancel()
            runCatching { container.client.auth.logout() }
            container.preferences.clearAuthSnapshot()
            forceLogout(keepLocalSessions = !clearLocalSessions)
        }
    }

    private suspend fun forceLogout(keepLocalSessions: Boolean, message: String? = null) {
        streamJob?.cancel()
        container.tokenStore.clear()
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
                val sub = container.client.subscription.me()
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
                        available567Groups = if (groups.isNotEmpty()) groups else it.available567Groups,
                        models = finalModels,
                        selectedModelId = selected,
                        catalogLoading = false,
                        globalError = null,
                    )
                }
            } catch (t: Throwable) {
                _state.update {
                    it.copy(catalogLoading = false, globalError = ErrorMapper.from(t))
                }
            }
        }
    }

    fun newChat() {
        if (container.tokenStore.accessToken == null) {
            openLogin()
            return
        }
        viewModelScope.launch {
            streamJob?.cancel()
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
                        globalError =
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
            if (_state.value.currentSessionId == sessionId) {
                streamJob?.cancel()
            }
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
            container.sessionStore.updateSession(session.copy(title = cleaned))
        }
    }

    fun sendMessage() {
        val text = _state.value.draft.trim()
        val images = _state.value.pendingImages
        if ((text.isEmpty() && images.isEmpty()) || _state.value.isStreaming) return

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
                        it.copy(
                            globalError =
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
            val session = container.sessionStore.getSession(sid) ?: return@launch
            if (session.origin == ConversationOrigin.Cloud && model == null && session.modelId == null) {
                showNoModelError()
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
                    images = images,
                )
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
            _state.update {
                it.copy(draft = "", pendingImages = emptyList(), isStreaming = true, streamingStatus = "running", globalError = null)
            }

            val history =
                container.sessionStore
                    .getMessages(sid)
                    .filter {
                        it.id != assistantId &&
                            it.status != MessageStatus.Error &&
                            it.hasVisualContent
                    }.map { it.toChatMessage() }

            streamJob?.cancel()
            streamJob =
                viewModelScope.launch {
                    var assembled = ""
                    var toolEvents = emptyList<ToolTrace>()
                    var usage: TokenUsage? = null
                    var contextPercent: Int? = null
                    var pendingQuestion: PendingQuestion? = null
                    var hasPublishedDelta = false
                    var pendingPersist: Job? = null

                    suspend fun persistAssistant(status: MessageStatus = MessageStatus.Streaming) {
                        container.sessionStore.upsertMessage(
                            assistantMsg.copy(
                                content = assembled,
                                status = status,
                                toolEvents = toolEvents,
                                usage = usage,
                                contextPercent = contextPercent,
                                pendingQuestion = pendingQuestion,
                            ),
                        )
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
                            )
                            .collect { event ->
                                when (event) {
                                    is ChatStreamEvent.Delta -> {
                                        assembled += event.text
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
                                        pendingQuestion = null
                                        val isImageGen = event.toolName == "generate_image"
                                        val displayLabel = if (isImageGen) "正在绘制画面..." else event.phaseLabel
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

                                        if (isImageGen && event.phase == "call") {
                                            val promptArg = try {
                                                val argsObj = org.vetta.android.core.net.VettaJson.parseToJsonElement(event.arguments.orEmpty()) as? kotlinx.serialization.json.JsonObject
                                                (argsObj?.get("prompt") as? kotlinx.serialization.json.JsonPrimitive)?.content ?: event.arguments.orEmpty()
                                            } catch (_: Exception) {
                                                event.arguments.orEmpty()
                                            }
                                            val imgModel = _state.value.activeImageModel ?: "flux-schnell"
                                            val imgGroup = _state.value.activeImageGroup
                                            viewModelScope.launch {
                                                try {
                                                    val res = container.client.models.generateImage(
                                                        prompt = promptArg,
                                                        model = imgModel,
                                                        groupName = imgGroup,
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

                                                    val updatedTools = mergeToolTrace(
                                                        toolEvents,
                                                        ToolTrace(
                                                            phase = "completed",
                                                            toolCallId = event.toolCallId,
                                                            toolName = "generate_image",
                                                            detail = if (hasValidImage) "画面绘制完成" else resultDesc,
                                                            arguments = promptArg,
                                                            result = resultDesc,
                                                            phaseLabel = if (hasValidImage) "画面绘制完成" else "生图完成",
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
                                                } catch (e: Throwable) {
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
                                                    _state.update {
                                                        it.copy(
                                                            globalError = UiError(
                                                                title = "生图失败",
                                                                message = failMsg,
                                                                action = UiErrorAction.None,
                                                            )
                                                        )
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    is ChatStreamEvent.UserInputRequired -> {
                                        flushPendingPersist()
                                        container.conversationRouter.resolvedRemoteSessionId(session.id)?.let { remoteId ->
                                            container.sessionStore.updateSession(session.copy(remoteSessionId = remoteId))
                                        }
                                        pendingQuestion = PendingQuestion(sid, event.requestId, event.questions)
                                        persistAssistant()
                                        _state.update { it.copy(pendingQuestion = pendingQuestion) }
                                    }
                                    is ChatStreamEvent.State -> {
                                        when (event.value) {
                                            "usage" -> {
                                                flushPendingPersist()
                                                usage = event.usage
                                                contextPercent = event.contextPercent
                                                persistAssistant()
                                            }
                                            "error" ->
                                                _state.update {
                                                    it.copy(
                                                        streamingStatus = null,
                                                        globalError = UiError(title = "桌面执行失败", message = event.detail ?: "请在电脑端检查模型配置和运行日志后重试"),
                                                    )
                                                }
                                            "thinking", "running", "reconnecting" -> _state.update { it.copy(streamingStatus = event.value) }
                                            "retrying", "compacting", "preparing", "background" -> _state.update { it.copy(streamingStatus = event.value) }
                                            "completed", "aborted" -> _state.update { it.copy(streamingStatus = null) }
                                        }
                                    }
                                    is ChatStreamEvent.Finished -> Unit
                                    ChatStreamEvent.Done -> {
                                        flushPendingPersist()
                                        pendingQuestion = null
                                        persistAssistant(MessageStatus.Complete)
                                        _state.update { it.copy(pendingQuestion = null, streamingStatus = null) }
                                    }
                                    is ChatStreamEvent.Error -> {
                                        flushPendingPersist()
                                        pendingQuestion = null
                                        val ui = ErrorMapper.from(event.exception)
                                        container.sessionStore.upsertMessage(
                                            assistantMsg.copy(
                                                content = assembled,
                                                status = MessageStatus.Error,
                                                errorMessage = ui.message,
                                                toolEvents = toolEvents,
                                                usage = usage,
                                                contextPercent = contextPercent,
                                            ),
                                        )
                                        _state.update { it.copy(globalError = ui) }
                                    }
                                }
                            }
                        if (session.origin == ConversationOrigin.Desktop && session.remoteSessionId == null) {
                            container.conversationRouter.resolvedRemoteSessionId(session.id)?.let { remoteId ->
                                container.sessionStore.updateSession(session.copy(remoteSessionId = remoteId))
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
                                latest.copy(
                                    status =
                                        if (t is kotlinx.coroutines.CancellationException) {
                                            MessageStatus.Aborted
                                        } else {
                                            MessageStatus.Error
                                        },
                                    errorMessage = if (t is kotlinx.coroutines.CancellationException) null else ui.message,
                                    usage = usage,
                                    contextPercent = contextPercent,
                                    pendingQuestion = null,
                                ),
                            )
                        }
                        if (t !is kotlinx.coroutines.CancellationException) {
                            _state.update { it.copy(globalError = ui) }
                        }
                    } finally {
                        pendingPersist?.cancel()
                        _state.update { it.copy(isStreaming = false, streamingStatus = null) }
                    }
                }
        }
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
        val index = existing.indexOfFirst { it.toolCallId == next.toolCallId }
        if (index < 0) return existing + next
        return existing.toMutableList().also {
            val previous = it[index]
            it[index] =
                next.copy(
                    detail = next.detail ?: previous.detail,
                    durationMs = next.durationMs ?: previous.durationMs,
                    arguments = next.arguments ?: previous.arguments,
                    result = next.result ?: previous.result,
                    phaseLabel = next.phaseLabel ?: previous.phaseLabel,
                )
        }
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
                    .onFailure { error -> _state.update { it.copy(globalError = ErrorMapper.from(error)) } }
            } finally {
                _state.update { it.copy(isQuestionSubmitting = false) }
            }
        }
    }

    fun stopStreaming() {
        streamJob?.cancel()
        streamJob = null
        val sid = _state.value.currentSessionId ?: return
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
            _state.update { state ->
                state.copy(
                    isStreaming = false,
                    streamingStatus = null,
                    pendingQuestion = state.pendingQuestion?.takeIf { it.sessionId != sid },
                )
            }
        }
    }

    fun retryLastError() {
        val sid = _state.value.currentSessionId ?: return
        viewModelScope.launch {
            val messages = container.sessionStore.getMessages(sid)
            val turn = prepareRetryTurn(messages) ?: return@launch
            container.sessionStore.replaceMessages(sid, turn.remainingMessages)
            drafts[sid] = turn.draft
            // 必须同时恢复图片；否则纯图重试会变成 no-op，图文重试会丢图
            _state.update {
                it.copy(
                    draft = turn.draft,
                    pendingImages = turn.images,
                    globalError = null,
                )
            }
            sendMessage()
        }
    }

    fun handleErrorAction(action: UiErrorAction) {
        when (action) {
            UiErrorAction.Retry -> {
                clearGlobalError()
                if (_state.value.route is AppRoute.Chat) retryLastError() else refreshCatalog()
            }
            UiErrorAction.OpenPlan -> {
                clearGlobalError()
                openPlan()
            }
            UiErrorAction.ReLogin -> {
                clearGlobalError()
                viewModelScope.launch { forceLogout(keepLocalSessions = true) }
            }
            UiErrorAction.OpenSettings -> {
                clearGlobalError()
                openSettings()
            }
            UiErrorAction.None -> clearGlobalError()
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
                draft = draft,
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

    private fun currentModel(): LlmModel? {
        val id = _state.value.selectedModelId
        return _state.value.models.firstOrNull { it.id == id } ?: _state.value.models.firstOrNull()
    }

    private fun showNoModelError() {
        _state.update {
            it.copy(
                globalError =
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

private fun pickDefaultGroup(available: Map<String, org.vetta.android.core.api.ApiGroupInfoDto>): String? {
    val priorityGroups = listOf(
        "chat GPT 特价",
        "chat GPT 满血",
        "反重力Gemini",
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
