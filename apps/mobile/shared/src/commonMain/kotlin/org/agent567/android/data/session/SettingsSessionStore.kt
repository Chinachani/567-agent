package org.agent567.android.data.session

import org.agent567.android.core.settings.Agent567Settings
import com.russhwolf.settings.Settings
import com.russhwolf.settings.set
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.NonCancellable
import org.agent567.android.domain.session.TaskMessageHeader
import org.agent567.android.domain.session.taskHeader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.Serializable
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatQuestion
import org.agent567.android.core.model.ChatQuestionOption
import org.agent567.android.core.model.TokenUsage
import org.agent567.android.core.net.Agent567Json
import org.agent567.android.domain.session.MobileSessionContext
import org.agent567.android.domain.session.ChatSession
import org.agent567.android.domain.session.ConversationOrigin
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageImage
import org.agent567.android.domain.session.MessageImageFileStore
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.domain.session.PendingQuestion
import org.agent567.android.domain.session.SessionStore
import org.agent567.android.domain.session.nowEpochMs
import kotlin.random.Random

/**
 * 基于 multiplatform-settings 的会话持久化。
 * 会话索引与消息分 key 存储；适合移动端首期本地权威模型。
 */
class SettingsSessionStore(
    settings: Settings = Settings(),
    private val storageDispatcher: kotlinx.coroutines.CoroutineDispatcher = Dispatchers.IO,
    private val imageFiles: MessageImageFileStore = org.agent567.android.domain.session.createPlatformMessageImageFileStore(),
) : SessionStore {
    private val storage = Agent567Settings(settings)

    private val mutex = Mutex()
    private val drafts = SettingsSessionDrafts(storage, imageFiles)
    private val _sessions = MutableStateFlow(loadSessionsSorted())
    override val sessions: StateFlow<List<ChatSession>> = _sessions.asStateFlow()

    private val flowLru = linkedMapOf<String, MutableStateFlow<List<LocalMessage>>>()
    private val activeWritingSessionIds = mutableSetOf<String>()
    private val pinnedObserverCounts = mutableMapOf<String, Int>()

    override fun observeMessages(sessionId: String): Flow<List<LocalMessage>> = flow {
        // Legacy JSON migration and image metadata repair can be substantial. Defer
        // loading until collection and run it under the same IO mutex as mutations.
        var registered = false
        try {
            val messages = withStorageLock {
                val detail = messageFlow(sessionId)
                pinnedObserverCounts[sessionId] = (pinnedObserverCounts[sessionId] ?: 0) + 1
                registered = true
                detail
            }
            emitAll(messages)
        } finally {
            // Cancellation can arrive while returning from the storage dispatcher, before emitAll.
            if (registered) withContext(NonCancellable) { withStorageLock {
                val count = (pinnedObserverCounts[sessionId] ?: 1) - 1
                if (count <= 0) pinnedObserverCounts.remove(sessionId) else pinnedObserverCounts[sessionId] = count
                evictInactiveFlowsLocked()
            } }
        }
    }

    override suspend fun getSession(id: String): ChatSession? =
        _sessions.value.firstOrNull { it.id == id }

    override suspend fun refresh() {
        withStorageLock {
            _sessions.value = loadSessionsRaw().map { it.toDomain() }
                .sortedWith(compareByDescending<ChatSession> { it.pinned }.thenByDescending { it.updatedAtEpochMs })
        }
    }

    override suspend fun hasDraft(sessionId: String): Boolean = withStorageLock { drafts.hasDraft(sessionId) }

    override suspend fun getDraft(sessionId: String, owner: String): org.agent567.android.domain.session.SessionDraft =
        withStorageLock { drafts.read(sessionId, owner) }

    override suspend fun saveDraft(sessionId: String, owner: String, draft: org.agent567.android.domain.session.SessionDraft) {
        withStorageLock {
            if (_sessions.value.any { it.id == sessionId }) drafts.write(sessionId, owner, draft)
        }
    }

    override suspend fun getMessages(sessionId: String): List<LocalMessage> =
        withStorageLock { messageFlow(sessionId).value }

    override suspend fun readTaskMessageHeaders(sessionId: String): List<TaskMessageHeader> = withStorageLock {
        flowLru[sessionId]?.value?.map { it.taskHeader() } ?: readStoredTaskHeaders(sessionId)
    }

    override suspend fun createSession(
        title: String,
        modelId: String?,
        modelName: String?,
        origin: ConversationOrigin,
        remoteDeviceId: String?,
        remoteSessionId: String?,
        remoteSessionCreatedOnMobile: Boolean,
    ): ChatSession =
        withStorageLock {
            val now = nowEpochMs()
            val session =
                ChatSession(
                    id = newId(),
                    title = title,
                    modelId = modelId,
                    modelName = modelName,
                    createdAtEpochMs = now,
                    updatedAtEpochMs = now,
                    origin = origin,
                    remoteDeviceId = remoteDeviceId,
                    remoteSessionId = remoteSessionId,
                    remoteSessionCreatedOnMobile = remoteSessionCreatedOnMobile,
                )
            val next = (loadSessionsRaw() + session.toDto()).sortedByDescending { it.updatedAtEpochMs }
            persistSessions(next)
            messageFlow(session.id).value = emptyList()
            persistMessages(session.id, emptyList())
            session
        }

    override suspend fun updateSession(session: ChatSession) {
        withStorageLock {
            val raw = loadSessionsRaw().map { if (it.id == session.id) session.toDto() else it }
            persistSessions(raw.sortedByDescending { it.updatedAtEpochMs })
        }
    }

    override suspend fun deleteSession(id: String) {
        withStorageLock {
            drafts.delete(id)
            val messages = flowLru[id]?.value ?: loadMessages(id)
            persistSessions(loadSessionsRaw().filterNot { it.id == id })
            storage.remove(messagesKey(id))
            val messageIds = loadMessageIndex(id)
            messageIds.forEach { storage.remove(messageKey(id, it)) }
            (messages.flatMap { it.images }.mapNotNull { it.storageKey }).distinct().forEach(imageFiles::delete)
            storage.remove(messageIndexKey(id))
            storage.remove(streamingMessageKey(id))
            flowLru.remove(id)
            activeWritingSessionIds.remove(id)
            pinnedObserverCounts.remove(id)
        }
    }

    override suspend fun upsertMessage(message: LocalMessage) = withStorageLock { upsertMessageLocked(message) }

    override suspend fun finishStreamingMessage(message: LocalMessage) {
        require(message.status != MessageStatus.Streaming)
        withStorageLock {
            val (flow, index) = activeRow(message) ?: return@withStorageLock
            upsertMessageLocked(message.withSavedImages(flow.value[index]))
        }
    }

    override suspend fun attachMessageImage(sessionId: String, messageId: String, image: MessageImage) {
        withStorageLock {
            if (_sessions.value.none { it.id == sessionId }) return@withStorageLock
            val current = messageFlow(sessionId).value.firstOrNull { it.id == messageId } ?: return@withStorageLock
            if (current.images.none { it.id == image.id }) upsertMessageLocked(current.copy(images = current.images + image))
        }
    }

    // Remote image chunks can finish while text is still streaming. Only append missing images;
    // preserve the store's file-backed handle when both snapshots refer to the same image.
    private fun LocalMessage.withSavedImages(saved: LocalMessage): LocalMessage =
        if (saved.images.isEmpty() || saved.images == images) this
        else copy(images = (saved.images + images).distinctBy { it.id })

    private fun upsertMessageLocked(message: LocalMessage) {
        val flow = messageFlow(message.sessionId)
        val current = flow.value.toMutableList()
        val idx = current.indexOfFirst { it.id == message.id }
        val previousImages = current.getOrNull(idx)?.images.orEmpty()
        val normalized = normalizeMessageForPersistence(message)
        val sorted = if (idx >= 0) {
            current[idx] = normalized
            current
        } else {
            current.add(normalized)
            current.sortedBy { it.createdAtEpochMs }
        }
        if (storage.getStringOrNull(messageIndexKey(message.sessionId)) == null) {
            persistMessages(message.sessionId, sorted)
        } else {
            persistMessageRecord(normalized)
            if (idx < 0) persistMessageIndex(message.sessionId, sorted.map { it.id })
        }
        deleteUnreferencedImages(previousImages, normalized.images)
        flow.value = sorted
        if (sorted.any { it.status == MessageStatus.Streaming }) activeWritingSessionIds.add(message.sessionId)
        else {
            storage.remove(streamingMessageKey(message.sessionId))
            activeWritingSessionIds.remove(message.sessionId)
            evictInactiveFlowsLocked()
        }

        // 触摸会话更新时间。标题由发送首条消息后的 AI 命名流程生成。
        val sessions = loadSessionsRaw().toMutableList()
        val sIdx = sessions.indexOfFirst { it.id == message.sessionId }
        if (sIdx >= 0) {
            sessions[sIdx] = sessions[sIdx].copy(updatedAtEpochMs = nowEpochMs())
            persistSessions(sessions.sortedByDescending { it.updatedAtEpochMs })
        }
    }

    override suspend fun upsertStreamingMessage(message: LocalMessage) {
        withStorageLock {
            activeWritingSessionIds.add(message.sessionId)
            val flow = messageFlow(message.sessionId)
            val current = flow.value.toMutableList()
            val idx = current.indexOfFirst { it.id == message.id }
            val normalized = normalizeMessageForPersistence(message)
            if (idx >= 0) {
                current[idx] = normalized
                flow.value = current
            } else {
                current.add(normalized)
                flow.value = current.sortedBy { it.createdAtEpochMs }
            }
            storage[streamingMessageKey(message.sessionId)] =
                Agent567Json.encodeToString(MessageDto.serializer(), normalized.toDto())
        }
    }

    // The initially persisted assistant row owns the live updates. Queued frames/checkpoints
    // from a deleted or already terminal turn must not create new rows or repin the session.
    private fun activeRow(message: LocalMessage): Pair<MutableStateFlow<List<LocalMessage>>, Int>? {
        val flow = flowLru[message.sessionId] ?: return null
        val rows = flow.value
        val tail = rows.lastIndex
        val index = if (rows.lastOrNull()?.id == message.id) tail else rows.indexOfFirst { it.id == message.id }
        return if (index >= 0 && rows[index].status == MessageStatus.Streaming) flow to index else null
    }

    override suspend fun updateInMemoryStreamingMessage(message: LocalMessage) {
        withStorageLock {
            val (flow, index) = activeRow(message) ?: return@withStorageLock
            flow.value = flow.value.toMutableList().also { it[index] = message.withSavedImages(it[index]) }
        }
    }

    override suspend fun checkpointStreamingMessage(message: LocalMessage) {
        withStorageLock {
            val (flow, index) = activeRow(message) ?: return@withStorageLock
            // A snapshot carries already persisted image references; this also enforces store bounds.
            val bounded = normalizeMessageForPersistence(message.withSavedImages(flow.value[index]))
            storage[streamingMessageKey(message.sessionId)] = Agent567Json.encodeToString(MessageDto.serializer(), bounded.toDto())
        }
    }

    override suspend fun replaceMessages(sessionId: String, messages: List<LocalMessage>) {
        withStorageLock {
            val previousImages = messageFlow(sessionId).value.flatMap { it.images }
            val sorted = messages.sortedBy { it.createdAtEpochMs }
            val persisted = persistMessages(sessionId, sorted)
            deleteUnreferencedImages(previousImages, persisted.flatMap { it.images })
            storage.remove(streamingMessageKey(sessionId))
            messageFlow(sessionId).value = persisted
            if (persisted.any { it.status == MessageStatus.Streaming }) activeWritingSessionIds.add(sessionId)
            else { activeWritingSessionIds.remove(sessionId); evictInactiveFlowsLocked() }
        }
    }

    override suspend fun persistMessageImages(images: List<MessageImage>): List<MessageImage> =
        withStorageLock { images.map(::persistImage) }

    override suspend fun readMessageImageBytes(image: MessageImage): ByteArray? =
        withStorageLock { readImageBytes(image) }

    override suspend fun exportMigrationData(
        maxBytes: Long,
        onProgress: (completed: Int, total: Int) -> Unit,
    ): String =
        withStorageLock {
            // Desktop sessions are local mirrors of conversations owned by the
            // paired computer. Their cached messages must not be migrated back
            // to that computer as newly created duplicate conversations.
            val sessions = loadSessionsRaw().filter { it.origin != ConversationOrigin.Desktop.name }
            var estimatedBytes = 0L
            val messagesBySession = mutableListOf<SessionMigrationMessagesDto>()
            sessions.forEachIndexed { index, session ->
                try {
                    val items = mutableListOf<MessageDto>()
                    (flowLru[session.id]?.value ?: loadMessages(session.id)).forEach { message ->
                        estimatedBytes += message.content.utf8ByteCount()
                        if (estimatedBytes > maxBytes) {
                            throw MigrationBackupTooLargeException(estimatedBytes, maxBytes)
                        }
                        items += message.toMigrationDto { imageBytes ->
                            estimatedBytes += imageBytes
                            if (estimatedBytes > maxBytes) {
                                throw MigrationBackupTooLargeException(estimatedBytes, maxBytes)
                            }
                        }
                    }
                    messagesBySession += SessionMigrationMessagesDto(
                        sessionId = session.id,
                        items = items,
                    )
                } finally {
                    onProgress(index + 1, sessions.size)
                }
            }
            val archive =
                SessionMigrationArchiveDto(
                    exportedAtEpochMs = nowEpochMs(),
                    sessions = sessions,
                    messages = messagesBySession,
                )
            Agent567Json.encodeToString(SessionMigrationArchiveDto.serializer(), archive)
        }

    override suspend fun importMigrationData(serialized: String): Int =
        withStorageLock {
            require(serialized.utf8LengthAtMost(MAX_MIGRATION_JSON_BYTES.toLong())) { "迁移文件过大" }
            val archive = Agent567Json.decodeFromString(SessionMigrationArchiveDto.serializer(), serialized)
            require(archive.schemaVersion == MIGRATION_SCHEMA_VERSION) { "不支持的迁移文件版本" }
            require(archive.sessions.all { session ->
                val context = session.context
                context.pinnedText.length <= 16000 && context.summary.length <= 16000 && context.previousSummary.length <= 16000 &&
                    context.excludedTurnIds.size <= MAX_MIGRATION_MESSAGES && context.excludedTurnIds.all { it.length <= 200 } && context.selectionRevision >= 0
            }) { "迁移文件的上下文设置过大或无效" }
            require(archive.sessions.size <= MAX_MIGRATION_SESSIONS) { "迁移文件包含过多会话" }
            require(archive.sessions.map { it.id }.distinct().size == archive.sessions.size) { "迁移文件包含重复会话" }
            require(archive.messages.map { it.sessionId }.distinct().size == archive.messages.size) { "迁移文件包含重复消息列表" }

            val sessionIds = archive.sessions.mapTo(mutableSetOf()) { it.id }
            require(archive.messages.all { it.sessionId in sessionIds }) { "迁移文件包含无效消息列表" }
            require(archive.messages.all { group -> group.items.all { it.sessionId == group.sessionId } }) { "迁移文件中的消息归属无效" }
            require(archive.messages.sumOf { it.items.size } <= MAX_MIGRATION_MESSAGES) { "迁移文件包含过多消息" }

            val existingIds = loadSessionsRaw().mapTo(mutableSetOf()) { it.id }
            val imported = archive.sessions.filterNot { it.id in existingIds }
            val importedIds = imported.mapTo(mutableSetOf()) { it.id }
            val messagesBySession = archive.messages.associateBy { it.sessionId }

            // Write message keys first and publish the session index last. If the process
            // stops midway, incomplete imports stay invisible and can safely be retried.
            imported.forEach { session ->
                val items = messagesBySession[session.id]?.items.orEmpty()
                val persisted = persistMessages(session.id, items.map { it.toDomain() })
                storage.remove(streamingMessageKey(session.id))
                messageFlow(session.id).value = persisted
            }
            val mergedSessions = (loadSessionsRaw() + imported).sortedByDescending { it.updatedAtEpochMs }
            persistSessions(mergedSessions)
            importedIds.size
        }

    private fun messageFlow(sessionId: String): MutableStateFlow<List<LocalMessage>> {
        val cached = flowLru.remove(sessionId)
        if (cached != null) {
            flowLru[sessionId] = cached
            return cached
        }
        evictInactiveFlowsLocked(MAX_CACHED_FLOWS - 1)
        val created = MutableStateFlow(loadMessages(sessionId))
        flowLru[sessionId] = created
        return created
    }

    private fun evictInactiveFlowsLocked(limit: Int = MAX_CACHED_FLOWS) {
        if (flowLru.size <= limit) return
        val iterator = flowLru.entries.iterator()
        while (iterator.hasNext() && flowLru.size > limit) {
            val entry = iterator.next()
            val sid = entry.key
            val flow = entry.value
            val isPinned = (pinnedObserverCounts[sid] ?: 0) > 0 || flow.subscriptionCount.value > 0
            val isWriting = sid in activeWritingSessionIds
            if (!isPinned && !isWriting) {
                iterator.remove()
            }
        }
    }

    private fun loadSessionsSorted(): List<ChatSession> =
        loadSessionsRaw()
            .map { it.toDomain() }
            .sortedWith(compareByDescending<ChatSession> { it.pinned }.thenByDescending { it.updatedAtEpochMs })

    private fun loadSessionsRaw(): List<SessionDto> {
        val json = storage.getStringOrNull(KEY_SESSIONS) ?: return emptyList()
        return runCatching {
            Agent567Json.decodeFromString(SessionListDto.serializer(), json).items
        }.getOrDefault(emptyList())
    }

    private fun persistSessions(items: List<SessionDto>) {
        storage[KEY_SESSIONS] =
            Agent567Json.encodeToString(SessionListDto.serializer(), SessionListDto(items))
        _sessions.value =
            items
                .map { it.toDomain() }
                .sortedWith(compareByDescending<ChatSession> { it.pinned }.thenByDescending { it.updatedAtEpochMs })
    }

    /** Decode only the fields the inbox needs. A damaged record fails this session's scan;
     * it must not silently erase its previously saved inbox entries. No repair or cache admission. */
    private fun readStoredTaskHeaders(sid: String): List<TaskMessageHeader> {
        fun decode(json: String) = Agent567Json.decodeFromString(InboxHeaderDto.serializer(), json)
        val indexed = storage.peekString(messageIndexKey(sid))
        val headers = if (indexed != null) Agent567Json.decodeFromString(MessageIndexDto.serializer(), indexed).ids.map { id ->
            decode(checkNotNull(storage.peekString(messageKey(sid, id)))).also { check(it.id == id && it.sessionId == sid) }
        } else storage.peekString(messagesKey(sid))?.let {
            Agent567Json.decodeFromString(InboxHeadersDto.serializer(), it).items
        }.orEmpty()
        val records = headers.associateByTo(linkedMapOf()) { it.id }
        storage.peekString(streamingMessageKey(sid))?.let { raw ->
            val checkpoint = decode(raw)
            if (checkpoint.status == MessageStatus.Streaming.name && records[checkpoint.id]?.status in listOf(null, MessageStatus.Streaming.name)) records[checkpoint.id] = checkpoint
        }
        return records.values.map {
            check(it.sessionId == sid)
            val status = MessageStatus.valueOf(it.status)
            TaskMessageHeader(it.id, ChatRole.fromApi(it.role), if (status == MessageStatus.Streaming) MessageStatus.Aborted else status, it.createdAtEpochMs, it.processingDurationMs)
        }.sortedBy { it.createdAtEpochMs }
    }

    private fun loadMessages(sessionId: String): List<LocalMessage> {
        return runCatching {
            val indexedMessages = storage.getStringOrNull(messageIndexKey(sessionId))?.let {
                loadMessageIndex(sessionId).mapNotNull { id ->
                    storage.getStringOrNull(messageKey(sessionId, id))?.let { json ->
                        runCatching { Agent567Json.decodeFromString(MessageDto.serializer(), json).toDomain() }.getOrNull()
                    }
                }
            }
            val messages = indexedMessages?.let { indexed ->
                if (indexed.any { message -> message.images.any { it.base64Data.isNotBlank() || it.pendingBytes != null } }) {
                    persistMessages(sessionId, indexed)
                } else {
                    indexed
                }
            } ?: storage.getStringOrNull(messagesKey(sessionId))?.let { json ->
                migrateLegacyMessages(sessionId, json)
            }.orEmpty()
            val checkpoint = storage.getStringOrNull(streamingMessageKey(sessionId))?.let { checkpointJson ->
                runCatching { Agent567Json.decodeFromString(MessageDto.serializer(), checkpointJson).toDomain() }.getOrNull()
            }?.takeIf { it.sessionId == sessionId && it.status == MessageStatus.Streaming }
            val recovered = messages.toMutableList()
            if (checkpoint != null) {
                val checkpointIndex = recovered.indexOfFirst { it.id == checkpoint.id }
                if (checkpointIndex < 0) recovered.add(checkpoint)
                else if (recovered[checkpointIndex].status == MessageStatus.Streaming) {
                    recovered[checkpointIndex] = checkpoint.withSavedImages(recovered[checkpointIndex])
                }
            }
            val reconciled = recovered.map { message ->
                if (message.status == MessageStatus.Streaming) message.copy(status = MessageStatus.Aborted) else message
            }.sortedBy { it.createdAtEpochMs }
            if (reconciled != messages || checkpoint != null) {
                persistMessages(sessionId, reconciled)
                storage.remove(streamingMessageKey(sessionId))
            }
            reconciled
        }.getOrDefault(emptyList())
    }

    private fun persistMessages(sessionId: String, messages: List<LocalMessage>): List<LocalMessage> {
        val oldIds = loadMessageIndex(sessionId).toSet()
        val oldImageKeys = oldIds.flatMap { id ->
            storage.getStringOrNull(messageKey(sessionId, id))?.let { json ->
                runCatching { Agent567Json.decodeFromString(MessageDto.serializer(), json).images.mapNotNull { it.storageKey } }
                    .getOrDefault(emptyList())
            }.orEmpty()
        }.toSet()
        val persisted = messages.map(::normalizeMessageForPersistence)
        persisted.forEach(::persistMessageRecord)
        val nextIds = persisted.map { it.id }
        persistMessageIndex(sessionId, nextIds)
        (oldIds - nextIds.toSet()).forEach { storage.remove(messageKey(sessionId, it)) }
        val referencedImages = persisted.flatMap { it.images }.mapNotNull { it.storageKey }.toSet()
        (oldImageKeys - referencedImages).forEach(imageFiles::delete)
        storage.remove(messagesKey(sessionId))
        return persisted
    }

    private fun persistMessageRecord(message: LocalMessage) {
        storage[messageKey(message.sessionId, message.id)] =
            Agent567Json.encodeToString(MessageDto.serializer(), message.toDto())
    }

    private fun persistMessageIndex(sessionId: String, ids: List<String>) {
        storage[messageIndexKey(sessionId)] =
            Agent567Json.encodeToString(MessageIndexDto.serializer(), MessageIndexDto(ids.distinct()))
    }

    private fun loadMessageIndex(sessionId: String): List<String> =
        storage.getStringOrNull(messageIndexKey(sessionId))?.let { json ->
            runCatching { Agent567Json.decodeFromString(MessageIndexDto.serializer(), json).ids }.getOrDefault(emptyList())
        }.orEmpty()

    private fun normalizeMessageForPersistence(message: LocalMessage): LocalMessage =
        message.copy(
            content = if (message.role == ChatRole.Assistant) message.content.boundedForStorage(MAX_STORED_ASSISTANT_CHARS) else message.content,
            images = message.images.map(::persistImage),
            toolEvents = message.toolEvents.takeLast(MAX_STORED_TOOL_EVENTS).map { event ->
                event.copy(
                    detail = event.detail?.boundedForStorage(MAX_STORED_TOOL_FIELD_CHARS),
                    arguments = event.arguments?.boundedForStorage(MAX_STORED_TOOL_FIELD_CHARS),
                    result = event.result?.boundedForStorage(MAX_STORED_TOOL_FIELD_CHARS),
                    phaseLabel = event.phaseLabel?.boundedForStorage(256),
                )
            },
        )

    private fun String.boundedForStorage(limit: Int): String {
        if (length <= limit) return this
        val marker = "\n[内容过长，已截断]"
        return take(limit - marker.length) + marker
    }

    private fun persistImage(image: MessageImage): MessageImage {
        if (image.pendingBytes == null && image.base64Data.isBlank()) return image
        val key = image.storageKey ?: newId()
        val stored = runCatching {
            if (image.pendingBytes != null) {
                imageFiles.writeBytes(key, image.pendingBytes)
            } else {
                imageFiles.writeBase64(key, image.base64Data)
            }
        }.getOrDefault(false)
        check(stored) { "图片附件写入本地存储失败，聊天记录未能安全保存" }
        return image.copy(base64Data = "", storageKey = key, pendingBytes = null)
    }

    private fun deleteUnreferencedImages(previous: List<MessageImage>, next: List<MessageImage>) {
        val nextKeys = next.mapNotNull { it.storageKey }.toSet()
        previous.mapNotNull { it.storageKey }.distinct().filterNot { it in nextKeys }.forEach(imageFiles::delete)
    }

    /** Migrates the legacy all-messages JSON one record at a time to avoid decoding every Base64 image together. */
    private fun migrateLegacyMessages(sessionId: String, json: String): List<LocalMessage> {
        val arrayStart = findItemsArrayStart(json) ?: error("旧聊天记录格式无效")
        val migrated = mutableListOf<LocalMessage>()
        val messageIds = mutableSetOf<String>()
        val writtenIds = mutableListOf<String>()
        val imageKeys = mutableListOf<String>()
        try {
            var index = arrayStart + 1
            var ended = false
            while (index < json.length) {
                while (index < json.length && (json[index].isWhitespace() || json[index] == ',')) index++
                if (index >= json.length) break
                if (json[index] == ']') {
                    ended = true
                    break
                }
                check(json[index] == '{') { "旧聊天记录格式无效" }
                val end = findJsonObjectEnd(json, index) ?: error("旧聊天记录格式不完整")
                val dto = Agent567Json.decodeFromString(MessageDto.serializer(), json.substring(index, end + 1))
                check(dto.sessionId == sessionId) { "旧聊天记录会话归属无效" }
                val normalized = normalizeMessageForPersistence(dto.toDomain())
                check(messageIds.add(normalized.id)) { "旧聊天记录包含重复消息" }
                writtenIds += normalized.id
                imageKeys += normalized.images.mapNotNull { it.storageKey }
                persistMessageRecord(normalized)
                migrated += normalized
                index = end + 1
            }
            check(ended) { "旧聊天记录格式不完整" }
            persistMessageIndex(sessionId, migrated.map { it.id })
        } catch (error: Throwable) {
            writtenIds.forEach { storage.remove(messageKey(sessionId, it)) }
            imageKeys.forEach(imageFiles::delete)
            throw error
        }
        storage.remove(messagesKey(sessionId))
        return migrated
    }

    private fun findItemsArrayStart(json: String): Int? {
        val key = "\"items\""
        val keyStart = json.indexOf(key)
        if (keyStart < 0) return null
        val colon = json.indexOf(':', keyStart + key.length)
        if (colon < 0) return null
        val bracket = json.indexOf('[', colon + 1)
        return bracket.takeIf { it >= 0 }
    }

    private fun findJsonObjectEnd(json: String, start: Int): Int? {
        var depth = 0
        var inString = false
        var escaped = false
        for (index in start until json.length) {
            val char = json[index]
            if (inString) {
                if (escaped) escaped = false
                else if (char == '\\') escaped = true
                else if (char == '"') inString = false
            } else {
                when (char) {
                    '"' -> inString = true
                    '{' -> depth++
                    '}' -> {
                        depth--
                        if (depth == 0) return index
                    }
                }
            }
        }
        return null
    }

    private fun String.utf8LengthAtMost(limit: Long): Boolean {
        var bytes = 0L
        var index = 0
        while (index < length) {
            val char = this[index]
            bytes += when {
                char.code <= 0x7F -> 1
                char.code <= 0x7FF -> 2
                char.isHighSurrogate() && index + 1 < length && this[index + 1].isLowSurrogate() -> {
                    index++
                    4
                }
                else -> 3
            }
            if (bytes > limit) return false
            index++
        }
        return true
    }

    @OptIn(ExperimentalEncodingApi::class)
    private fun readImageBytes(image: MessageImage): ByteArray? {
        image.pendingBytes?.let { return it }
        if (image.base64Data.isNotBlank()) {
            if (image.base64Data.length > org.agent567.android.domain.session.MAX_MESSAGE_IMAGE_BASE64_CHARS) return null
            return runCatching {
                val payload = image.base64Data.substringAfter(',', image.base64Data)
                    .filterNot(Char::isWhitespace)
                    .replace('-', '+')
                    .replace('_', '/')
                val padded = payload + "=".repeat((4 - payload.length % 4) % 4)
                Base64.decode(padded)
            }.getOrNull()
        }
        return image.storageKey?.let(imageFiles::readBytes)
    }

    @OptIn(ExperimentalEncodingApi::class)
    private fun LocalMessage.toMigrationDto(consumeImageBytes: (Long) -> Unit = {}): MessageDto {
        var missingImages = 0
        val imageDtos = images.mapNotNull { image ->
            val inline = if (image.base64Data.isNotBlank()) {
                consumeImageBytes(image.base64Data.length.toLong())
                image.base64Data
            } else {
                readImageBytes(image)?.let { bytes ->
                    consumeImageBytes(((bytes.size.toLong() + 2) / 3) * 4)
                    Base64.encode(bytes)
                }
            }
            if (inline == null) {
                missingImages++
                null
            } else {
                MessageImageDto(
                    id = image.id,
                    mimeType = image.mimeType,
                    fileName = image.fileName,
                    base64Data = inline,
                )
            }
        }
        val message = toDto()
        return message.copy(
            content = if (missingImages == 0) message.content else {
                message.content + "\n\n[备份提示：原记录中有 $missingImages 张图片文件缺失，未能导出]"
            },
            images = imageDtos,
        )
    }

    private fun messagesKey(sessionId: String) = "agent567.session.messages.$sessionId"

    private fun String.utf8ByteCount(): Long {
        var bytes = 0L
        var index = 0
        while (index < length) {
            val char = this[index]
            bytes += when {
                char.code <= 0x7f -> 1
                char.code <= 0x7ff -> 2
                char.isHighSurrogate() && index + 1 < length && this[index + 1].isLowSurrogate() -> {
                    index++
                    4
                }
                else -> 3
            }
            index++
        }
        return bytes
    }

    private fun messageIndexKey(sessionId: String) = "agent567.session.messages.v2.$sessionId.index"

    private fun messageKey(sessionId: String, messageId: String) =
        "agent567.session.messages.v2.$sessionId.item.$messageId"

    private fun streamingMessageKey(sessionId: String) = "agent567.session.streaming.$sessionId"

    private suspend fun <T> withStorageLock(block: () -> T): T =
        withContext(storageDispatcher) {
            mutex.withLock { block() }
        }

    private fun newId(): String {
        val time = nowEpochMs().toString(16)
        val rand = Random.nextLong().toULong().toString(16)
        return "$time-$rand"
    }

    companion object {
        private const val MAX_CACHED_FLOWS = 16
        private const val KEY_SESSIONS = "agent567.session.index"
        private const val MAX_STORED_ASSISTANT_CHARS = 1_000_000
        private const val MAX_STORED_TOOL_FIELD_CHARS = 8 * 1024
        private const val MAX_STORED_TOOL_EVENTS = 80
        private const val MIGRATION_SCHEMA_VERSION = 1
        private const val MAX_MIGRATION_JSON_BYTES = MIGRATION_BACKUP_MAX_BYTES
        private const val MAX_MIGRATION_SESSIONS = 20_000
        private const val MAX_MIGRATION_MESSAGES = 200_000
    }
}

