package org.agent567.android.data.session

import com.russhwolf.settings.Settings
import com.russhwolf.settings.set
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatQuestion
import org.agent567.android.core.model.ChatQuestionOption
import org.agent567.android.core.model.TokenUsage
import org.agent567.android.core.net.VettaJson
import org.agent567.android.domain.session.ChatSession
import org.agent567.android.domain.session.ConversationOrigin
import org.agent567.android.domain.session.LocalMessage
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
    private val settings: Settings = Settings(),
    private val storageDispatcher: kotlinx.coroutines.CoroutineDispatcher = Dispatchers.IO,
) : SessionStore {
    private val mutex = Mutex()
    private val _sessions = MutableStateFlow(loadSessionsSorted())
    override val sessions: StateFlow<List<ChatSession>> = _sessions.asStateFlow()

    private val messagesFlows = MutableStateFlow<Map<String, MutableStateFlow<List<LocalMessage>>>>(emptyMap())

    override fun observeMessages(sessionId: String): Flow<List<LocalMessage>> =
        messageFlow(sessionId)

    override suspend fun getSession(id: String): ChatSession? =
        _sessions.value.firstOrNull { it.id == id }

    override suspend fun getMessages(sessionId: String): List<LocalMessage> =
        withStorageLock { messageFlow(sessionId).value }

    override suspend fun createSession(
        title: String,
        modelId: String?,
        modelName: String?,
        origin: ConversationOrigin,
        remoteDeviceId: String?,
        remoteSessionId: String?,
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
            persistSessions(loadSessionsRaw().filterNot { it.id == id })
            settings.remove(messagesKey(id))
            settings.remove(streamingMessageKey(id))
            messagesFlows.update { it - id }
        }
    }

    override suspend fun upsertMessage(message: LocalMessage) {
        withStorageLock {
            val current = loadMessages(message.sessionId).toMutableList()
            val idx = current.indexOfFirst { it.id == message.id }
            if (idx >= 0) current[idx] = message else current.add(message)
            val sorted = current.sortedBy { it.createdAtEpochMs }
            persistMessages(message.sessionId, sorted)
            settings.remove(streamingMessageKey(message.sessionId))
            messageFlow(message.sessionId).value = sorted

            // 触摸会话更新时间；首条用户消息生成标题
            val sessions = loadSessionsRaw().toMutableList()
            val sIdx = sessions.indexOfFirst { it.id == message.sessionId }
            if (sIdx >= 0) {
                var dto = sessions[sIdx]
                dto = dto.copy(updatedAtEpochMs = nowEpochMs())
                if (
                    message.role == ChatRole.User &&
                    dto.title == SessionStore.DEFAULT_TITLE &&
                    message.content.isNotBlank()
                ) {
                    dto = dto.copy(title = message.content.trim().take(40))
                }
                sessions[sIdx] = dto
                persistSessions(sessions.sortedByDescending { it.updatedAtEpochMs })
            }
        }
    }

    override suspend fun upsertStreamingMessage(message: LocalMessage) {
        withStorageLock {
            val current = messageFlow(message.sessionId).value.toMutableList()
            val idx = current.indexOfFirst { it.id == message.id }
            if (idx >= 0) current[idx] = message else current.add(message)
            val sorted = current.sortedBy { it.createdAtEpochMs }
            settings[streamingMessageKey(message.sessionId)] =
                VettaJson.encodeToString(MessageDto.serializer(), message.toDto())
            messageFlow(message.sessionId).value = sorted
        }
    }

    override suspend fun replaceMessages(sessionId: String, messages: List<LocalMessage>) {
        withStorageLock {
            val sorted = messages.sortedBy { it.createdAtEpochMs }
            persistMessages(sessionId, sorted)
            settings.remove(streamingMessageKey(sessionId))
            messageFlow(sessionId).value = sorted
        }
    }

    override suspend fun exportMigrationData(): String =
        withStorageLock {
            val sessions = loadSessionsRaw()
            val archive =
                SessionMigrationArchiveDto(
                    exportedAtEpochMs = nowEpochMs(),
                    sessions = sessions,
                    messages = sessions.map { session ->
                        SessionMigrationMessagesDto(
                            sessionId = session.id,
                            items = loadMessages(session.id).map { it.toDto() },
                        )
                    },
                )
            VettaJson.encodeToString(SessionMigrationArchiveDto.serializer(), archive)
        }

    override suspend fun importMigrationData(serialized: String): Int =
        withStorageLock {
            require(serialized.encodeToByteArray().size <= MAX_MIGRATION_JSON_BYTES) { "迁移文件过大" }
            val archive = VettaJson.decodeFromString(SessionMigrationArchiveDto.serializer(), serialized)
            require(archive.schemaVersion == MIGRATION_SCHEMA_VERSION) { "不支持的迁移文件版本" }
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
                persistMessages(session.id, items.map { it.toDomain() })
                settings.remove(streamingMessageKey(session.id))
                messageFlow(session.id).value = items.map { it.toDomain() }
            }
            val mergedSessions = (loadSessionsRaw() + imported).sortedByDescending { it.updatedAtEpochMs }
            persistSessions(mergedSessions)
            importedIds.size
        }

    private fun messageFlow(sessionId: String): MutableStateFlow<List<LocalMessage>> {
        while (true) {
            val current = messagesFlows.value
            current[sessionId]?.let { return it }
            val created = MutableStateFlow(loadMessages(sessionId))
            if (messagesFlows.compareAndSet(current, current + (sessionId to created))) return created
        }
    }

    private fun loadSessionsSorted(): List<ChatSession> =
        loadSessionsRaw()
            .map { it.toDomain() }
            .sortedWith(compareByDescending<ChatSession> { it.pinned }.thenByDescending { it.updatedAtEpochMs })

    private fun loadSessionsRaw(): List<SessionDto> {
        val json = settings.getStringOrNull(KEY_SESSIONS) ?: return emptyList()
        return runCatching {
            VettaJson.decodeFromString(SessionListDto.serializer(), json).items
        }.getOrDefault(emptyList())
    }

    private fun persistSessions(items: List<SessionDto>) {
        settings[KEY_SESSIONS] =
            VettaJson.encodeToString(SessionListDto.serializer(), SessionListDto(items))
        _sessions.value =
            items
                .map { it.toDomain() }
                .sortedWith(compareByDescending<ChatSession> { it.pinned }.thenByDescending { it.updatedAtEpochMs })
    }

    private fun loadMessages(sessionId: String): List<LocalMessage> {
        val messages = settings.getStringOrNull(messagesKey(sessionId))?.let { json ->
            runCatching {
                VettaJson.decodeFromString(MessageListDto.serializer(), json).items.map { it.toDomain() }
            }.getOrDefault(emptyList())
        }.orEmpty()
        val checkpoint = settings.getStringOrNull(streamingMessageKey(sessionId))?.let { checkpointJson ->
            runCatching { VettaJson.decodeFromString(MessageDto.serializer(), checkpointJson).toDomain() }.getOrNull()
        }?.takeIf { it.status == MessageStatus.Streaming }
            ?: return messages
        val checkpointIndex = messages.indexOfFirst { it.id == checkpoint.id }
        if (checkpointIndex < 0) return (messages + checkpoint).sortedBy { it.createdAtEpochMs }
        if (messages[checkpointIndex].status == MessageStatus.Streaming) {
            return messages.toMutableList().also { it[checkpointIndex] = checkpoint }
                .sortedBy { it.createdAtEpochMs }
        }
        return messages
    }

    private fun persistMessages(sessionId: String, messages: List<LocalMessage>) {
        settings[messagesKey(sessionId)] =
            VettaJson.encodeToString(
                MessageListDto.serializer(),
                MessageListDto(messages.map { it.toDto() }),
            )
    }

    private fun messagesKey(sessionId: String) = "vetta.session.messages.$sessionId"

    private fun streamingMessageKey(sessionId: String) = "vetta.session.streaming.$sessionId"

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
        private const val KEY_SESSIONS = "vetta.session.index"
        private const val MIGRATION_SCHEMA_VERSION = 1
        private const val MAX_MIGRATION_JSON_BYTES = MIGRATION_BACKUP_MAX_BYTES
        private const val MAX_MIGRATION_SESSIONS = 20_000
        private const val MAX_MIGRATION_MESSAGES = 200_000
    }
}

