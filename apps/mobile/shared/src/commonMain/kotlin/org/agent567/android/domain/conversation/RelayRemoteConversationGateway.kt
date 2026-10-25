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
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import org.agent567.android.data.session.sha256MigrationArchive
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatContentPart
import org.agent567.android.core.model.ChatQuestion
import org.agent567.android.core.model.ChatQuestionOption
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.RemoteGeneratedImageRef
import org.agent567.android.core.model.LlmModel
import org.agent567.android.core.model.TokenUsage
import org.agent567.android.ui.i18n.Str
import org.agent567.android.domain.device.ConnectChannel
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.remote.connection.KtorWebSocketRemoteTransport
import org.agent567.android.domain.remote.connection.PlatformRemoteLogger
import org.agent567.android.domain.remote.connection.RemoteConnection
import org.agent567.android.domain.remote.connection.RemoteConnectionEvent
import org.agent567.android.domain.remote.connection.RemoteConnectionOptions
import org.agent567.android.domain.remote.connection.RemoteConnectionState
import org.agent567.android.domain.remote.connection.RemoteEventCursor
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
private const val PROMPT_ATTACHMENT_MAX_COUNT = 10
private const val PROMPT_ATTACHMENT_MAX_TOTAL_BYTES = 48 * 1024 * 1024

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
    private var connectionTarget: String? = null
    private val eventCursors = MutableStateFlow<Map<String, RemoteEventCursor>>(emptyMap())
    private val remoteSessionIds = mutableMapOf<String, String>()
    private var migrationTransferCounter = 0L

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
        rememberEventCursor(old, connectionTarget)
        var selectedTarget: String? = null
        var selectedConnection: RemoteConnection? = null
        var lastFailure: Throwable? = null
        var attemptNumber = 0
        for (candidate in activeTargets) {
            val targetKind = remoteTargetKind(candidate)
            val maxAttempts = if (targetKind == "lan") 2 else 1
            for (retry in 0 until maxAttempts) {
                attemptNumber += 1
                var phase = "websocket_connect"
                val next = createConnection(normalizeRelayUrl(candidate), candidate)
                connection = next
                observeConnection(next, candidate, generation, reconnectEnabled = false)
                PlatformRemoteLogger.info(
                    "remote connection attempt started",
                    mapOf("attempt" to attemptNumber, "target" to targetKind, "retry" to retry),
                )
                try {
                    next.connect()
                    phase = "hello_ack"
                    waitUntilOnline(next)
                    PlatformRemoteLogger.info(
                        "remote connection attempt succeeded",
                        mapOf("attempt" to attemptNumber, "target" to targetKind, "retry" to retry),
                    )
                    selectedTarget = candidate
                    selectedConnection = next
                    break
                } catch (error: Throwable) {
                    if (error is CancellationException) throw error
                    lastFailure = error
                    PlatformRemoteLogger.warn(
                        "remote connection attempt failed",
                        mapOf(
                            "attempt" to attemptNumber,
                            "target" to targetKind,
                            "phase" to phase,
                            "retry" to retry,
                            "errorType" to error::class.simpleName,
                            "error" to safeRemoteConnectionError(error),
                        ),
                    )
                    runCatching { next.close() }
                    if (retry + 1 < maxAttempts && isLanStartupRace(error)) delay(LAN_STARTUP_RETRY_DELAY_MS)
                    else break
                }
            }
            if (selectedConnection != null) break
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
                    connectedDuration = org.agent567.android.ui.formatting.formatElapsedDuration(now() - connectedAtEpochMs),
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
                    connectedDuration = org.agent567.android.ui.formatting.formatElapsedDuration(now() - connectedAtEpochMs),
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
        eventCursors.value = emptyMap()
        _devices.value = emptyList()
    }

    override suspend fun listDesktopSessions(deviceId: String): List<RemoteDesktopSessionSummary>? {
        return readDesktopSessionCatalog(deviceId)?.sessions
    }

    override suspend fun readDesktopSessionCatalog(deviceId: String): RemoteDesktopSessionCatalog? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online) return null
        if (_devices.value.none { it.id == deviceId }) return null
        val payload = active.request(RemoteRequestMethod.SessionList) as? JsonObject
            ?: throw RemoteConversationException("电脑没有返回会话列表")
        updatePeerSupportedMethods(active, payload)
        val sessions = (payload["sessions"] as? JsonArray).orEmpty().mapNotNull { value ->
            val item = value as? JsonObject ?: return@mapNotNull null
            val id = item.stringValue("id")?.takeIf(String::isNotBlank) ?: return@mapNotNull null
            RemoteDesktopSessionSummary(
                id = id,
                title = item.stringValue("title")?.takeIf(String::isNotBlank) ?: "电脑会话",
                updatedAtEpochMs = item.longValue("updatedAtEpochMs") ?: now(),
            )
        }
        return RemoteDesktopSessionCatalog(
            sessions = sessions,
            failedDirectoryCount = payload.intValue("failedRootCount")?.coerceAtLeast(0) ?: 0,
        )
    }

    override suspend fun readDesktopToolbox(deviceId: String): List<RemoteToolboxAbility>? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online || _devices.value.none { it.id == deviceId }) return null
        val sessionCatalog = active.request(RemoteRequestMethod.SessionList) as? JsonObject
            ?: throw RemoteConversationException("电脑没有返回能力信息")
        updatePeerSupportedMethods(active, sessionCatalog)
        if (!active.supportsPeerMethod("toolbox.list")) {
            throw RemoteConversationException("请更新电脑端后使用手机工具箱")
        }
        val payload = active.request(RemoteRequestMethod.ToolboxList) as? JsonObject
            ?: throw RemoteConversationException("电脑没有返回工具箱目录")
        return (payload["abilities"] as? JsonArray).orEmpty().mapNotNull { value ->
            val item = value as? JsonObject ?: return@mapNotNull null
            val slug = item.stringValue("slug")?.takeIf(String::isNotBlank) ?: return@mapNotNull null
            RemoteToolboxAbility(
                slug = slug,
                type = item.stringValue("type").orEmpty(),
                name = item.stringValue("name") ?: slug,
                description = item.stringValue("description").orEmpty(),
                version = item.stringValue("version").orEmpty(),
                author = item.stringValue("author").orEmpty(),
                category = item.stringValue("category").orEmpty(),
                tags = (item["tags"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
                installable = item["installable"]?.jsonPrimitive?.booleanOrNull ?: false,
                installed = item["installed"]?.jsonPrimitive?.booleanOrNull ?: false,
            )
        }
    }

    override suspend fun installDesktopToolboxAbility(deviceId: String, type: String, slug: String): Boolean? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online || _devices.value.none { it.id == deviceId }) return null
        if (!active.supportsPeerMethod("toolbox.install")) {
            throw RemoteConversationException("请更新电脑端后使用手机工具箱安装")
        }
        active.request(
            method = RemoteRequestMethod.ToolboxInstall,
            payload = buildJsonObject {
                put("type", type)
                put("slug", slug)
            },
        )
        return true
    }

    override suspend fun deleteDesktopSession(deviceId: String, remoteSessionId: String): Boolean? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online) return null
        if (_devices.value.none { it.id == deviceId }) return null
        active.request(RemoteRequestMethod.SessionDelete, sessionId = remoteSessionId)
        remoteSessionIds.entries.removeAll { it.value == remoteSessionId }
        return true
    }

    override suspend fun deleteEmptyDesktopSession(deviceId: String, remoteSessionId: String): Boolean? {
        val active = connection ?: return null
        if (_devices.value.none { it.id == deviceId } || active.state.value != RemoteConnectionState.Online) return null
        if (!active.supportsPeerMethod("session.delete.empty")) return false
        val result = active.request(RemoteRequestMethod.SessionDeleteEmpty, sessionId = remoteSessionId) as? JsonObject
        if (result?.get("deleted")?.jsonPrimitive?.booleanOrNull != true) return false
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
                requestHistoryPage(active, resolvedId, offset, retryFirstPageTimeout = offset == 0)
            } catch (error: RemoteRequestException) {
                if (error.remoteError.code == RemoteErrorCode.RequestTimeout) {
                    throw RemoteConversationException("读取电脑会话超时，请确认连接后重试；如果桌面端版本较旧，请更新后再试")
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
                val sourceText = item.stringValue("text").orEmpty()
                val text = if (item["truncated"]?.jsonPrimitive?.booleanOrNull == true) {
                    sourceText + "\n\n" + Str.remoteHistoryTruncated
                } else sourceText
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
            val hasMore = page["hasMore"]?.jsonPrimitive?.booleanOrNull
            if (hasMore != null) {
                if (!hasMore) break
                val nextOffset = page["nextOffset"]?.jsonPrimitive?.intOrNull
                if (rawMessages.isEmpty() || nextOffset != offset + rawMessages.size || nextOffset <= offset) {
                    throw RemoteConversationException(Str.remoteHistoryInvalidPage)
                }
                offset = nextOffset
            } else {
                offset += rawMessages.size
                if (rawMessages.size < HISTORY_PAGE_SIZE) break
            }
        }
        return messages
    }

    override suspend fun readDesktopGeneratedImageChunk(
        localSessionId: String,
        remoteSessionId: String,
        imageId: String,
        offset: Int,
        length: Int,
    ): RemoteDesktopImageChunk? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online) return null
        if (imageId.isBlank() || offset < 0 || length !in 1..(48 * 1024)) return null
        if (!active.supportsPeerMethod("session.image.read")) {
            val methods = active.request(RemoteRequestMethod.SessionList) as? JsonObject ?: return null
            updatePeerSupportedMethods(active, methods)
            if (!active.supportsPeerMethod("session.image.read")) return null
        }
        val resolvedId = remoteSessionIds[localSessionId] ?: remoteSessionId
        val response = active.request(
            method = RemoteRequestMethod.SessionImageRead,
            sessionId = resolvedId,
            payload = buildJsonObject {
                put("imageId", imageId)
                put("offset", offset)
                put("length", length)
            },
            timeoutMs = REMOTE_IMAGE_CHUNK_TIMEOUT_MS,
        ) as? JsonObject ?: return null
        val size = response.intValue("sizeBytes") ?: return null
        if (size !in 1..REMOTE_IMAGE_MAX_BYTES) return null
        return RemoteDesktopImageChunk(
            mimeType = response.stringValue("mimeType")?.takeIf { it.startsWith("image/") } ?: "image/png",
            sizeBytes = size,
            dataBase64 = response.stringValue("dataBase64") ?: return null,
        )
    }

    @OptIn(ExperimentalEncodingApi::class)
    override suspend fun sendEncryptedSessionMigrationArchive(
        deviceId: String,
        archive: ByteArray,
        passphrase: String,
        onAwaitingApproval: () -> Unit,
        onProgress: (completedChunks: Int, totalChunks: Int) -> Unit,
    ): Boolean? {
        val active = connection ?: return null
        if (active.state.value != RemoteConnectionState.Online || _devices.value.none { it.id == deviceId }) return null
        if (passphrase.length !in 8..128 || archive.isEmpty()) return false
        listDesktopSessions(deviceId) ?: return null
        val methods = listOf(
            "session.migration.receive.start",
            "session.migration.receive.chunk",
            "session.migration.receive.finish",
            "session.migration.receive.import",
            "session.migration.receive.cancel",
        )
        if (methods.any { !active.supportsPeerMethod(it) }) return false

        val chunkSize = 256 * 1024
        val totalChunks = (archive.size + chunkSize - 1) / chunkSize
        val transferId = "migration-${now()}-${++migrationTransferCounter}"
        val sha256 = sha256MigrationArchive(archive)
        var started = false
        try {
            active.request(
                RemoteRequestMethod.SessionMigrationReceiveStart,
                buildJsonObject {
                    put("transferId", transferId)
                    put("totalBytes", archive.size)
                    put("sha256", sha256)
                },
                timeoutMs = 30_000,
            )
            started = true
            repeat(totalChunks) { index ->
                val offset = index * chunkSize
                val chunk = archive.copyOfRange(offset, minOf(offset + chunkSize, archive.size))
                try {
                    active.request(
                        RemoteRequestMethod.SessionMigrationReceiveChunk,
                        buildJsonObject {
                            put("transferId", transferId)
                            put("index", index)
                            put("dataBase64", Base64.encode(chunk))
                        },
                        timeoutMs = 60_000,
                    )
                } finally {
                    chunk.fill(0)
                }
                onProgress(index + 1, totalChunks)
            }
            onAwaitingApproval()
            val approval = active.request(
                RemoteRequestMethod.SessionMigrationReceiveFinish,
                buildJsonObject { put("transferId", transferId) },
                timeoutMs = 15 * 60_000,
            ) as? JsonObject ?: throw RemoteConversationException("电脑未确认接收会话备份")
            if (approval["accepted"]?.jsonPrimitive?.booleanOrNull != true) {
                throw RemoteConversationException(Str.migrationSendNotAccepted)
            }
            active.request(
                RemoteRequestMethod.SessionMigrationReceiveImport,
                buildJsonObject {
                    put("transferId", transferId)
                    put("passphrase", passphrase)
                },
                timeoutMs = 15 * 60_000,
            )
            return true
        } catch (error: CancellationException) {
            if (started) {
                withContext(NonCancellable) {
                    withTimeoutOrNull(1_000) {
                        runCatching {
                            active.request(
                                RemoteRequestMethod.SessionMigrationReceiveCancel,
                                buildJsonObject { put("transferId", transferId) },
                                timeoutMs = 1_000,
                            )
                        }
                    }
                }
            }
            throw error
        } catch (error: Throwable) {
            if (started && active.state.value == RemoteConnectionState.Online) {
                runCatching {
                    active.request(
                        RemoteRequestMethod.SessionMigrationReceiveCancel,
                        buildJsonObject { put("transferId", transferId) },
                        timeoutMs = 1_000,
                    )
                }
            }
            throw error
        }
    }

    private suspend fun requestHistoryPage(
        active: RemoteConnection,
        sessionId: String,
        offset: Int,
        retryFirstPageTimeout: Boolean,
    ): JsonObject {
        suspend fun request() = active.request(
            method = RemoteRequestMethod.SessionHistory,
            payload = buildJsonObject {
                put("offset", offset)
                put("limit", HISTORY_PAGE_SIZE)
                put("boundedPages", true)
            },
            sessionId = sessionId,
            timeoutMs = if (offset == 0) REMOTE_HISTORY_PROBE_TIMEOUT_MS else REMOTE_HISTORY_PAGE_TIMEOUT_MS,
        ) as? JsonObject ?: throw RemoteConversationException("电脑没有返回会话记录")
        return try {
            request()
        } catch (error: RemoteRequestException) {
            if (!retryFirstPageTimeout || error.remoteError.code != RemoteErrorCode.RequestTimeout) throw error
            request()
        }
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
                timeoutMs = REMOTE_PROTOCOL_FALLBACK_TIMEOUT_MS,
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
                timeoutMs = REMOTE_PROTOCOL_FALLBACK_TIMEOUT_MS,
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
                timeoutMs = REMOTE_PROTOCOL_FALLBACK_TIMEOUT_MS,
            ),
        )
    }

    private suspend fun workbenchRequest(localSessionId: String, remoteSessionId: String, name: String, payload: JsonObject? = null): JsonObject? {
        val active = connection ?: throw RemoteConversationException("电脑连接已断开，请重新连接")
        if (active.state.value != RemoteConnectionState.Online) throw RemoteConversationException("电脑连接已断开，请重新连接")
        if (!active.supportsPeerMethod(name)) {
            val catalog = active.request(RemoteRequestMethod.SessionList) as? JsonObject
            updatePeerSupportedMethods(active, catalog ?: return null)
            if (!active.supportsPeerMethod(name)) return null
        }
        val opened = active.request(RemoteRequestMethod.SessionOpen, sessionId = remoteSessionId) as? JsonObject
        val resolved = opened?.get("sessionId")?.jsonPrimitive?.contentOrNull ?: remoteSessionId
        remoteSessionIds[localSessionId] = resolved
        // Reuse the established envelope; legacy blind relays validate the outer method.
        return active.request(RemoteRequestMethod.SessionContext, buildJsonObject { put("extensionMethod", name); if (payload != null) put("payload", payload) }, resolved, timeoutMs = 30_000) as? JsonObject
    }

    override suspend fun readDesktopWorkbench(localSessionId: String, remoteSessionId: String) =
        workbenchRequest(localSessionId, remoteSessionId, "session.workbench")?.let { contextWorkspaceJson.decodeFromJsonElement(org.agent567.android.domain.session.SessionWorkbenchSnapshot.serializer(), it) }

    override suspend fun readDesktopProjectCollaboration(localSessionId: String, remoteSessionId: String) =
        workbenchRequest(localSessionId, remoteSessionId, "session.collaboration.read")?.let {
            contextWorkspaceJson.decodeFromJsonElement(org.agent567.android.domain.session.ProjectCollaborationSnapshot.serializer(), it)
        }

    override suspend fun updateDesktopProjectCollaboration(localSessionId: String, remoteSessionId: String, patch: org.agent567.android.domain.session.ProjectCollaborationPatch) =
        workbenchRequest(
            localSessionId,
            remoteSessionId,
            "session.collaboration.update",
            kotlinx.serialization.json.Json.encodeToJsonElement(org.agent567.android.domain.session.ProjectCollaborationPatch.serializer(), patch) as JsonObject,
        )?.let { contextWorkspaceJson.decodeFromJsonElement(org.agent567.android.domain.session.ProjectCollaborationSnapshot.serializer(), it) }

    override suspend fun controlDesktopProjectCollaboration(localSessionId: String, remoteSessionId: String, control: org.agent567.android.domain.session.ProjectCollaborationControl) =
        workbenchRequest(
            localSessionId,
            remoteSessionId,
            "session.collaboration.control",
            kotlinx.serialization.json.Json.encodeToJsonElement(org.agent567.android.domain.session.ProjectCollaborationControl.serializer(), control) as JsonObject,
        )?.let { contextWorkspaceJson.decodeFromJsonElement(org.agent567.android.domain.session.ProjectCollaborationSnapshot.serializer(), it) }

    override suspend fun readDesktopWorkbenchDetail(localSessionId: String, remoteSessionId: String, kind: String, id: String) =
        workbenchRequest(localSessionId, remoteSessionId, "session.workbench.detail", buildJsonObject { put("kind", kind); put("id", id) })?.let { contextWorkspaceJson.decodeFromJsonElement(org.agent567.android.domain.session.SessionWorkbenchDetail.serializer(), it) }

    override suspend fun readDesktopAttachmentChunk(localSessionId: String, remoteSessionId: String, id: String, offset: Int, length: Int): RemoteDesktopImageChunk? {
        val response = workbenchRequest(localSessionId, remoteSessionId, "session.attachment.read", buildJsonObject { put("id", id); put("offset", offset); put("length", length) }) ?: return null
        return RemoteDesktopImageChunk("application/octet-stream", response["sizeBytes"]?.jsonPrimitive?.intOrNull ?: throw RemoteConversationException("附件大小无效"), response["dataBase64"]?.jsonPrimitive?.contentOrNull ?: throw RemoteConversationException("附件数据为空"), response["revision"]?.jsonPrimitive?.contentOrNull)
    }

    override suspend fun updateDesktopContextSelection(localSessionId: String, remoteSessionId: String, selection: org.agent567.android.domain.session.ContextWorkspaceSnapshot) =
        contextRequest(localSessionId, remoteSessionId, RemoteRequestMethod.SessionContextSelection, kotlinx.serialization.json.Json.encodeToJsonElement(org.agent567.android.domain.session.ContextWorkspaceSnapshot.serializer(), selection) as JsonObject)

    override suspend fun readDesktopContext(localSessionId: String, remoteSessionId: String) =
        contextRequest(localSessionId, remoteSessionId, RemoteRequestMethod.SessionContext)

    override suspend fun compactDesktopContext(localSessionId: String, remoteSessionId: String) =
        contextRequest(localSessionId, remoteSessionId, RemoteRequestMethod.SessionContextCompact)

    override suspend fun setDesktopAutoCompaction(localSessionId: String, remoteSessionId: String, enabled: Boolean) =
        contextRequest(localSessionId, remoteSessionId, RemoteRequestMethod.SessionContextAuto, buildJsonObject { put("enabled", enabled) })

    private val contextWorkspaceJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    private suspend fun contextRequest(
        localSessionId: String,
        remoteSessionId: String,
        method: RemoteRequestMethod,
        payload: JsonObject? = null,
    ): org.agent567.android.domain.session.ChatContextSnapshot? {
        val active = connection ?: throw RemoteConversationException("电脑连接已断开，请重新连接")
        if (active.state.value != RemoteConnectionState.Online) throw RemoteConversationException("电脑连接已断开，请重新连接")
        val methodName = when (method) {
            RemoteRequestMethod.SessionContextCompact -> "session.context.compact"
            RemoteRequestMethod.SessionContextAuto -> "session.context.auto"
            RemoteRequestMethod.SessionContextSelection -> "session.context.selection"
            else -> "session.context"
        }
        if (!active.supportsPeerMethod(methodName)) {
            val catalog = active.request(RemoteRequestMethod.SessionList) as? JsonObject
            updatePeerSupportedMethods(active, catalog ?: return null)
            if (!active.supportsPeerMethod(methodName)) return null
        }
        val opened = active.request(RemoteRequestMethod.SessionOpen, sessionId = remoteSessionId) as? JsonObject
        val resolved = opened?.get("sessionId")?.jsonPrimitive?.contentOrNull ?: remoteSessionId
        remoteSessionIds[localSessionId] = resolved
        val wireMethod = if (method == RemoteRequestMethod.SessionContextSelection) RemoteRequestMethod.SessionContext else method
        val wirePayload = if (method == RemoteRequestMethod.SessionContextSelection) buildJsonObject { put("extensionMethod", methodName); if (payload != null) put("payload", payload) } else payload
        val response = active.request(wireMethod, wirePayload, resolved, timeoutMs = if (method == RemoteRequestMethod.SessionContextCompact) 600_000 else 30_000) as? JsonObject
            ?: throw RemoteConversationException("电脑端未返回上下文状态")
        return org.agent567.android.domain.session.ChatContextSnapshot(
            workspace = (response["workspace"] as? JsonObject)?.let { contextWorkspaceJson.decodeFromJsonElement(org.agent567.android.domain.session.ContextWorkspaceSnapshot.serializer(), it) },
            tokens = response["tokens"]?.jsonPrimitive?.longOrNull,
            contextWindow = response["contextWindow"]?.jsonPrimitive?.longOrNull?.takeIf { it > 0 },
            contextWindowSource = response["contextWindowSource"]?.jsonPrimitive?.contentOrNull ?: "unknown",
            estimated = response["estimated"]?.jsonPrimitive?.booleanOrNull ?: true,
            messageCount = response["messageCount"]?.jsonPrimitive?.intOrNull ?: 0,
            autoCompactionEnabled = response["autoCompactionEnabled"]?.jsonPrimitive?.booleanOrNull ?: true,
            busy = response["busy"]?.jsonPrimitive?.booleanOrNull ?: false,
            summary = response["summary"]?.jsonPrimitive?.contentOrNull.orEmpty(),
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
                timeoutMs = REMOTE_PROMPT_SUGGESTIONS_TIMEOUT_MS,
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
                    eventCursor = eventCursors.value[target],
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
        connectionTarget = target
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
                rememberEventCursor(previous, connectionTarget)
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
    ): Flow<ChatStreamEvent> = streamWithAttachments(
        localSessionId = localSessionId,
        deviceId = deviceId,
        remoteSessionId = remoteSessionId,
        messages = messages,
        retryPreviousTurn = retryPreviousTurn,
        promptText = messages.lastOrNull()?.textContent.orEmpty(),
        files = emptyList(),
    )

    override fun streamWithAttachments(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
        retryPreviousTurn: Boolean,
        promptText: String,
        files: List<RemotePromptFileAttachment>,
    ): Flow<ChatStreamEvent> =
        channelFlow {
            val generation = connectionGeneration
            val turnId = "mobile_${kotlin.random.Random.nextLong().toULong().toString(16)}_${kotlin.random.Random.nextLong().toULong().toString(16)}"
            var submitted = false
            var turnSessionId = remoteSessionId ?: remoteSessionIds[localSessionId]
            val active = connection ?: throw RemoteConversationException("请先连接桌面设备")
            if (active.state.value != RemoteConnectionState.Online) {
                throw RemoteConversationException("桌面连接正在恢复，请稍后重试")
            }
            val terminal = CompletableDeferred<ChatStreamEvent.State>()
            var terminalFromDesktop = false
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
                // End this transport subscription. The caller then recovers the exact
                // turn through a read-only snapshot on the replacement connection.
                active.state.first {
                    it == RemoteConnectionState.Reconnecting ||
                        it == RemoteConnectionState.Recovering ||
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
                            if (event is ChatStreamEvent.State && event.value in TERMINAL_REMOTE_STATES && terminal.complete(event)) {
                                terminalFromDesktop = true
                            }
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
                                    timeoutMs = REMOTE_PROTOCOL_FALLBACK_TIMEOUT_MS,
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
                val userMessage = messages.lastOrNull { it.role == ChatRole.User }
                val newImageParts = userMessage?.parts?.filterIsInstance<ChatContentPart.Image>().orEmpty()
                var promptSessionId = remoteSessionId ?: remoteSessionIds[localSessionId]
                val hasNewAttachments = !retryPreviousTurn &&
                    (files.isNotEmpty() || newImageParts.isNotEmpty())
                if (hasNewAttachments) {
                    if (!active.supportsPeerMethod("session.attachment.transfer.start")) {
                        throw RemoteConversationException("当前电脑端不支持接收手机附件，请更新桌面端后重试")
                    }
                    if (files.any { it.bytes.isEmpty() || it.bytes.size > PROMPT_ATTACHMENT_MAX_BYTES }) {
                        throw RemoteConversationException("附件为空或超过 12 MB，请压缩后重试")
                    }
                    if (files.size > PROMPT_ATTACHMENT_MAX_COUNT || files.sumOf { it.bytes.size } > PROMPT_ATTACHMENT_MAX_TOTAL_BYTES) {
                        throw RemoteConversationException("单条消息最多发送 10 个附件，合计不超过 48 MiB")
                    }
                    val imageBytesEstimate = newImageParts.sumOf { image ->
                        val encoded = image.base64Data.substringAfter(";base64,", image.base64Data).filterNot(Char::isWhitespace)
                        encoded.length.toLong() * 3L / 4L
                    }
                    if (files.size + newImageParts.size > PROMPT_ATTACHMENT_MAX_COUNT ||
                        files.sumOf { it.bytes.size.toLong() } + imageBytesEstimate > PROMPT_ATTACHMENT_MAX_TOTAL_BYTES
                    ) {
                        throw RemoteConversationException("单条消息最多发送 10 个附件，合计不超过 48 MiB")
                    }
                }
                if (hasNewAttachments && promptSessionId == null) {
                    if (!active.supportsPeerMethod("session.create")) {
                        throw RemoteConversationException("当前电脑端不支持远程附件会话，请更新桌面端后重试")
                    }
                    val created = active.request(RemoteRequestMethod.SessionCreate) as? JsonObject
                    promptSessionId = created?.stringValue("sessionId")
                        ?: throw RemoteConversationException("电脑端无法创建会话来接收附件")
                    remoteSessionIds[localSessionId] = promptSessionId
                }
                val attachmentIds = mutableListOf<String>()
                if (!retryPreviousTurn) {
                    files.forEach { file ->
                        attachmentIds += transferPromptAttachment(
                            active = active,
                            sessionId = promptSessionId,
                            fileName = file.fileName,
                            mimeType = file.mimeType,
                            bytes = file.bytes,
                        )
                    }
                    newImageParts.forEachIndexed { index, image ->
                        val imageBytes = decodePromptImage(image.base64Data)
                        try {
                            attachmentIds += transferPromptAttachment(
                                active = active,
                                sessionId = promptSessionId,
                                fileName = "mobile-image-${index + 1}.${imageExtension(image.mimeType)}",
                                mimeType = image.mimeType,
                                bytes = imageBytes,
                            )
                        } finally {
                            imageBytes.fill(0)
                        }
                    }
                }
                val payload = buildJsonObject {
                    put("text", promptText)
                    put("turnId", turnId)
                    if (attachmentIds.isNotEmpty()) {
                        put("attachmentIds", JsonArray(attachmentIds.map(::JsonPrimitive)))
                    }
                    if (retryPreviousTurn) {
                        put("retryPreviousTurn", true)
                        retryTargetMessageId?.let { put("retryTargetMessageId", it) }
                    }
                }
                val result = try {
                    turnSessionId = promptSessionId
                    submitted = true
                    active.request(
                        method = org.agent567.android.domain.remote.protocol.RemoteRequestMethod.SessionPrompt,
                        payload = payload,
                        sessionId = promptSessionId,
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
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                // A provider timeout is a finished task, not a lost transport.
                if (terminalFromDesktop) throw error
                val connectionLost = active.state.value in setOf(RemoteConnectionState.Reconnecting, RemoteConnectionState.Closed, RemoteConnectionState.Failed) ||
                    (error is RemoteRequestException && error.remoteError.code in setOf(RemoteErrorCode.TransportClosed, RemoteErrorCode.RequestTimeout))
                if (!submitted || !connectionLost || generation != connectionGeneration) throw error
                eventJob.cancelAndJoin()
                connectionJob.cancelAndJoin()
                emitTransportState()
                if (error is RemoteRequestException && error.remoteError.code == RemoteErrorCode.RequestTimeout && connection === active) {
                    scheduleReconnect(connectionTarget ?: activeTargets.first(), generation)
                }
                val targetSessionId = turnSessionId ?: remoteSessionIds[localSessionId]
                    ?: throw RemoteConversationException("连接已中断，尚未确认电脑会话。消息已保留，请连接后检查记录再重试")
                recoverRemoteTurn(deviceId, targetSessionId, turnId, generation) { send(it) }
            } finally {
                eventJob.cancel()
                connectionJob.cancel()
            }
        }

    private suspend fun rememberEventCursor(active: RemoteConnection?, target: String?) {
        if (active == null || target == null) return
        val snapshot = active.snapshot()
        snapshot.eventPublisherId?.let { publisher ->
            eventCursors.update { it + (target to RemoteEventCursor(publisher, snapshot.lastEventSequence)) }
        }
    }

    private suspend fun recoverRemoteTurn(
        deviceId: String,
        sessionId: String,
        turnId: String,
        generation: Long,
        emit: suspend (ChatStreamEvent) -> Unit,
    ) {
        // Recovery reads the exact submitted turn. It never sends session.prompt again.
        var failedReads = 0
        while (true) {
            val active = withTimeoutOrNull(90_000) {
                while (generation == connectionGeneration && activeTargets.isNotEmpty()) {
                    val candidate = connection
                    if (candidate != null && candidate.state.value in setOf(RemoteConnectionState.Online, RemoteConnectionState.Recovering)) {
                        if (candidate.snapshot().peerDeviceId != deviceId) throw RemoteConversationException("连接的电脑已变化，请重新打开会话")
                        return@withTimeoutOrNull candidate
                    }
                    delay(250)
                }
                null
            } ?: throw RemoteConversationException("连接恢复超时，消息已保留。请连接电脑后检查本次任务结果再重试")
            var terminalFailure = false
            try {
                if (!active.supportsPeerMethod("session.turn.read")) {
                    val catalog = active.request(RemoteRequestMethod.SessionList, timeoutMs = 5_000) as? JsonObject
                        ?: throw RemoteConversationException("电脑没有返回恢复能力")
                    updatePeerSupportedMethods(active, catalog)
                    if (!active.supportsPeerMethod("session.turn.read")) throw RemoteRequestException(RemoteError(RemoteErrorCode.TransportClosed, "当前电脑端不支持任务断线恢复，请更新电脑端；本次消息已保留", true))
                }
                val snapshot = active.request(
                    RemoteRequestMethod.SessionTurnRead,
                    buildJsonObject { put("turnId", turnId) },
                    sessionId,
                    timeoutMs = 10_000,
                ) as? JsonObject ?: throw RemoteConversationException("电脑没有返回本次任务状态")
                if (snapshot["found"]?.jsonPrimitive?.booleanOrNull != true) throw RemoteConversationException("电脑未找到本次任务的恢复记录，请先查看电脑会话结果再决定是否重试")
                (snapshot["eventCursor"] as? JsonObject)?.let { cursor ->
                    val publisher = cursor.stringValue("publisherId")
                    val sequence = cursor.longValue("sequence")
                    if (publisher != null && sequence != null) active.restoreEventCursor(RemoteEventCursor(publisher, sequence))
                }
                failedReads = 0
                val state = snapshot.stringValue("state") ?: "waiting_response"
                emit(ChatStreamEvent.Snapshot(
                    truncated = snapshot["truncated"]?.jsonPrimitive?.booleanOrNull == true,
                    text = snapshot.stringValue("text").orEmpty(),
                    tools = (snapshot["tools"] as? JsonArray).orEmpty().mapNotNull { decodeConversationEvent(RemoteEventName.SessionTool, it) as? ChatStreamEvent.Tool },
                    input = decodeConversationEvent(RemoteEventName.SessionInput, snapshot["input"]) as? ChatStreamEvent.UserInputRequired,
                    state = state,
                    usage = decodeConversationEvent(RemoteEventName.SessionState, snapshot["usage"]) as? ChatStreamEvent.State,
                ))
                if (state == "error") {
                    terminalFailure = true
                    val remoteError = snapshot["error"] as? JsonObject
                    throw RemoteRequestException(RemoteError(remoteError?.stringValue("code").toRemoteErrorCode(), remoteError?.stringValue("message") ?: "电脑端任务失败，请查看电脑会话记录", false))
                }
                if (state in TERMINAL_REMOTE_STATES) {
                    emit(ChatStreamEvent.State(state))
                    if (state == "completed") emit(ChatStreamEvent.Done)
                    return
                }
                delay(1_000)
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (terminalFailure) throw error
                val disconnected = active.state.value in setOf(RemoteConnectionState.Reconnecting, RemoteConnectionState.Closed, RemoteConnectionState.Failed)
                val timedOut = error is RemoteRequestException && error.remoteError.code == RemoteErrorCode.RequestTimeout
                if (!disconnected && !timedOut) throw error
                if (++failedReads >= 3) throw RemoteConversationException("任务恢复连接不稳定，消息已保留，请检查电脑端结果后重试")
                emit(ChatStreamEvent.State("reconnecting"))
                if (connection === active && generation == connectionGeneration) scheduleReconnect(connectionTarget ?: activeTargets.first(), generation)
            }
        }
    }

    private suspend fun transferPromptAttachment(
        active: RemoteConnection,
        sessionId: String?,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ): String {
        if (!active.supportsPeerMethod("session.attachment.transfer.start")) {
            throw RemoteConversationException("当前电脑端不支持接收手机附件，请更新桌面端后重试")
        }
        if (bytes.isEmpty() || bytes.size > PROMPT_ATTACHMENT_MAX_BYTES) {
            throw RemoteConversationException("附件为空或超过 12 MB，请压缩后重试")
        }
        val transferId = "mobile-attachment-${now()}-${++migrationTransferCounter}"
        val digest = sha256MigrationArchive(bytes)
        val activeSessionId = sessionId
        try {
            active.request(
                method = RemoteRequestMethod.SessionAttachmentTransferStart,
                payload = buildJsonObject {
                    put("transferId", transferId)
                    put("fileName", fileName)
                    put("mimeType", mimeType)
                    put("totalBytes", bytes.size)
                    put("sha256", digest)
                },
                sessionId = activeSessionId,
                timeoutMs = PROMPT_ATTACHMENT_REQUEST_TIMEOUT_MS,
            )
            var offset = 0
            var index = 0
            while (offset < bytes.size) {
                val end = minOf(offset + PROMPT_ATTACHMENT_CHUNK_BYTES, bytes.size)
                val chunk = bytes.copyOfRange(offset, end)
                val encoded = try {
                    Base64.encode(chunk)
                } finally {
                    chunk.fill(0)
                }
                active.request(
                    method = RemoteRequestMethod.SessionAttachmentTransferChunk,
                    payload = buildJsonObject {
                        put("transferId", transferId)
                        put("index", index)
                        put("dataBase64", encoded)
                    },
                    sessionId = activeSessionId,
                    timeoutMs = PROMPT_ATTACHMENT_REQUEST_TIMEOUT_MS,
                )
                offset = end
                index += 1
            }
            val result = active.request(
                method = RemoteRequestMethod.SessionAttachmentTransferFinish,
                payload = buildJsonObject { put("transferId", transferId) },
                sessionId = activeSessionId,
                timeoutMs = PROMPT_ATTACHMENT_REQUEST_TIMEOUT_MS,
            ) as? JsonObject
            return result?.stringValue("attachmentId")
                ?: throw RemoteConversationException("电脑端没有确认收到附件，请重新发送")
        } catch (error: Throwable) {
            withContext(NonCancellable) {
                runCatching {
                    active.request(
                        method = RemoteRequestMethod.SessionAttachmentTransferCancel,
                        payload = buildJsonObject { put("transferId", transferId) },
                        sessionId = activeSessionId,
                        timeoutMs = 1_000,
                    )
                }
            }
            throw error
        }
    }

    @OptIn(ExperimentalEncodingApi::class)
    private fun decodePromptImage(value: String): ByteArray {
        val base64 = value.substringAfter(";base64,", value)
        return runCatching { Base64.decode(base64) }
            .getOrElse { throw RemoteConversationException("手机图片格式无法读取，请重新选择后发送") }
    }

    private fun imageExtension(mimeType: String): String = when (mimeType.lowercase()) {
        "image/jpeg", "image/jpg" -> "jpg"
        "image/png" -> "png"
        "image/gif" -> "gif"
        "image/webp" -> "webp"
        else -> "img"
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
            contextWindowSource = model["contextWindowSource"]?.jsonPrimitive?.contentOrNull ?: "unknown",
            maxTokens = model["maxTokens"]?.jsonPrimitive?.longOrNull,
            reasoningLevels = reasoningLevels,
            defaultReasoningLevel = model["defaultReasoningLevel"]?.jsonPrimitive?.contentOrNull,
        )
    }
    return RemoteSessionModelCatalog(
        currentModelId = currentModelId,
        models = models,
        lastUserMessageId = root["lastUserMessageId"]?.jsonPrimitive?.contentOrNull,
        serviceRoute = root["serviceRoute"]?.jsonPrimitive?.contentOrNull,
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
            val images = (objectValue["images"] as? JsonArray).orEmpty().mapNotNull { item ->
                val ref = item as? JsonObject ?: return@mapNotNull null
                val id = ref.stringValue("id")?.takeIf(String::isNotBlank) ?: return@mapNotNull null
                val mimeType = ref.stringValue("mimeType")?.takeIf { it.startsWith("image/") } ?: "image/png"
                RemoteGeneratedImageRef(id, mimeType)
            }
            ChatStreamEvent.Tool(
                phase = phase,
                toolCallId = callId,
                toolName = toolName,
                detail = result ?: arguments,
                durationMs = objectValue.longValue("durationMs"),
                arguments = arguments,
                result = result,
                phaseLabel = objectValue.stringValue("label"),
                images = images,
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
private fun JsonObject.intValue(key: String): Int? = get(key)?.jsonPrimitive?.intOrNull

private fun updatePeerSupportedMethods(active: RemoteConnection, payload: JsonObject) {
    active.setPeerSupportedMethods(
        (payload["supportedMethods"] as? JsonArray).orEmpty().mapNotNull {
            (it as? JsonPrimitive)?.contentOrNull
        }.toSet(),
    )
}

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

private fun remoteTargetKind(target: String): String {
    val host = target.substringBefore('#').substringAfter("://", "").substringBefore('/').substringBefore(':')
    val octets = host.split('.').mapNotNull(String::toIntOrNull)
    val privateIpv4 =
        octets.size == 4 && octets.all { it in 0..255 } &&
            (octets[0] == 10 || octets[0] == 192 && octets[1] == 168 ||
                octets[0] == 172 && octets[1] in 16..31)
    return if (host.equals("localhost", ignoreCase = true) || privateIpv4) "lan" else "relay"
}

private fun safeRemoteConnectionError(error: Throwable): String =
    (error.message ?: "Connection failed")
        .replace(Regex("(?i)(pairing|resume|bootstrap|fingerprint)=([^&\\s]+)"), "\$1=[redacted]")
        .replace(Regex("(?i)wss?://[^\\s]+"), "<remote-url>")
        .take(240)

private fun isLanStartupRace(error: Throwable): Boolean {
    var cause: Throwable? = error
    repeat(8) {
        val current = cause ?: return false
        if (
            current::class.simpleName == "ConnectException" ||
            current.message.orEmpty().contains("connection refused", ignoreCase = true) ||
            current.message.orEmpty().contains("failed to connect", ignoreCase = true)
        ) return true
        cause = current.cause
    }
    return false
}

private const val METRICS_REFRESH_INTERVAL_MS = 1_000L
private const val REMOTE_PROTOCOL_FALLBACK_TIMEOUT_MS = 5_000L
private const val REMOTE_HISTORY_PROBE_TIMEOUT_MS = 5_000L
private const val REMOTE_HISTORY_PAGE_TIMEOUT_MS = 30_000L
private const val REMOTE_IMAGE_MAX_BYTES = 12 * 1024 * 1024
private const val REMOTE_IMAGE_CHUNK_TIMEOUT_MS = 15_000L
private const val REMOTE_PROMPT_SUGGESTIONS_TIMEOUT_MS = 60_000L
private const val PROMPT_ATTACHMENT_MAX_BYTES = 12 * 1024 * 1024
private const val PROMPT_ATTACHMENT_CHUNK_BYTES = 192 * 1024
private const val PROMPT_ATTACHMENT_REQUEST_TIMEOUT_MS = 15_000L
private const val LAN_STARTUP_RETRY_DELAY_MS = 500L
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
