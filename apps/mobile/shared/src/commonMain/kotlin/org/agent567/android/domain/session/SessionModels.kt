package org.agent567.android.domain.session

import org.agent567.android.core.model.ChatContentPart
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatQuestion
import org.agent567.android.core.model.TokenUsage

enum class MessageStatus {
    Pending,
    Streaming,
    Complete,
    Error,
    Aborted,
}

enum class ConversationOrigin {
    Cloud,
    Desktop,
}

data class ChatSession(
    val id: String,
    val title: String,
    val modelId: String?,
    val modelName: String?,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val pinned: Boolean = false,
    val origin: ConversationOrigin = ConversationOrigin.Cloud,
    val remoteDeviceId: String? = null,
    val remoteSessionId: String? = null,
    /** This mirror represents a new Desktop session initiated from the mobile app. */
    val remoteSessionCreatedOnMobile: Boolean = false,
    val titleManuallyEdited: Boolean = false,
)

data class MessageImage(
    val id: String,
    val mimeType: String,
    val fileName: String? = null,
    /** Inline data is only held while composing, importing legacy data, or making a request. */
    val base64Data: String = "",
    /** App-private image file key. Message metadata persists this instead of image bytes. */
    val storageKey: String? = null,
    /** Raw picker bytes stay unencoded until the SessionStore writes the image file. */
    val pendingBytes: ByteArray? = null,
) {
    fun toContentPart(): ChatContentPart.Image =
        ChatContentPart.Image(mimeType = mimeType, base64Data = base64Data)
}

data class MessageFileAttachment(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val sizeBytes: Long,
)

data class LocalMessage(
    val id: String,
    val sessionId: String,
    val role: ChatRole,
    val content: String,
    val status: MessageStatus,
    val createdAtEpochMs: Long,
    val errorMessage: String? = null,
    val images: List<MessageImage> = emptyList(),
    /** File bytes stay on the desktop; the phone stores display metadata only. */
    val files: List<MessageFileAttachment> = emptyList(),
    val toolEvents: List<ToolTrace> = emptyList(),
    val usage: TokenUsage? = null,
    val contextPercent: Int? = null,
    /** 待用户回答的问题属于这条 assistant 消息，持久化后可在切换/重启后继续处理。 */
    val pendingQuestion: PendingQuestion? = null,
) {
    fun toChatMessage(): ChatMessage {
        val parts = mutableListOf<ChatContentPart>()
        if (content.isNotEmpty()) {
            parts.add(ChatContentPart.Text(content))
        }
        images.forEach { parts.add(it.toContentPart()) }
        if (parts.isEmpty()) {
            parts.add(ChatContentPart.Text(""))
        }
        return ChatMessage(role = role, parts = parts)
    }

    val hasVisualContent: Boolean
        get() = content.isNotBlank() || images.isNotEmpty() || files.isNotEmpty()
}

data class ToolTrace(
    val phase: String,
    val toolCallId: String,
    val toolName: String,
    val detail: String? = null,
    val durationMs: Long? = null,
    val arguments: String? = null,
    val result: String? = null,
    val phaseLabel: String? = null,
)

data class PendingQuestion(
    val sessionId: String = "",
    val requestId: String,
    val questions: List<ChatQuestion>,
    val selections: Map<String, List<String>> = emptyMap(),
)

expect fun nowEpochMs(): Long

expect fun formatLocalMessageTime(epochMs: Long): String