@Serializable
@OptIn(ExperimentalSerializationApi::class)
private data class SessionMigrationArchiveDto(
    @EncodeDefault(EncodeDefault.Mode.ALWAYS)
    val schemaVersion: Int = 1,
    val exportedAtEpochMs: Long,
    val sessions: List<SessionDto>,
    val messages: List<SessionMigrationMessagesDto>,
)

@Serializable
private data class SessionMigrationMessagesDto(
    val sessionId: String,
    val items: List<MessageDto>,
)

@Serializable
private data class SessionListDto(val items: List<SessionDto> = emptyList())

@Serializable
private data class SessionDto(
    val id: String,
    val title: String,
    val modelId: String? = null,
    val modelName: String? = null,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val pinned: Boolean = false,
    val origin: String = ConversationOrigin.Cloud.name,
    val remoteDeviceId: String? = null,
    val remoteSessionId: String? = null,
    val remoteSessionCreatedOnMobile: Boolean = false,
    val titleManuallyEdited: Boolean = false,
    val context: MobileSessionContext = MobileSessionContext(),
)

@Serializable
private data class InboxHeaderDto(val id: String, val sessionId: String, val role: String, val status: String,
    val createdAtEpochMs: Long, val processingDurationMs: Long? = null)
@Serializable
private data class InboxHeadersDto(val items: List<InboxHeaderDto>)

