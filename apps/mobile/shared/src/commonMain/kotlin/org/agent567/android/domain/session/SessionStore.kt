package org.agent567.android.domain.session

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

data class TaskMessageHeader(val id: String, val role: org.agent567.android.core.model.ChatRole, val status: MessageStatus,
    val createdAtEpochMs: Long, val processingDurationMs: Long?)

internal fun LocalMessage.taskHeader() = TaskMessageHeader(id, role, status, createdAtEpochMs, processingDurationMs)

interface SessionStore {
    val sessions: StateFlow<List<ChatSession>>

    fun observeMessages(sessionId: String): Flow<List<LocalMessage>>

    suspend fun getSession(id: String): ChatSession?

    suspend fun refresh() = Unit

    suspend fun hasDraft(sessionId: String): Boolean = false

    suspend fun getDraft(sessionId: String, owner: String): SessionDraft = SessionDraft()

    suspend fun saveDraft(sessionId: String, owner: String, draft: SessionDraft) = Unit

    suspend fun getMessages(sessionId: String): List<LocalMessage>

    /** Read messages without creating/warming flow or running disk repairs (e.g. for inbox/task results). */
    suspend fun readTaskMessageHeaders(sessionId: String): List<TaskMessageHeader> = getMessages(sessionId).map { it.taskHeader() }

    /** Saves pending/legacy image payloads and returns file-backed message metadata. */
    suspend fun persistMessageImages(images: List<MessageImage>): List<MessageImage> = images

    /** Reads one file-backed image only when a request or export needs its bytes. */
    suspend fun readMessageImageBytes(image: MessageImage): ByteArray? = image.pendingBytes

    suspend fun createSession(
        title: String = DEFAULT_TITLE,
        modelId: String? = null,
        modelName: String? = null,
        origin: ConversationOrigin = ConversationOrigin.Cloud,
        remoteDeviceId: String? = null,
        remoteSessionId: String? = null,
        remoteSessionCreatedOnMobile: Boolean = false,
    ): ChatSession

    suspend fun updateSession(session: ChatSession)

    suspend fun deleteSession(id: String)

    suspend fun upsertMessage(message: LocalMessage)

    /** Finalize only the existing active row; a deleted/terminal reply cannot be resurrected. */
    suspend fun finishStreamingMessage(message: LocalMessage)

    /** Attach to the latest revision without replacing concurrently published text or status. */
    suspend fun attachMessageImage(sessionId: String, messageId: String, image: MessageImage)

    /** Update in-memory message flow for streaming UI display (~70ms) without disk write. */
    suspend fun updateInMemoryStreamingMessage(message: LocalMessage) = upsertStreamingMessage(message)

    /** Periodic streaming checkpoint (~1s) to disk. */
    suspend fun checkpointStreamingMessage(message: LocalMessage) = upsertStreamingMessage(message)

    /** Persist an in-progress assistant snapshot without rewriting the full conversation history when supported. */
    suspend fun upsertStreamingMessage(message: LocalMessage) = upsertMessage(message)

    suspend fun replaceMessages(sessionId: String, messages: List<LocalMessage>)

    suspend fun exportMigrationData(
        maxBytes: Long,
        onProgress: (completed: Int, total: Int) -> Unit = { _, _ -> },
    ): String

    suspend fun importMigrationData(serialized: String): Int

    companion object {
        const val DEFAULT_TITLE = "新对话"
    }
}
