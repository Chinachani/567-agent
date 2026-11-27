package org.agent567.android.core.chat

import kotlinx.serialization.json.*
import org.agent567.android.core.error.Agent567Exception
import org.agent567.android.core.model.*
import org.agent567.android.core.net.Agent567Json

private const val MAX_REASONING_ITEMS = 64
private const val MAX_REASONING_ITEM_CHARS = 1_000_000

/** One HTTP attempt. Tools are released only by a completed response, never by argument deltas. */
class ResponsesSseStreamParser {
    private val data = StringBuilder()
    private val streamedText = mutableMapOf<Pair<Int, Int>, StringBuilder>()
    private var textChars = 0
    private val completedTools = linkedMapOf<Int, JsonObject>()
    private val completedReasoning = linkedMapOf<Int, JsonObject>()
    private var terminal = false
    private var hasText = false
    internal var hiddenActivityCount = 0L
        private set
    internal var lastFailureFromStreamError = false
        private set
    private var lastReasoningItems: List<String> = emptyList()
    private var lastToolCalls: List<ChatToolCall> = emptyList()

    internal fun completedReasoningItems(): List<String> = lastReasoningItems

    internal fun completedToolCalls(): List<ChatToolCall> = lastToolCalls

    fun parseLine(line: String): List<ChatStreamEvent> {
        if (terminal) return emptyList()
        if (line.isBlank()) return flush()
        if (!line.startsWith("data:")) return emptyList()
        if (data.length + line.length > 1_000_000) return fail("Responses 事件超过安全长度限制")
        if (data.isNotEmpty()) data.append('\n')
        data.append(line.removePrefix("data:").trimStart())
        return emptyList()
    }

    fun finish(): List<ChatStreamEvent> = if (terminal) emptyList() else flush()

    fun parseNonStreamJson(text: String): List<ChatStreamEvent> {
        if (terminal) return emptyList()
        val response = runCatching { Agent567Json.parseToJsonElement(text) as? JsonObject }.getOrNull()
            ?: return fail("无法解析 Responses 响应")
        return complete(response, response.string("status"))
    }