@Serializable
private data class MessageIndexDto(val ids: List<String> = emptyList())

@Serializable
private data class MessageDto(
    val id: String,
    val sessionId: String,
    val role: String,
    val content: String,
    val status: String,
    val createdAtEpochMs: Long,
    val processingDurationMs: Long? = null,
    val errorMessage: String? = null,
    val images: List<MessageImageDto> = emptyList(),
    val files: List<MessageFileDto> = emptyList(),
    val toolEvents: List<ToolTraceDto> = emptyList(),
    val usage: TokenUsageDto? = null,
    val contextPercent: Int? = null,
    val pendingQuestion: PendingQuestionDto? = null,
    val sources: List<org.agent567.android.core.model.ChatSource> = emptyList(),
)

@Serializable
private data class ToolTraceDto(
    val phase: String,
    val toolCallId: String,
    val toolName: String,
    val detail: String? = null,
    val durationMs: Long? = null,
    val arguments: String? = null,
    val result: String? = null,
    val phaseLabel: String? = null,
)

@Serializable
private data class TokenUsageDto(
    val promptTokens: Int? = null,
    val completionTokens: Int? = null,
    val totalTokens: Int? = null,
)

@Serializable
private data class PendingQuestionDto(
    val sessionId: String = "",
    val requestId: String,
    val questions: List<QuestionDto> = emptyList(),
    val selections: Map<String, List<String>> = emptyMap(),
)