@Serializable
private data class SessionMigrationArchiveDto(
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
)

@Serializable
private data class MessageListDto(val items: List<MessageDto> = emptyList())

@Serializable
private data class MessageDto(
    val id: String,
    val sessionId: String,
    val role: String,
    val content: String,
    val status: String,
    val createdAtEpochMs: Long,
    val errorMessage: String? = null,
    val images: List<MessageImageDto> = emptyList(),
    val toolEvents: List<ToolTraceDto> = emptyList(),
    val usage: TokenUsageDto? = null,
    val contextPercent: Int? = null,
    val pendingQuestion: PendingQuestionDto? = null,
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
    val base64Data: String,
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
    )

private fun MessageDto.toDomain() =
    LocalMessage(
        id = id,
        sessionId = sessionId,
        role = ChatRole.fromApi(role),
        content = content,
        status = MessageStatus.entries.firstOrNull { it.name == status } ?: MessageStatus.Complete,
        createdAtEpochMs = createdAtEpochMs,
        errorMessage = errorMessage,
        images =
            images.map {
                org.agent567.android.domain.session.MessageImage(
                    id = it.id,
                    mimeType = it.mimeType,
                    fileName = it.fileName,
                    base64Data = it.base64Data,
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
    )

private fun LocalMessage.toDto() =
    MessageDto(
        id = id,
        sessionId = sessionId,
        role = role.toApiValue(),
        content = content,
        status = status.name,
        createdAtEpochMs = createdAtEpochMs,
        errorMessage = errorMessage,
        images =
            images.map {
                MessageImageDto(
                    id = it.id,
                    mimeType = it.mimeType,
                    fileName = it.fileName,
                    base64Data = it.base64Data,
                )
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
