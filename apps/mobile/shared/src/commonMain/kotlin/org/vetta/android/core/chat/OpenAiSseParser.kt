package org.vetta.android.core.chat

import org.vetta.android.core.api.ChatCompletionChunkDto
import org.vetta.android.core.api.toDomain
import org.vetta.android.core.error.VettaException
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.core.net.VettaJson

/**
 * 解析 OpenAI 兼容 SSE 单行（`data: {...}` / `data: [DONE]`）
 * 同时支持非流式 JSON 回退解析，确保无论网关是否缓冲都能完整展示内容。
 */
object OpenAiSseParser {
    fun parseLine(line: String): ChatStreamEvent? {
        val trimmed = line.trim()
        if (trimmed.isEmpty() || trimmed.startsWith(":")) return null
        if (!trimmed.startsWith("data:")) return null

        val data = trimmed.removePrefix("data:").trim()
        if (data.isEmpty()) return null
        if (data == "[DONE]") return ChatStreamEvent.Done

        val chunk =
            runCatching {
                VettaJson.decodeFromString(ChatCompletionChunkDto.serializer(), data)
            }.getOrElse { cause ->
                return ChatStreamEvent.Error(
                    VettaException.Protocol("无法解析 SSE chunk", cause),
                )
            }

        val choice = chunk.choices.firstOrNull()
        val deltaText = choice?.delta?.content
        val reasoningText = choice?.delta?.reasoningContent
        val messageText = choice?.message?.content?.let {
            if (it is kotlinx.serialization.json.JsonPrimitive) it.content else null
        }

        val toolCalls = choice?.delta?.toolCalls
        if (!toolCalls.isNullOrEmpty()) {
            val first = toolCalls.first()
            val fnName = first.function?.name
            val fnArgs = first.function?.arguments
            if (!fnName.isNullOrBlank() || !fnArgs.isNullOrBlank()) {
                return ChatStreamEvent.Tool(
                    phase = "call",
                    toolCallId = first.id ?: "call-image-1",
                    toolName = fnName ?: "generate_image",
                    arguments = fnArgs,
                    phaseLabel = "正在构思画面...",
                )
            }
        }

        if (!deltaText.isNullOrEmpty()) {
            return ChatStreamEvent.Delta(deltaText)
        }
        if (!reasoningText.isNullOrEmpty()) {
            return ChatStreamEvent.Delta(reasoningText)
        }
        if (!messageText.isNullOrEmpty()) {
            return ChatStreamEvent.Delta(messageText)
        }

        val finishReason = choice?.finishReason
        if (finishReason != null || chunk.usage != null) {
            return ChatStreamEvent.Finished(
                finishReason = finishReason,
                usage = chunk.usage?.toDomain(),
            )
        }

        return null
    }

    /**
     * 当网关或模型返回完整非流式 JSON 时（如 {"choices":[{"message":{"content":"..."}}]}），
     * 提取出完整的回复内容，避免前端因缺少 SSE data 前缀而展示空白内容。
     */
    fun parseNonStreamJson(jsonText: String): List<ChatStreamEvent> {
        val trimmed = jsonText.trim()
        if (!trimmed.startsWith("{")) return emptyList()
        return try {
            val root = VettaJson.parseToJsonElement(trimmed) as? kotlinx.serialization.json.JsonObject ?: return emptyList()
            val choices = root["choices"] as? kotlinx.serialization.json.JsonArray
            val firstChoice = choices?.firstOrNull() as? kotlinx.serialization.json.JsonObject
            val message = firstChoice?.get("message") as? kotlinx.serialization.json.JsonObject
            val delta = firstChoice?.get("delta") as? kotlinx.serialization.json.JsonObject

            val reasoning = (message?.get("reasoning_content") as? kotlinx.serialization.json.JsonPrimitive)?.content
                ?: (delta?.get("reasoning_content") as? kotlinx.serialization.json.JsonPrimitive)?.content

            val msgToolCalls = (message?.get("tool_calls") as? kotlinx.serialization.json.JsonArray)
            if (msgToolCalls != null && msgToolCalls.isNotEmpty()) {
                val first = msgToolCalls.first() as? kotlinx.serialization.json.JsonObject
                val fn = first?.get("function") as? kotlinx.serialization.json.JsonObject
                val fnName = (fn?.get("name") as? kotlinx.serialization.json.JsonPrimitive)?.content
                val fnArgs = (fn?.get("arguments") as? kotlinx.serialization.json.JsonPrimitive)?.content
                val id = (first?.get("id") as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "call-image-1"
                return listOf(
                    ChatStreamEvent.Tool(
                        phase = "call",
                        toolCallId = id,
                        toolName = fnName ?: "generate_image",
                        arguments = fnArgs,
                        phaseLabel = "正在构思画面...",
                    ),
                    ChatStreamEvent.Done
                )
            }

            val content = when (val c = message?.get("content") ?: delta?.get("content")) {
                is kotlinx.serialization.json.JsonPrimitive -> c.content
                is kotlinx.serialization.json.JsonArray -> {
                    c.mapNotNull { part ->
                        (part as? kotlinx.serialization.json.JsonObject)?.get("text")?.let {
                            (it as? kotlinx.serialization.json.JsonPrimitive)?.content
                        }
                    }.joinToString("")
                }
                else -> null
            }

            val textToEmit = buildString {
                if (!reasoning.isNullOrBlank()) {
                    append(reasoning)
                    if (!content.isNullOrBlank()) append("\n\n")
                }
                if (!content.isNullOrBlank()) {
                    append(content)
                }
            }

            if (textToEmit.isNotEmpty()) {
                listOf(ChatStreamEvent.Delta(textToEmit), ChatStreamEvent.Done)
            } else {
                emptyList()
            }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
