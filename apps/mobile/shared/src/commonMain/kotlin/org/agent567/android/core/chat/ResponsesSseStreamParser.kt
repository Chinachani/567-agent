package org.agent567.android.core.chat

import kotlinx.serialization.json.*
import org.agent567.android.core.error.Agent567Exception
import org.agent567.android.core.model.*
import org.agent567.android.core.net.Agent567Json

/** One HTTP attempt. Tools are released only by a completed response, never by argument deltas. */
class ResponsesSseStreamParser {
    private val data = StringBuilder()
    private val streamedText = mutableMapOf<Pair<Int, Int>, StringBuilder>()
    private var textChars = 0
    private val completedTools = linkedMapOf<Int, JsonObject>()
    private var terminal = false
    private var hasText = false

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
            "response.output_item.done" -> {
                val item = event["item"] as? JsonObject
                if (item?.string("type") == "function_call") {
                    val index = event.int("output_index") ?: return fail("工具调用缺少序号")
                    if (index < 0 || (index !in completedTools && completedTools.size >= 16)) return fail("工具调用数量超过安全上限")
                    completedTools[index] = item
                    if (!validToolBudgets(completedTools.values)) return fail("工具参数超过安全长度限制")
                }
                emptyList()
            }
            "response.completed" -> complete(event["response"] as? JsonObject, "completed")
            "response.incomplete" -> complete(event["response"] as? JsonObject, "incomplete")
            "response.failed", "response.cancelled", "error" -> fail("Responses 请求失败：" +
                ((event["response"] as? JsonObject)?.get("error") as? JsonObject ?: event["error"] as? JsonObject ?: event).string("message").orEmpty().take(500))
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
                        text.drop(consumed.length).takeIf { it.isNotEmpty() }?.let { events += ChatStreamEvent.Delta(it); hasText = true }
                    }
                }
                "function_call" -> tools[index] = item
            }
        }
        if (status == "completed") {
            if (tools.size > 16 || !validToolBudgets(tools.values)) return fail("工具参数超过安全长度限制")
            val ids = mutableSetOf<String>()
            for (tool in tools.toSortedMap().values) {
                val id = tool.string("call_id"); val name = tool.string("name"); val args = tool.string("arguments")
                if (id.isNullOrBlank() || name.isNullOrBlank() || args.isNullOrBlank() || !ids.add(id) ||
                    runCatching { Agent567Json.parseToJsonElement(args) }.getOrNull() !is JsonObject) return fail("工具调用缺少完整有效参数")
                events += ChatStreamEvent.Tool("call", id, name, arguments = args)
            }
        }
        if (!hasText && events.none { it is ChatStreamEvent.Tool }) return fail("Responses 返回空内容，请检查模型调用协议")
        val usage = (response["usage"] as? JsonObject)?.let { TokenUsage(it.int("input_tokens"), it.int("output_tokens"), it.int("total_tokens")) }
        events += ChatStreamEvent.Finished(if (status == "incomplete") "length" else if (tools.isNotEmpty()) "tool_calls" else "stop", usage)
        events += ChatStreamEvent.Done
        terminal = true
        completedTools.clear()
        return events
    }

    private fun validToolBudgets(tools: Collection<JsonObject>): Boolean = tools.all { it.string("arguments").orEmpty().length <= 1_000_000 } &&
        tools.sumOf { it.string("arguments").orEmpty().length.toLong() } <= 4_000_000

    private fun fail(message: String): List<ChatStreamEvent> {
        terminal = true; data.clear(); completedTools.clear()
        return listOf(ChatStreamEvent.Error(Agent567Exception.Protocol(message)))
    }
}

private fun JsonObject.string(key: String): String? = (get(key) as? JsonPrimitive)?.contentOrNull
private fun JsonObject.int(key: String): Int? = (get(key) as? JsonPrimitive)?.intOrNull
