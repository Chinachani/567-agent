package org.agent567.android.core.chat

import org.agent567.android.core.api.ChatCompletionChunkDto
import org.agent567.android.core.api.toDomain
import org.agent567.android.core.error.Agent567Exception
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.net.Agent567Json

private const val MAX_TOOL_CALLS = 16
private const val MAX_TOOL_ARGUMENT_CHARS = 1_000_000
private const val MAX_TOTAL_TOOL_ARGUMENT_CHARS = 4_000_000

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
                Agent567Json.decodeFromString(ChatCompletionChunkDto.serializer(), data)
            }.getOrElse { cause ->
                return ChatStreamEvent.Error(
                    Agent567Exception.Protocol("无法解析 SSE chunk", cause),
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
        if (finishReason != null) {
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
            val root = Agent567Json.parseToJsonElement(trimmed) as? kotlinx.serialization.json.JsonObject ?: return emptyList()
            val choices = root["choices"] as? kotlinx.serialization.json.JsonArray
            val firstChoice = choices?.firstOrNull() as? kotlinx.serialization.json.JsonObject
            val message = firstChoice?.get("message") as? kotlinx.serialization.json.JsonObject
            val delta = firstChoice?.get("delta") as? kotlinx.serialization.json.JsonObject

            val reasoning = (message?.get("reasoning_content") as? kotlinx.serialization.json.JsonPrimitive)?.content
                ?: (delta?.get("reasoning_content") as? kotlinx.serialization.json.JsonPrimitive)?.content

            val msgToolCalls = (message?.get("tool_calls") as? kotlinx.serialization.json.JsonArray)
            if (msgToolCalls != null && msgToolCalls.isNotEmpty()) {
                if (msgToolCalls.size > MAX_TOOL_CALLS) {
                    return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol("工具调用数量超过安全上限")))
                }
                val calls = mutableListOf<ChatStreamEvent>()
                var totalArgumentChars = 0
                for (value in msgToolCalls) {
                    val call = value as? kotlinx.serialization.json.JsonObject
                        ?: return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol("工具调用格式无效")))
                    val function = call["function"] as? kotlinx.serialization.json.JsonObject
                    val name = (function?.get("name") as? kotlinx.serialization.json.JsonPrimitive)?.content
                    val arguments = (function?.get("arguments") as? kotlinx.serialization.json.JsonPrimitive)?.content
                    val id = (call["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                    if (id.isNullOrBlank() || name.isNullOrBlank() || arguments.isNullOrBlank()) {
                        return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol("工具调用缺少完整参数")))
                    }
                    totalArgumentChars += arguments.length
                    if (arguments.length > MAX_TOOL_ARGUMENT_CHARS || totalArgumentChars > MAX_TOTAL_TOOL_ARGUMENT_CHARS) {
                        return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol("工具参数超过安全长度限制")))
                    }
                    val parsedArguments = runCatching { Agent567Json.parseToJsonElement(arguments) }.getOrNull()
                    if (parsedArguments !is kotlinx.serialization.json.JsonObject) {
                        return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol("工具调用参数必须是有效 JSON 对象")))
                    }
                    calls += ChatStreamEvent.Tool(
                        phase = "call",
                        toolCallId = id,
                        toolName = name,
                        arguments = arguments,
                        phaseLabel = "正在构思画面...",
                    )
                }
                return calls + ChatStreamEvent.Done
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

/** Stateful parser for one HTTP stream. Tool calls are emitted only after the
 * provider signals a terminal tool-call chunk, so argument fragments cannot
 * trigger duplicate paid actions. */
class OpenAiSseStreamParser {
    private data class PendingToolCall(
        val arguments: StringBuilder = StringBuilder(),
        var id: String = "",
        var name: String = "",
    )
    private val pending = linkedMapOf<Int, PendingToolCall>()
    private var totalToolArgumentChars = 0

    fun parseLine(line: String): List<ChatStreamEvent> {
        val trimmed = line.trim()
        if (!trimmed.startsWith("data:")) return emptyList()
        val data = trimmed.removePrefix("data:").trim()
        if (data == "[DONE]") {
            val tools = flushTools()
            return if (tools.any { it is ChatStreamEvent.Error }) tools else tools + ChatStreamEvent.Done
        }
        if (data.isEmpty()) return emptyList()
        val chunk = runCatching {
            Agent567Json.decodeFromString(ChatCompletionChunkDto.serializer(), data)
        }.getOrElse { cause ->
            return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol("无法解析 SSE chunk", cause)))
        }
        val choice = chunk.choices.firstOrNull()
        val toolCalls = choice?.delta?.toolCalls.orEmpty()
        for (part in toolCalls) {
            if (!pending.containsKey(part.index) && pending.size >= MAX_TOOL_CALLS) {
                clearTools()
                return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol("工具调用数量超过安全上限")))
            }
            val call = pending.getOrPut(part.index) { PendingToolCall() }
            part.id?.takeIf(String::isNotBlank)?.let { call.id = it }
            part.function?.name?.takeIf(String::isNotBlank)?.let { call.name = it }
            part.function?.arguments?.let { fragment ->
                if (call.arguments.length + fragment.length > MAX_TOOL_ARGUMENT_CHARS ||
                    totalToolArgumentChars + fragment.length > MAX_TOTAL_TOOL_ARGUMENT_CHARS
                ) {
                    clearTools()
                    return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol("工具参数超过安全长度限制")))
                }
                call.arguments.append(fragment)
                totalToolArgumentChars += fragment.length
            }
        }
        val output = mutableListOf<ChatStreamEvent>()
        if (toolCalls.isEmpty()) {
            val event = OpenAiSseParser.parseLine(line)
            if (event != null && event !is ChatStreamEvent.Finished) {
                output += event
            }
        }
        if (choice?.finishReason != null) {
            val tools = flushTools()
            output += tools
            if (tools.any { it is ChatStreamEvent.Error }) return output
            output += ChatStreamEvent.Finished(choice.finishReason, chunk.usage?.toDomain())
        }
        return output
    }

    private fun flushTools(): List<ChatStreamEvent> {
        val calls = mutableListOf<ChatStreamEvent>()
        for (call in pending.values) {
            val arguments = call.arguments.toString()
            if (call.id.isBlank() || call.name.isBlank() || arguments.isBlank()) {
                clearTools()
                return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol("工具调用缺少完整参数")))
            }
            val parsed = runCatching { Agent567Json.parseToJsonElement(arguments) }.getOrNull()
            if (parsed !is kotlinx.serialization.json.JsonObject) {
                clearTools()
                return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol("工具调用参数必须是有效 JSON 对象")))
            }
            calls += ChatStreamEvent.Tool(
                phase = "call",
                toolCallId = call.id,
                toolName = call.name,
                arguments = arguments,
                phaseLabel = "正在构思画面...",
            )
        }
        clearTools()
        return calls
    }

    private fun clearTools() {
        pending.clear()
        totalToolArgumentChars = 0
    }
}