@Serializable
private data class QuestionDto(
    val question: String,
    val header: String = "",
    val options: List<QuestionOptionDto> = emptyList(),
    val multiSelect: Boolean = false,
)

@Serializable
private data class QuestionOptionDto(
    val label: String,
    val description: String = "",
)

@Serializable
private data class MessageImageDto(
    val id: String,
    val mimeType: String,
    val fileName: String? = null,
    /** Legacy/import-export payload. Normal session records store only [storageKey]. */
    val base64Data: String? = null,
    val storageKey: String? = null,
)

@Serializable
private data class MessageFileDto(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val sha256: String? = null,
    val readScope: String = "",
)

private fun SessionDto.toDomain() =
    ChatSession(
        id = id,
        title = title,
        modelId = modelId,
        modelName = modelName,
        createdAtEpochMs = createdAtEpochMs,
        updatedAtEpochMs = updatedAtEpochMs,
        pinned = pinned,
        origin = ConversationOrigin.entries.firstOrNull { it.name == origin } ?: ConversationOrigin.Cloud,
        remoteDeviceId = remoteDeviceId,
        remoteSessionId = remoteSessionId,
        remoteSessionCreatedOnMobile = remoteSessionCreatedOnMobile,
        titleManuallyEdited = titleManuallyEdited,
        context = context,
    )

