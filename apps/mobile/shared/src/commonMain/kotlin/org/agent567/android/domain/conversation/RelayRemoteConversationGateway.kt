package org.agent567.android.domain.conversation

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatQuestion
import org.agent567.android.core.model.ChatQuestionOption
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.LlmModel
import org.agent567.android.core.model.TokenUsage
import org.agent567.android.domain.device.ConnectChannel
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.remote.connection.KtorWebSocketRemoteTransport
import org.agent567.android.domain.remote.connection.PlatformRemoteLogger
import org.agent567.android.domain.remote.connection.RemoteConnection
import org.agent567.android.domain.remote.connection.RemoteConnectionEvent
import org.agent567.android.domain.remote.connection.RemoteConnectionOptions
import org.agent567.android.domain.remote.connection.RemoteConnectionState
import org.agent567.android.domain.remote.connection.RemoteRequestException
import org.agent567.android.domain.remote.protocol.RemoteCapabilities
import org.agent567.android.domain.remote.protocol.RemoteRole
import org.agent567.android.domain.remote.protocol.RemoteEventName
import org.agent567.android.domain.remote.protocol.RemoteError
import org.agent567.android.domain.remote.protocol.RemoteErrorCode
import org.agent567.android.domain.remote.protocol.RemoteRequestMethod
import org.agent567.android.domain.conversation.RemoteSessionModelCatalog
import org.agent567.android.domain.session.MessageStatus

private val RECONNECT_DELAYS_MS = listOf(1_000L, 2_000L, 5_000L, 10_000L, 30_000L)

