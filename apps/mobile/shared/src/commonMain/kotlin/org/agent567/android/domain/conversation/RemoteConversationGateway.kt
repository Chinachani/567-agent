package org.agent567.android.domain.conversation

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.model.LlmModel
import org.agent567.android.core.model.ChatRole
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.domain.device.DesktopDevice

data class RemoteSessionModelCatalog(
    val currentModelId: String?,
    val models: List<LlmModel>,
    val lastUserMessageId: String? = null,
)

data class RemoteDesktopSessionSummary(
    val id: String,
    val title: String,
    val updatedAtEpochMs: Long,
)

data class RemoteDesktopSessionCatalog(
    val sessions: List<RemoteDesktopSessionSummary>,
    val failedDirectoryCount: Int = 0,
)

data class RemoteDesktopHistoryMessage(
    val id: String,
    val role: ChatRole,
    val text: String,
    val timestamp: Long,
    val status: MessageStatus = MessageStatus.Complete,
)

data class RemoteDesktopImageChunk(
    val mimeType: String,
    val sizeBytes: Int,
    val dataBase64: String,
)

data class RemoteToolboxAbility(
    val slug: String,
    val type: String,
    val name: String,
    val description: String,
    val version: String,
    val author: String,
    val category: String,
    val tags: List<String>,
    val installable: Boolean,
    val installed: Boolean,
)

data class RemotePromptFileAttachment(
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray,
)

interface RemoteConversationGateway {
    val devices: StateFlow<List<DesktopDevice>>

    suspend fun connect(target: String): Boolean

    suspend fun connect(targets: List<String>): Boolean {
        for (target in targets) if (connect(target)) return true
        return false
    }

    suspend fun disconnect(deviceId: String)

    suspend fun listDesktopSessions(deviceId: String): List<RemoteDesktopSessionSummary>? = null

    suspend fun readDesktopSessionCatalog(deviceId: String): RemoteDesktopSessionCatalog? =
        listDesktopSessions(deviceId)?.let { RemoteDesktopSessionCatalog(it) }

    suspend fun deleteDesktopSession(deviceId: String, remoteSessionId: String): Boolean? = null

    suspend fun deleteEmptyDesktopSession(deviceId: String, remoteSessionId: String): Boolean? = null

    suspend fun readDesktopSessionHistory(
        localSessionId: String,
        remoteSessionId: String,
    ): List<RemoteDesktopHistoryMessage>? = null

    suspend fun readDesktopGeneratedImageChunk(
        localSessionId: String,
        remoteSessionId: String,
        imageId: String,
        offset: Int,
        length: Int,
    ): RemoteDesktopImageChunk? = null

    suspend fun sendEncryptedSessionMigrationArchive(
        deviceId: String,
        archive: ByteArray,
        passphrase: String,
        onAwaitingApproval: () -> Unit = {},
        onProgress: (completedChunks: Int, totalChunks: Int) -> Unit = { _, _ -> },
    ): Boolean? = null

    suspend fun createDesktopSession(localSessionId: String, deviceId: String): Pair<String, RemoteSessionModelCatalog>? = null

    suspend fun readDesktopSessionModels(localSessionId: String, remoteSessionId: String): RemoteSessionModelCatalog? = null

    suspend fun selectDesktopSessionModel(
        localSessionId: String,
        remoteSessionId: String,
        modelId: String,
    ): RemoteSessionModelCatalog? = null

    suspend fun readDesktopPromptSuggestions(localSessionId: String, remoteSessionId: String): List<String>? = null

    suspend fun readDesktopToolbox(deviceId: String): List<RemoteToolboxAbility>? = null

    suspend fun installDesktopToolboxAbility(deviceId: String, type: String, slug: String): Boolean? = null

    fun stream(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
        retryPreviousTurn: Boolean = false,
    ): Flow<ChatStreamEvent>

    fun streamWithAttachments(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
        retryPreviousTurn: Boolean,
        promptText: String,
        files: List<RemotePromptFileAttachment>,
    ): Flow<ChatStreamEvent> = stream(localSessionId, deviceId, remoteSessionId, messages, retryPreviousTurn)

    fun resolvedRemoteSessionId(localSessionId: String): String?

    suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?)

    suspend fun respond(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        requestId: String,
        answers: List<Pair<String, List<String>>>,
        cancelled: Boolean = false,
    )
}

object UnavailableRemoteConversationGateway : RemoteConversationGateway {
    override val devices: StateFlow<List<DesktopDevice>> = MutableStateFlow(emptyList())

    override suspend fun connect(target: String): Boolean = false

    override suspend fun disconnect(deviceId: String) = Unit

    override fun stream(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
        retryPreviousTurn: Boolean,
    ): Flow<ChatStreamEvent> =
        kotlinx.coroutines.flow.flow {
            throw RemoteConversationException("桌面连接已断开，请重新连接后再试")
        }

    override fun resolvedRemoteSessionId(localSessionId: String): String? = null

    override suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?) = Unit

    override suspend fun respond(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        requestId: String,
        answers: List<Pair<String, List<String>>>,
        cancelled: Boolean,
    ) = Unit
}

class RemoteConversationException(message: String) : IllegalStateException(message)