private fun ChatSession.toDto() =
    SessionDto(
        id = id,
        title = title,
        modelId = modelId,
        modelName = modelName,
        createdAtEpochMs = createdAtEpochMs,
        updatedAtEpochMs = updatedAtEpochMs,
        pinned = pinned,
        origin = origin.name,
        remoteDeviceId = remoteDeviceId,
        remoteSessionId = remoteSessionId,
        remoteSessionCreatedOnMobile = remoteSessionCreatedOnMobile,
        titleManuallyEdited = titleManuallyEdited,
        context = context,
    )

private fun MessageDto.toDomain() =
    LocalMessage(
        id = id,
        sessionId = sessionId,
        role = ChatRole.fromApi(role),
        content = content,
        status = MessageStatus.entries.firstOrNull { it.name == status } ?: MessageStatus.Complete,
        createdAtEpochMs = createdAtEpochMs,
        processingDurationMs = processingDurationMs,
        errorMessage = errorMessage,
        images =
            images.map {
                org.agent567.android.domain.session.MessageImage(
                    id = it.id,
                    mimeType = it.mimeType,
                    fileName = it.fileName,
                    base64Data = it.base64Data.orEmpty(),
                    storageKey = it.storageKey,
                )
            },
        files = files.map {
            org.agent567.android.domain.session.MessageFileAttachment(
                id = it.id,
                fileName = it.fileName,
                mimeType = it.mimeType,
                sizeBytes = it.sizeBytes,
                sha256 = it.sha256, readScope = it.readScope,
            )
        },
        toolEvents = toolEvents.map {
            org.agent567.android.domain.session.ToolTrace(
                phase = it.phase,
                toolCallId = it.toolCallId,
                toolName = it.toolName,
                detail = it.detail,
                durationMs = it.durationMs,
                arguments = it.arguments,
                result = it.result,
                phaseLabel = it.phaseLabel,
            )
        },
        usage = usage?.let { TokenUsage(it.promptTokens, it.completionTokens, it.totalTokens) },
        contextPercent = contextPercent,
        pendingQuestion = pendingQuestion?.toDomain(),
        sources = org.agent567.android.core.model.normalizeChatSources(sources),
    )