class RelayRemoteConversationGateway(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val transportFactory: (url: String) -> org.agent567.android.domain.remote.connection.RemoteTransport = { url ->
        KtorWebSocketRemoteTransport(url, scope)
    },
    private val now: () -> Long = { kotlin.time.Clock.System.now().toEpochMilliseconds() },
) : RemoteConversationGateway {
    private val _devices = MutableStateFlow<List<DesktopDevice>>(emptyList())
    private var connection: RemoteConnection? = null
    private var connectionStateJob: Job? = null
    private var metricsJob: Job? = null
    private var reconnectJob: Job? = null
    private var activeTargets: List<String> = emptyList()
    private var connectionGeneration = 0L
    private val remoteSessionIds = mutableMapOf<String, String>()

    override val devices: StateFlow<List<DesktopDevice>> = _devices

    override suspend fun connect(target: String): Boolean = connect(listOf(target))

    override suspend fun connect(targets: List<String>): Boolean {
        require(targets.isNotEmpty()) { "At least one remote target is required" }
        // Invalidate old reconnect work before waiting for cancellation so it
        // cannot publish a stale connection while this connect call takes over.
        connectionGeneration += 1
        val generation = connectionGeneration
        val oldReconnectJob = reconnectJob
        reconnectJob = null
        oldReconnectJob?.cancelAndJoin()
        activeTargets = targets.distinct()
        val old = connection
        connectionStateJob?.cancel()
        connectionStateJob = null
        metricsJob?.cancel()
        metricsJob = null
        old?.close()
        var selectedTarget: String? = null
        var selectedConnection: RemoteConnection? = null
        var lastFailure: Throwable? = null
        for (candidate in activeTargets) {
            val next = createConnection(normalizeRelayUrl(candidate), candidate)
            connection = next
            observeConnection(next, candidate, generation, reconnectEnabled = false)
            try {
                next.connect()
                waitUntilOnline(next)
                selectedTarget = candidate
                selectedConnection = next
                break
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                lastFailure = error
                runCatching { next.close() }
            }
        }
        val next = selectedConnection ?: run {
            connectionStateJob?.cancel()
            connectionStateJob = null
            connection = null
            throw lastFailure ?: RemoteConversationException("无法连接桌面设备")
        }
        val target = requireNotNull(selectedTarget)
        val url = normalizeRelayUrl(target)
        observeConnection(next, target, generation, reconnectEnabled = true)
        val snapshot = next.snapshot()
        val connectedAtEpochMs = now()
        val diagnostics = requestDiagnostics(next)
        _devices.value =
            listOf(
                DesktopDevice(
                    id = snapshot.peerDeviceId ?: "desktop",
                    name = snapshot.peerDeviceId ?: "Desktop",
                    osLabel = diagnostics?.osLabel ?: "Desktop",
                    host = url,
                    status = DeviceStatus.Online,
                    channel = ConnectChannel.Remote,
                    latencyMs = next.snapshot().lastRttMs?.toIntOrNull(),
                    connectedDuration = formatConnectionDuration(now() - connectedAtEpochMs),
                    cpu = diagnostics?.cpu,
                    ram = diagnostics?.ram,
                ),
            )
        metricsJob = scope.launch {
            var nextDiagnosticsAt = now() + METRICS_DIAGNOSTICS_INTERVAL_MS
            var latestDiagnostics = diagnostics
            while (isActive) {
                val current = connection ?: break
                if (current.state.value == RemoteConnectionState.Online && now() >= nextDiagnosticsAt) {
                    requestDiagnostics(current)?.let { latestDiagnostics = it }
                    nextDiagnosticsAt = now() + METRICS_DIAGNOSTICS_INTERVAL_MS
                }
                val latest = current.snapshot()
                _devices.updateMetrics(
                    connectedDuration = formatConnectionDuration(now() - connectedAtEpochMs),
                    latencyMs = latest.lastRttMs?.toIntOrNull(),
                    diagnostics = latestDiagnostics,
                )
                delay(METRICS_REFRESH_INTERVAL_MS)
            }
        }
        return true
    }

    override suspend fun disconnect(deviceId: String) {
        connectionGeneration += 1
        activeTargets = emptyList()
        val oldReconnectJob = reconnectJob
        reconnectJob = null
        oldReconnectJob?.cancelAndJoin()
        connectionStateJob?.cancel()
        connectionStateJob = null
        metricsJob?.cancel()
        metricsJob = null
        connection?.close()
        connection = null
        remoteSessionIds.clear()
        _devices.value = emptyList()
    }

    override suspend fun listDesktopSessions(deviceId: String): List<RemoteDesktopSessionSummary>? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online) return null
        if (_devices.value.none { it.id == deviceId }) return null
        val payload = active.request(RemoteRequestMethod.SessionList) as? JsonObject
            ?: throw RemoteConversationException("电脑没有返回会话列表")
        return (payload["sessions"] as? JsonArray).orEmpty().mapNotNull { value ->
            val item = value as? JsonObject ?: return@mapNotNull null
            val id = item.stringValue("id")?.takeIf(String::isNotBlank) ?: return@mapNotNull null
            RemoteDesktopSessionSummary(
                id = id,
                title = item.stringValue("title")?.takeIf(String::isNotBlank) ?: "电脑会话",
                updatedAtEpochMs = item.longValue("updatedAtEpochMs") ?: now(),
            )
        }
    }

    override suspend fun deleteDesktopSession(deviceId: String, remoteSessionId: String): Boolean? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online) return null
        if (_devices.value.none { it.id == deviceId }) return null
        active.request(RemoteRequestMethod.SessionDelete, sessionId = remoteSessionId)
        remoteSessionIds.entries.removeAll { it.value == remoteSessionId }
        return true
    }

    override suspend fun readDesktopSessionHistory(
        localSessionId: String,
        remoteSessionId: String,
    ): List<RemoteDesktopHistoryMessage>? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online) return null
        val opened = active.request(RemoteRequestMethod.SessionOpen, sessionId = remoteSessionId)
        val resolvedId = (opened as? JsonObject)?.get("sessionId")?.jsonPrimitive?.contentOrNull ?: remoteSessionId
        remoteSessionIds[localSessionId] = resolvedId
        val messages = mutableListOf<RemoteDesktopHistoryMessage>()
        var offset = 0
        while (true) {
            val page = try {
                active.request(
                    method = RemoteRequestMethod.SessionHistory,
                    payload = buildJsonObject {
                        put("offset", offset)
                        put("limit", HISTORY_PAGE_SIZE)
                    },
                    sessionId = resolvedId,
                    timeoutMs = LEGACY_SESSION_CREATE_TIMEOUT_MS,
                ) as? JsonObject ?: throw RemoteConversationException("电脑没有返回会话记录")
            } catch (error: RemoteRequestException) {
                if (error.remoteError.code == RemoteErrorCode.RequestTimeout) {
                    throw RemoteConversationException("当前电脑端版本暂不支持读取历史会话，请升级后再试")
                }
                throw error
            }
            val rawMessages = (page["messages"] as? JsonArray).orEmpty()
            val pageMessages = rawMessages.mapNotNull { value ->
                val item = value as? JsonObject ?: return@mapNotNull null
                val role = when (item.stringValue("role")) {
                    "user" -> ChatRole.User
                    "assistant" -> ChatRole.Assistant
                    else -> return@mapNotNull null
                }
                val text = item.stringValue("text").orEmpty()
                if (text.isBlank()) return@mapNotNull null
                RemoteDesktopHistoryMessage(
                    id = item.stringValue("id")?.takeIf(String::isNotBlank) ?: "${item.longValue("timestamp") ?: offset}",
                    role = role,
                    text = text,
                    timestamp = item.longValue("timestamp") ?: now(),
                    status = if (item["failed"]?.jsonPrimitive?.booleanOrNull == true) MessageStatus.Error else MessageStatus.Complete,
                )
            }
            messages += pageMessages
            offset += rawMessages.size
            if (rawMessages.size < HISTORY_PAGE_SIZE) break
        }
        return messages
    }

    override suspend fun createDesktopSession(
        localSessionId: String,
        deviceId: String,
    ): Pair<String, RemoteSessionModelCatalog>? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online) return null
        val payload = try {
            active.request(
                method = RemoteRequestMethod.SessionCreate,
                timeoutMs = LEGACY_SESSION_CREATE_TIMEOUT_MS,
            )
        } catch (error: RemoteRequestException) {
            // Older desktops ignore unknown request methods. Fall back to the
            // protocol-v1 implicit session creation performed by session.prompt.
            if (error.remoteError.code == RemoteErrorCode.RequestTimeout) return null
            throw error
        }
        val response = payload?.jsonObject ?: throw RemoteConversationException("桌面没有返回会话信息")
        val remoteId = response["sessionId"]?.jsonPrimitive?.contentOrNull
            ?: throw RemoteConversationException("桌面没有返回会话编号")
        remoteSessionIds[localSessionId] = remoteId
        return remoteId to parseModelCatalog(response["modelCatalog"])
    }

    override suspend fun readDesktopSessionModels(
        localSessionId: String,
        remoteSessionId: String,
    ): RemoteSessionModelCatalog? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online) return null
        val opened = active.request(method = RemoteRequestMethod.SessionOpen, sessionId = remoteSessionId)
        val resolvedId = (opened as? JsonObject)?.get("sessionId")?.jsonPrimitive?.contentOrNull ?: remoteSessionId
        remoteSessionIds[localSessionId] = resolvedId
        val modelPayload = try {
            active.request(
                method = RemoteRequestMethod.SessionModels,
                sessionId = resolvedId,
                timeoutMs = LEGACY_SESSION_CREATE_TIMEOUT_MS,
            )
        } catch (error: RemoteRequestException) {
            if (error.remoteError.code == RemoteErrorCode.RequestTimeout) return null
            throw error
        }
        return parseModelCatalog(modelPayload)
    }

    override suspend fun selectDesktopSessionModel(
        localSessionId: String,
        remoteSessionId: String,
        modelId: String,
    ): RemoteSessionModelCatalog? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online) return null
        val opened = active.request(method = RemoteRequestMethod.SessionOpen, sessionId = remoteSessionId)
        val resolvedId = (opened as? JsonObject)?.get("sessionId")?.jsonPrimitive?.contentOrNull ?: remoteSessionId
        remoteSessionIds[localSessionId] = resolvedId
        val payload = buildJsonObject { put("modelKey", modelId) }
        return parseModelCatalog(
            active.request(
                method = RemoteRequestMethod.SessionModelSelect,
                payload = payload,
                sessionId = resolvedId,
                timeoutMs = LEGACY_SESSION_CREATE_TIMEOUT_MS,
            ),
        )
    }

    override suspend fun readDesktopPromptSuggestions(
        localSessionId: String,
        remoteSessionId: String,
    ): List<String>? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online) return null
        val resolvedId = remoteSessionIds[localSessionId] ?: run {
            val opened = active.request(method = RemoteRequestMethod.SessionOpen, sessionId = remoteSessionId)
            (opened as? JsonObject)?.get("sessionId")?.jsonPrimitive?.contentOrNull ?: remoteSessionId
        }
        remoteSessionIds[localSessionId] = resolvedId
        return try {
            val payload = active.request(
                method = RemoteRequestMethod.SessionSuggestions,
                sessionId = resolvedId,
                timeoutMs = LEGACY_SESSION_CREATE_TIMEOUT_MS,
            ) as? JsonObject ?: return emptyList()
            (payload["suggestions"] as? JsonArray).orEmpty().mapNotNull { item ->
                item.jsonPrimitive.contentOrNull?.takeIf(String::isNotBlank)
            }.take(3)
        } catch (error: RemoteRequestException) {
            if (error.remoteError.code == RemoteErrorCode.RequestTimeout) emptyList() else throw error
        }
    }

    private fun createConnection(url: String, target: String): RemoteConnection =
        RemoteConnection(
            transport = transportFactory(url),
            options =
                RemoteConnectionOptions(
                    role = RemoteRole.Mobile,
                    deviceId = "mobile-${activeTargets.firstOrNull()?.hashCode()?.toUInt()?.toString(16) ?: target.hashCode().toUInt().toString(16)}",
                    deviceName = "567 Agent Mobile",
                    capabilities = RemoteCapabilities(chat = true, sessionRead = true),
                    connectionId = "mobile-${kotlin.random.Random.nextLong().toULong().toString(16)}",
                ),
            scope = scope,
            logger = PlatformRemoteLogger,
            now = now,
        )

    private fun observeConnection(
        next: RemoteConnection,
        target: String,
        generation: Long,
        reconnectEnabled: Boolean,
    ) {
        connectionStateJob?.cancel()
        connectionStateJob = scope.launch {
            next.state.collect { state ->
                if (connection !== next || generation != connectionGeneration) return@collect
                val status =
                    when (state) {
                        RemoteConnectionState.Online -> DeviceStatus.Online
                        RemoteConnectionState.Connecting,
                        RemoteConnectionState.Reconnecting,
                        RemoteConnectionState.Recovering,
                        -> DeviceStatus.Connecting
                        RemoteConnectionState.Idle -> DeviceStatus.Connecting
                        RemoteConnectionState.Closed,
                        RemoteConnectionState.Failed,
                        -> DeviceStatus.Offline
                    }
                _devices.updateStatus(status)
                if (reconnectEnabled && (state == RemoteConnectionState.Reconnecting || state == RemoteConnectionState.Failed)) {
                    scheduleReconnect(target, generation)
                }
            }
        }
    }

    private fun scheduleReconnect(target: String, generation: Long) {
        if (reconnectJob?.isActive == true || generation != connectionGeneration) return
        reconnectJob = scope.launch {
            var delayIndex = 0
            while (true) {
                val delayMs = RECONNECT_DELAYS_MS[delayIndex.coerceAtMost(RECONNECT_DELAYS_MS.lastIndex)]
                delay(delayMs)
                if (generation != connectionGeneration || target !in activeTargets) return@launch
                val previous = connection
                runCatching { previous?.close() }
                var reconnected = false
                for (candidate in activeTargets) {
                    if (generation != connectionGeneration || candidate !in activeTargets) return@launch
                    val next = createConnection(normalizeRelayUrl(candidate), candidate)
                    connection = next
                    observeConnection(next, candidate, generation, reconnectEnabled = false)
                    try {
                        next.connect()
                        waitUntilOnline(next)
                        if (connection === next && generation == connectionGeneration) {
                            observeConnection(next, candidate, generation, reconnectEnabled = true)
                            _devices.update { devices ->
                                devices.map { it.copy(host = normalizeRelayUrl(candidate), status = DeviceStatus.Online) }
                            }
                            reconnected = true
                            break
                        }
                    } catch (error: Throwable) {
                        if (error is CancellationException) throw error
                        runCatching { next.close() }
                    }
                }
                if (reconnected) {
                    // Keep the completed Job reference until its body has
                    // actually returned. Clearing it here opens a tiny window
                    // where a concurrent state event can start a duplicate loop.
                    return@launch
                }
                _devices.updateStatus(DeviceStatus.Connecting)
                delayIndex += 1
            }
        }
    }

    override fun stream(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
        retryPreviousTurn: Boolean,
    ): Flow<ChatStreamEvent> =
        channelFlow {
            val active = connection ?: throw RemoteConversationException("请先连接桌面设备")
            if (active.state.value != RemoteConnectionState.Online) {
                throw RemoteConversationException("桌面连接正在恢复，请稍后重试")
            }
            val terminal = CompletableDeferred<ChatStreamEvent.State>()
            var transportStateSent = false
            suspend fun emitTransportState() {
                if (transportStateSent) return
                transportStateSent = true
                send(
                    ChatStreamEvent.State(
                        value = "reconnecting",
                        detail = "桌面连接正在恢复",
                        detailCode = "transport_closed",
                    ),
                )
            }
            val connectionJob = launch(start = CoroutineStart.UNDISPATCHED) {
                // RemoteConnection does not own a reconnect loop. Once the transport
                // enters recovery, keeping the turn open would leave the user with an
                // endless spinner and no way to answer or retry. End the current turn
                // explicitly; a later connection can resume the session from history.
                active.state.first {
                    it == RemoteConnectionState.Reconnecting ||
                        it == RemoteConnectionState.Closed ||
                        it == RemoteConnectionState.Failed
                }
                emitTransportState()
                terminal.complete(
                    ChatStreamEvent.State(
                        value = "error",
                        detail = "桌面连接已断开，请重新连接后再试",
                        detailCode = "transport_closed",
                    ),
                )
            }
            val eventJob = launch(start = CoroutineStart.UNDISPATCHED) {
					active.events
						.filterIsInstance<RemoteConnectionEvent.EventReceived>()
						.mapNotNull { event ->
                            val expectedSessionId = remoteSessionId ?: remoteSessionIds[localSessionId]
                            if (expectedSessionId != null && event.event.sessionId != expectedSessionId) return@mapNotNull null
                            event.event.sessionId?.let { remoteSessionIds[localSessionId] = it }
							decodeConversationEvent(event.event.name, event.event.payload)
						}.collect { event ->
                            send(event)
                            if (event is ChatStreamEvent.State && event.value in TERMINAL_REMOTE_STATES) terminal.complete(event)
                        }
            }

            try {
                var retryTargetMessageId: String? = null
                if (retryPreviousTurn) {
                    val targetSessionId = remoteSessionId ?: remoteSessionIds[localSessionId]
                    if (targetSessionId != null) {
                        val latestCatalog = try {
                            parseModelCatalog(
                                active.request(
                                    method = RemoteRequestMethod.SessionModels,
                                    sessionId = targetSessionId,
                                    timeoutMs = LEGACY_SESSION_CREATE_TIMEOUT_MS,
                                ),
                            )
                        } catch (error: RemoteRequestException) {
                            if (error.remoteError.code != RemoteErrorCode.RequestTimeout) throw error
                            throw RemoteConversationException("当前电脑端版本不支持安全重试，请更新电脑端后再试")
                        }
                        retryTargetMessageId = latestCatalog.lastUserMessageId
                        if (retryTargetMessageId == null) {
                            throw RemoteConversationException("电脑端没有提供可校验的重试目标，请更新电脑端后再试")
                        }
                    }
                }
                val payload = buildJsonObject {
                    put("text", messages.lastOrNull()?.textContent.orEmpty())
                    if (retryPreviousTurn) {
                        put("retryPreviousTurn", true)
                        retryTargetMessageId?.let { put("retryTargetMessageId", it) }
                    }
                }
                val result = try {
                    active.request(
                        method = org.agent567.android.domain.remote.protocol.RemoteRequestMethod.SessionPrompt,
                        payload = payload,
                        sessionId = remoteSessionId ?: remoteSessionIds[localSessionId],
                    )
                } catch (error: Throwable) {
                    if (
                        active.state.value == RemoteConnectionState.Reconnecting ||
                            active.state.value == RemoteConnectionState.Closed ||
                            (error is RemoteRequestException && error.remoteError.code == RemoteErrorCode.TransportClosed)
                    ) {
                        emitTransportState()
                    }
                    throw error
                }
                result?.jsonObject?.get("sessionId")?.jsonPrimitive?.content?.let {
                    remoteSessionIds[localSessionId] = it
                }
                _devices.updateLatency(active.snapshot().lastRttMs?.toIntOrNull())
                val finalState = terminal.await()
                if (finalState.value == "error") {
                    throw RemoteRequestException(
                        RemoteError(
                            code = finalState.detailCode.toRemoteErrorCode(),
                            message = finalState.detail ?: "桌面执行失败",
                            retryable = finalState.detailCode == "request_timeout" || finalState.detailCode == "busy",
                        ),
                    )
                }
                if (finalState.value != "aborted") send(ChatStreamEvent.Done)
            } finally {
                eventJob.cancel()
                connectionJob.cancel()
            }
        }

    override fun resolvedRemoteSessionId(localSessionId: String): String? = remoteSessionIds[localSessionId]

    override suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?) {
        connection?.request(
            method = org.agent567.android.domain.remote.protocol.RemoteRequestMethod.SessionAbort,
            sessionId = remoteSessionId ?: remoteSessionIds[localSessionId],
        )
    }

    override suspend fun respond(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        requestId: String,
        answers: List<Pair<String, List<String>>>,
        cancelled: Boolean,
    ) {
        val active = connection ?: throw RemoteConversationException("请先连接桌面设备")
        val payload = buildJsonObject {
            put("requestId", requestId)
            put("cancelled", cancelled)
            put("answers", kotlinx.serialization.json.buildJsonArray {
                answers.forEach { (question, selected) ->
                    add(buildJsonObject {
                        put("question", question)
                        put("answers", kotlinx.serialization.json.buildJsonArray { selected.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
                    })
                }
            })
        }
        active.request(
            method = RemoteRequestMethod.SessionRespond,
            payload = payload,
            sessionId = remoteSessionId ?: remoteSessionIds[localSessionId],
        )
    }

    private suspend fun waitUntilOnline(connection: RemoteConnection) {
        val connected = withTimeoutOrNull(3_000) {
            connection.state.first { it == RemoteConnectionState.Online }
        }
        if (connected == null) throw RemoteConversationException("等待桌面连接超时")
    }

    private suspend fun requestDiagnostics(connection: RemoteConnection): DeviceDiagnostics? {
        return try {
            connection
                .request(method = org.agent567.android.domain.remote.protocol.RemoteRequestMethod.DiagnosticsSnapshot)
                .toDeviceDiagnostics()
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            null
        }
    }

    private fun normalizeRelayUrl(target: String): String {
        val value = target.trim()
        if (value.startsWith("wss://")) return value
        if (value.startsWith("ws://")) return value.replaceFirst("ws://", "wss://")
        if (value.startsWith("https://")) return value.replaceFirst("https://", "wss://")
        if (value.startsWith("http://")) return value.replaceFirst("http://", "wss://")
        val separator = value.indexOf('#')
        val host = if (separator >= 0) value.substring(0, separator) else value
        val pairing = if (separator >= 0) value.substring(separator + 1) else "default"
        return "wss://$host/relay/$pairing/mobile"
    }

    private fun MutableStateFlow<List<DesktopDevice>>.updateStatus(status: DeviceStatus) {
        update { devices -> devices.map { device -> device.copy(status = status) } }
    }

    private fun MutableStateFlow<List<DesktopDevice>>.updateLatency(latencyMs: Int?) {
        if (latencyMs == null) return
        update { devices -> devices.map { device -> device.copy(latencyMs = latencyMs) } }
    }

    private fun MutableStateFlow<List<DesktopDevice>>.updateMetrics(
        connectedDuration: String,
        latencyMs: Int?,
        diagnostics: DeviceDiagnostics?,
    ) {
        update { devices ->
            devices.map { device ->
                device.copy(
                    connectedDuration = connectedDuration,
                    latencyMs = latencyMs ?: device.latencyMs,
                    osLabel = diagnostics?.osLabel ?: device.osLabel,
                    cpu = diagnostics?.cpu ?: device.cpu,
                    ram = diagnostics?.ram ?: device.ram,
                )
            }
        }
    }
}

private fun parseModelCatalog(element: JsonElement?): RemoteSessionModelCatalog {
    val root = element as? JsonObject ?: return RemoteSessionModelCatalog(currentModelId = null, models = emptyList())
    val currentModelId = root["currentModelId"]?.jsonPrimitive?.contentOrNull
    val models = (root["models"] as? JsonArray).orEmpty().mapNotNull { value ->
        val model = value as? JsonObject ?: return@mapNotNull null
        val id = model["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
        val modelId = model["modelId"]?.jsonPrimitive?.contentOrNull ?: id.substringAfter('/', id)
        val providerName = model["providerName"]?.jsonPrimitive?.contentOrNull ?: id.substringBefore('/', "Desktop")
        val input = (model["input"] as? JsonArray).orEmpty().mapNotNull { it.jsonPrimitive.contentOrNull }
        val reasoningLevels = (model["reasoningLevels"] as? JsonArray).orEmpty().mapNotNull { it.jsonPrimitive.contentOrNull }
        LlmModel(
            id = id,
            modelId = modelId,
            name = model["name"]?.jsonPrimitive?.contentOrNull ?: modelId,
            providerName = providerName,
            reasoning = model["reasoning"]?.jsonPrimitive?.booleanOrNull ?: false,
            input = input,
            contextWindow = model["contextWindow"]?.jsonPrimitive?.longOrNull,
            maxTokens = model["maxTokens"]?.jsonPrimitive?.longOrNull,
            reasoningLevels = reasoningLevels,
            defaultReasoningLevel = model["defaultReasoningLevel"]?.jsonPrimitive?.contentOrNull,
        )
    }
    return RemoteSessionModelCatalog(
        currentModelId = currentModelId,
        models = models,
        lastUserMessageId = root["lastUserMessageId"]?.jsonPrimitive?.contentOrNull,
    )
}

private fun decodeConversationEvent(name: RemoteEventName, payload: JsonElement?): ChatStreamEvent? {
	val objectValue = payload as? JsonObject ?: return null
	return when (name) {
		RemoteEventName.SessionMessage -> objectValue.stringValue("text")?.let(ChatStreamEvent::Delta)
		RemoteEventName.SessionTool -> {
			val phase = objectValue.stringValue("phase") ?: return null
			val callId = objectValue.stringValue("toolCallId") ?: return null
			val toolName = objectValue.stringValue("toolName") ?: "tool"
			val arguments = objectValue.stringValue("args")
			val result = objectValue.stringValue("result")
            ChatStreamEvent.Tool(
                phase = phase,
                toolCallId = callId,
                toolName = toolName,
                detail = result ?: arguments,
                durationMs = objectValue.longValue("durationMs"),
                arguments = arguments,
                result = result,
                phaseLabel = objectValue.stringValue("label"),
            )
		}
		RemoteEventName.SessionInput -> {
			if (objectValue.stringValue("kind") != "question") return null
			val requestId = objectValue.stringValue("requestId") ?: return null
			val questions = (objectValue["questions"] as? JsonArray).orEmpty().mapNotNull { item ->
				val question = item as? JsonObject ?: return@mapNotNull null
				val options = (question["options"] as? JsonArray).orEmpty().mapNotNull { raw ->
					val option = raw as? JsonObject ?: return@mapNotNull null
					val label = option.stringValue("label") ?: return@mapNotNull null
					ChatQuestionOption(label, option.stringValue("description").orEmpty())
				}
				ChatQuestion(question.stringValue("question") ?: return@mapNotNull null, question.stringValue("header").orEmpty(), options, question["multiSelect"]?.jsonPrimitive?.booleanOrNull ?: false)
			}
			ChatStreamEvent.UserInputRequired(requestId, questions)
		}
        RemoteEventName.SessionState -> {
            val state = objectValue.stringValue("state") ?: "unknown"
            ChatStreamEvent.State(
                value = state,
                detail = objectValue.stringValue("message") ?: objectValue.stringValue("text"),
                detailCode = objectValue.stringValue("code"),
                usage = if (state == "usage") {
                    TokenUsage(
                        promptTokens = objectValue.longValue("input")?.toIntOrNull(),
                        completionTokens = objectValue.longValue("output")?.toIntOrNull(),
                        totalTokens = objectValue.longValue("total")?.toIntOrNull(),
                    )
                } else null,
                contextPercent = objectValue.longValue("contextPercent")?.toIntOrNull(),
            )
        }
		else -> null
	}
}

private fun JsonObject.stringValue(key: String): String? = get(key)?.jsonPrimitive?.contentOrNull
private fun JsonObject.longValue(key: String): Long? = get(key)?.jsonPrimitive?.longOrNull

private val TERMINAL_REMOTE_STATES = setOf("completed", "error", "aborted")

private fun String?.toRemoteErrorCode(): RemoteErrorCode =
    when (this) {
        "unauthorized" -> RemoteErrorCode.Unauthorized
        "not_found" -> RemoteErrorCode.NotFound
        "busy" -> RemoteErrorCode.Busy
        "request_timeout" -> RemoteErrorCode.RequestTimeout
        "transport_closed" -> RemoteErrorCode.TransportClosed
        "invalid_frame" -> RemoteErrorCode.InvalidFrame
        "unsupported_version" -> RemoteErrorCode.UnsupportedVersion
        else -> RemoteErrorCode.InternalError
    }

private const val METRICS_REFRESH_INTERVAL_MS = 1_000L
private const val LEGACY_SESSION_CREATE_TIMEOUT_MS = 1_500L
private const val METRICS_DIAGNOSTICS_INTERVAL_MS = 5_000L
private const val HISTORY_PAGE_SIZE = 100

private data class DeviceDiagnostics(
    val osLabel: String?,
    val cpu: String?,
    val ram: String?,
)

private fun JsonElement?.toDeviceDiagnostics(): DeviceDiagnostics? {
    val objectValue = this as? JsonObject ?: return null
    return DeviceDiagnostics(
        osLabel = objectValue.stringValue("osLabel"),
        cpu = objectValue.stringValue("cpu"),
        ram = objectValue.stringValue("ram"),
    )
}

private fun Long.toIntOrNull(): Int? = takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()

private fun formatConnectionDuration(elapsedMs: Long): String {
    val totalSeconds = (elapsedMs.coerceAtLeast(0) / 1_000).coerceAtLeast(1)
    val hours = totalSeconds / 3_600
    val minutes = (totalSeconds % 3_600) / 60
    val seconds = totalSeconds % 60
    return when {
        hours > 0 -> "${hours}时${minutes}分"
        minutes > 0 -> "${minutes}分${seconds}秒"
        else -> "${seconds}秒"
    }
}
