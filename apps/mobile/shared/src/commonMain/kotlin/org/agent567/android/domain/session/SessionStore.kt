package org.agent567.android.domain.session

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

interface SessionStore {
    val sessions: StateFlow<List<ChatSession>>

    fun observeMessages(sessionId: String): Flow<List<LocalMessage>>

    suspend fun getSession(id: String): ChatSession?

    suspend fun refresh() = Unit

    suspend fun getMessages(sessionId: String): List<LocalMessage>

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