private fun LocalMessage.toDto() =
    MessageDto(
        id = id,
        sessionId = sessionId,
        role = role.toApiValue(),
        content = content,
        status = status.name,
        createdAtEpochMs = createdAtEpochMs,
        processingDurationMs = processingDurationMs,
        errorMessage = errorMessage,
        images =
            images.map {
                MessageImageDto(
                    id = it.id,
                    mimeType = it.mimeType,
                    fileName = it.fileName,
                    base64Data = null,
                    storageKey = it.storageKey,
                )
            },
        files = files.map {
            MessageFileDto(it.id, it.fileName, it.mimeType, it.sizeBytes, it.sha256, it.readScope)
        },
        toolEvents = toolEvents.map {
            ToolTraceDto(
                phase = it.phase,
                toolCallId = it.toolCallId,
                toolName = it.toolName,
                detail = it.detail,
                durationMs = it.durationMs,
                arguments = it.arguments,
                result = it.result,
                phaseLabel = it.phaseLabel,
            )
        },
        usage = usage?.let { TokenUsageDto(it.promptTokens, it.completionTokens, it.totalTokens) },
        contextPercent = contextPercent,
        pendingQuestion = pendingQuestion?.toDto(),
        sources = sources,
    )

private fun PendingQuestionDto.toDomain() =
    PendingQuestion(
        sessionId = sessionId,
        requestId = requestId,
        questions =
            questions.map {
                ChatQuestion(
                    question = it.question,
                    header = it.header,
                    options = it.options.map { option -> ChatQuestionOption(option.label, option.description) },
                    multiSelect = it.multiSelect,
                )
            },
        selections = selections,
    )

private fun PendingQuestion.toDto() =
    PendingQuestionDto(
        sessionId = sessionId,
        requestId = requestId,
        questions =
            questions.map {
                QuestionDto(
                    question = it.question,
                    header = it.header,
                    options = it.options.map { option -> QuestionOptionDto(option.label, option.description) },
                    multiSelect = it.multiSelect,
                )
            },
        selections = selections,
    )
