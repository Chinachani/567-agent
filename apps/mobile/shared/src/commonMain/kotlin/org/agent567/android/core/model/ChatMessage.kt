package org.agent567.android.core.model

import kotlinx.serialization.Serializable

enum class ChatRole {
    System,
    User,
    Assistant,
    Tool,
    ;

    fun toApiValue(): String =
        when (this) {
            System -> "system"
            User -> "user"
            Assistant -> "assistant"
            Tool -> "tool"
        }

    companion object {
        fun fromApi(value: String): ChatRole =
            when (value.lowercase()) {
                "system" -> System
                "assistant" -> Assistant
                "tool" -> Tool
                else -> User
            }
    }
}

/**
 * 发给 Gateway 的消息。文本与图片统一为 [parts]，由 [org.agent567.android.core.chat.ChatRequestEncoder]
 * 编码为 OpenAI 兼容 wire 形态。
 */
@Serializable
data class ChatToolCall(
    val id: String,
    val name: String,
    val arguments: String,
)

@Serializable
data class AssistantReplayState(
    val inferenceApi: String,
    val serviceIdentity: String,
    val groupName: String? = null,
    val modelId: String,
    val reasoningItems: List<String> = emptyList(),
    val toolCalls: List<ChatToolCall> = emptyList(),
    val signedReasoningReset: Boolean = false,
) {
    override fun toString(): String =
        "AssistantReplayState(inferenceApi=$inferenceApi, serviceIdentity=$serviceIdentity, " +
            "groupName=${groupName.orEmpty()}, modelId=$modelId, " +
            "reasoningCount=${reasoningItems.size}, toolCalls=${toolCalls.size}, " +
            "signedReasoningReset=$signedReasoningReset)"
}

data class ChatMessage(
    val role: ChatRole,
    val parts: List<ChatContentPart>,
    val replayState: AssistantReplayState? = null,
    val toolCallId: String? = null,
) {
    constructor(role: ChatRole, content: String) : this(
        role = role,
        parts = if (content.isEmpty()) emptyList() else listOf(ChatContentPart.Text(content)),
        replayState = null,
        toolCallId = null,
    )

    val textContent: String
        get() =
            parts
                .filterIsInstance<ChatContentPart.Text>()
                .joinToString("") { it.text }
}

sealed class ChatContentPart {
    data class Text(val text: String) : ChatContentPart()

    data class Image(
        val mimeType: String,
        val base64Data: String,
    ) : ChatContentPart() {
        val dataUrl: String
            get() = "data:$mimeType;base64,$base64Data"
    }
}

/**
 * Gateway 流式事件。UI 层按序消费即可拼出 assistant 气泡。
 */
sealed class ChatStreamEvent {
    data class Delta(val text: String, val sources: List<ChatSource> = emptyList()) : ChatStreamEvent()

    /** A remote recovery snapshot replaces text; it must never execute tool calls. */
    data class Snapshot(
        val text: String,
        val tools: List<Tool>,
        val input: UserInputRequired?,
        val state: String,
        val usage: State?,
        val truncated: Boolean = false,
        val sources: List<ChatSource> = emptyList(),
    ) : ChatStreamEvent()

    data class Tool(
        val phase: String,
        val toolCallId: String,
        val toolName: String,
        val detail: String? = null,
        val durationMs: Long? = null,
        val arguments: String? = null,
        val result: String? = null,
        val phaseLabel: String? = null,
        val images: List<RemoteGeneratedImageRef> = emptyList(),
    ) : ChatStreamEvent()

    data class UserInputRequired(
        val requestId: String,
        val questions: List<ChatQuestion>,
    ) : ChatStreamEvent()

    data class State(
        val value: String,
        val detail: String? = null,
        val detailCode: String? = null,
        val usage: TokenUsage? = null,
        val contextPercent: Int? = null,
    ) : ChatStreamEvent()

    data class Finished(
        val finishReason: String?,
        val usage: TokenUsage? = null,
    ) : ChatStreamEvent()

    data class ReplayState(val replayState: AssistantReplayState) : ChatStreamEvent()

    data object Done : ChatStreamEvent()

    data class Error(val exception: Throwable) : ChatStreamEvent()
}

data class RemoteGeneratedImageRef(
    val id: String,
    val mimeType: String,
)

data class ChatQuestion(
    val question: String,
    val header: String = "",
    val options: List<ChatQuestionOption> = emptyList(),
    val multiSelect: Boolean = false,
)

data class ChatQuestionOption(
    val label: String,
    val description: String = "",
)

data class TokenUsage(
    val promptTokens: Int? = null,
    val completionTokens: Int? = null,
    val totalTokens: Int? = null,
)