    private fun flush(): List<ChatStreamEvent> {
        if (data.isEmpty()) return emptyList()
        val raw = data.toString(); data.clear()
        // [DONE] alone is not proof that a Responses response completed.
        if (raw == "[DONE]") return emptyList()
        val event = runCatching { Agent567Json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
            ?: return fail("无法解析 Responses 事件")
        return when (event.string("type")) {
            "response.output_text.delta", "response.refusal.delta" -> {
                val key = (event.int("output_index") ?: 0) to (event.int("content_index") ?: 0)
                if (key.first < 0 || key.second < 0 || (key !in streamedText && streamedText.size >= 256)) return fail("Responses 内容数量超过安全上限")
                val delta = event.string("delta").orEmpty()
                if (textChars.toLong() + delta.length > 4_000_000) return fail("Responses 正文超过安全长度限制")
                streamedText.getOrPut(key) { StringBuilder() }.append(delta)
                textChars += delta.length
                if (delta.isEmpty()) emptyList() else { hasText = true; listOf(ChatStreamEvent.Delta(delta)) }
            }
            "response.output_text.annotation.added" -> {
                val sources = event["annotation"]?.let { providerSources(JsonArray(listOf(it)), nested = false) }.orEmpty()
                if (sources.isEmpty()) emptyList() else listOf(ChatStreamEvent.Delta("", sources))
            }
            "response.reasoning_text.delta", "response.reasoning_summary_text.delta" -> {
                hiddenActivityCount += 1
                emptyList()
            }
            "response.function_call_arguments.delta", "response.function_call_arguments.done" -> {
                hiddenActivityCount += 1
                emptyList()
            }
            "response.output_item.added", "response.output_item.done" -> {
                val item = event["item"] as? JsonObject
                val itemType = item?.string("type")
                if (itemType == "function_call" || itemType == "reasoning") hiddenActivityCount += 1
                if (event.string("type") == "response.output_item.done") {
                    when (itemType) {
                        "function_call" -> {
                            val index = event.int("output_index") ?: return fail("工具调用缺少序号")
                            if (index < 0 || (index !in completedTools && completedTools.size >= 16)) return fail("工具调用数量超过安全上限")
                            completedTools[index] = item
                            if (!validToolBudgets(completedTools.values)) return fail("工具参数超过安全长度限制")
                        }
                        "reasoning" -> {
                            val index = event.int("output_index") ?: completedReasoning.size
                            if (index >= 0 && isSignedReasoningJsonObject(item)) {
                                if ((index in completedReasoning || completedReasoning.size < MAX_REASONING_ITEMS) &&
                                    item.toString().length <= MAX_REASONING_ITEM_CHARS
                                ) {
                                    completedReasoning[index] = item
                                }
                            }
                        }
                    }
                }
                emptyList()
            }
            "response.completed" -> complete(event["response"] as? JsonObject, "completed")
            "response.incomplete" -> complete(event["response"] as? JsonObject, "incomplete")
            "response.failed", "error" -> {
                val response = event["response"] as? JsonObject
                val errorObj = response?.get("error") as? JsonObject ?: event["error"] as? JsonObject ?: event
                val errorCode = errorObj.string("code")?.takeIf { it.isNotBlank() }
                val errorMessage = errorObj.string("message").orEmpty().take(500)
                usageEvent(response) + fail("Responses 请求失败：$errorMessage", providerCode = errorCode, fromStreamError = true)
            }
            "response.cancelled" -> {
                val response = event["response"] as? JsonObject
                val errorObj = response?.get("error") as? JsonObject ?: event["error"] as? JsonObject ?: event
                val errorCode = errorObj.string("code")?.takeIf { it.isNotBlank() }
                val errorMessage = errorObj.string("message").orEmpty().take(500)
                usageEvent(response) + fail("Responses 请求失败：$errorMessage", providerCode = errorCode, fromStreamError = false)
            }
            else -> emptyList()
        }
    }

    private fun complete(response: JsonObject?, expectedStatus: String?): List<ChatStreamEvent> {
        val status = response?.string("status")
        if (response == null || status !in listOf("completed", "incomplete") || status != expectedStatus) return fail("Responses 未成功完成")
        val output = response["output"] as? JsonArray ?: JsonArray(emptyList())
        if (output.size > 256) return fail("Responses 内容数量超过安全上限")
        val events = mutableListOf<ChatStreamEvent>()
        val tools = completedTools.toMutableMap()
        val reasoning = completedReasoning.toMutableMap()
        for ((index, value) in output.withIndex()) {
            val item = value as? JsonObject ?: return fail("Responses 内容格式无效")
            when (item.string("type")) {
                "message" -> {
                    val content = item["content"] as? JsonArray ?: continue
                    if (content.size > 256) return fail("Responses 内容数量超过安全上限")
                    for ((partIndex, partValue) in content.withIndex()) {
                        val part = partValue as? JsonObject ?: continue
                        val text = when (part.string("type")) { "output_text" -> part.string("text"); "refusal" -> part.string("refusal"); else -> null } ?: continue
                        val consumed = streamedText[index to partIndex]?.toString().orEmpty()
                        if (!text.startsWith(consumed)) return fail("Responses 正文不完整")
                        val suffix = text.drop(consumed.length)
                        val sources = if (part.string("type") == "output_text") providerSources(part["annotations"], nested = false) else emptyList()
                        if (suffix.isNotEmpty() || sources.isNotEmpty()) events += ChatStreamEvent.Delta(suffix, sources)
                        if (suffix.isNotEmpty()) hasText = true
                    }
                }
                "function_call" -> {
                    tools[index] = item
                }
                "reasoning" -> {
                    hiddenActivityCount += 1
                    if (isSignedReasoningJsonObject(item) &&
                        (index in reasoning || reasoning.size < MAX_REASONING_ITEMS) &&
                        item.toString().length <= MAX_REASONING_ITEM_CHARS
                    ) {
                        reasoning[index] = item
                    } else {
                        reasoning.remove(index)
                    }
                }
            }
        }
        val replayTools = mutableListOf<ChatToolCall>()
        if (status == "completed") {
            if (tools.size > 16 || !validToolBudgets(tools.values)) return fail("工具参数超过安全长度限制")
            val ids = mutableSetOf<String>()
            for (tool in tools.toSortedMap().values) {
                val id = tool.string("call_id"); val name = tool.string("name"); val args = tool.string("arguments")
                if (id.isNullOrBlank() || name.isNullOrBlank() || args.isNullOrBlank() || !ids.add(id) ||
                    runCatching { Agent567Json.parseToJsonElement(args) }.getOrNull() !is JsonObject) return fail("工具调用缺少完整有效参数")
                val itemId = tool.string("id")?.takeIf { it.isNotBlank() }
                replayTools += ChatToolCall(if (itemId != null) "$id|$itemId" else id, name, args)
                events += ChatStreamEvent.Tool("call", id, name, arguments = args)
            }
        }
        if (status == "incomplete" && !hasText && events.isEmpty()) {
            return usageEvent(response) + fail("Responses 未完成，未返回可显示的内容")
        }
        val usage = parseUsage(response)
        lastReasoningItems = reasoning.toSortedMap().values.map { it.toString() }
        lastToolCalls = if (status == "completed") replayTools else emptyList()
        events += ChatStreamEvent.Finished(if (status == "incomplete") "length" else if (tools.isNotEmpty()) "tool_calls" else "stop", usage)
        events += ChatStreamEvent.Done
        terminal = true
        completedTools.clear()
        completedReasoning.clear()
        return events
    }

    private fun usageEvent(response: JsonObject?): List<ChatStreamEvent> =
        parseUsage(response)?.let { listOf(ChatStreamEvent.State("usage", usage = it)) }.orEmpty()

    private fun parseUsage(response: JsonObject?): TokenUsage? = (response?.get("usage") as? JsonObject)?.let {
        TokenUsage(it.int("input_tokens"), it.int("output_tokens"), it.int("total_tokens"))
    }

    private fun validToolBudgets(tools: Collection<JsonObject>): Boolean = tools.all { it.string("arguments").orEmpty().length <= 1_000_000 } &&
        tools.sumOf { it.string("arguments").orEmpty().length.toLong() } <= 4_000_000

    private fun fail(
        message: String,
        providerCode: String? = null,
        fromStreamError: Boolean = false,
    ): List<ChatStreamEvent> {
        terminal = true
        lastFailureFromStreamError = fromStreamError
        data.clear()
        completedTools.clear()
        completedReasoning.clear()
        lastReasoningItems = emptyList()
        lastToolCalls = emptyList()
        return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol(message, providerCode = providerCode)))
    }
}

private fun JsonObject.string(key: String): String? = (get(key) as? JsonPrimitive)?.contentOrNull
private fun JsonObject.int(key: String): Int? = (get(key) as? JsonPrimitive)?.intOrNull
