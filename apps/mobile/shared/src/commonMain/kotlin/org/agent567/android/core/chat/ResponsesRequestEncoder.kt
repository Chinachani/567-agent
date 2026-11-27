package org.agent567.android.core.chat

import kotlinx.serialization.json.*
import org.agent567.android.core.model.*

/** Convert the shared chat request without carrying Chat Completions-only fields. */
object ResponsesRequestEncoder {
    fun encode(chatRequest: JsonObject, messages: List<ChatMessage>): JsonObject =
        encode(chatRequest, messages, target = null)

    internal fun encode(
        chatRequest: JsonObject,
        messages: List<ChatMessage>,
        target: ResponsesReplayTarget?,
    ): JsonObject = buildJsonObject {
        put("model", chatRequest.getValue("model"))
        put("stream", true)
        put("store", false)
        chatRequest["temperature"]?.let { put("temperature", it) }
        put("input", buildJsonArray {
            messages.forEach { message ->
                when (message.role) {
                    ChatRole.Tool -> {
                        val callId = message.toolCallId?.substringBefore('|').orEmpty()
                        if (callId.isNotBlank()) {
                            add(buildJsonObject {
                                put("type", "function_call_output")
                                put("call_id", callId)
                                put("output", message.textContent.ifEmpty { "(see attached image)" })
                            })
                        }
                    }
                    ChatRole.Assistant -> {
                        val replay = message.replayState
                        val sameSourceAndModel = target != null && isSameModelAndSource(replay, target)
                        if (sameSourceAndModel) {
                            replay?.reasoningItems.orEmpty().forEach { raw ->
                                parseSignedReasoningWireItem(raw)?.let(::add)
                            }
                        }
                        val toolCalls = replay?.toolCalls.orEmpty()
                        if (toolCalls.isEmpty()) {
                            add(encodeMessageItem(message.role, message.parts))
                        } else {
                            val nonEmptyParts = message.parts.filter { part ->
                                when (part) {
                                    is ChatContentPart.Text -> part.text.isNotEmpty()
                                    is ChatContentPart.Image -> true
                                }
                            }
                            if (nonEmptyParts.isNotEmpty()) {
                                add(encodeMessageItem(message.role, nonEmptyParts))
                            }
                            toolCalls.forEach { toolCall ->
                                val idParts = toolCall.id.split('|')
                                val callId = idParts[0]
                                val itemId = idParts.getOrNull(1)
                                add(buildJsonObject {
                                    put("type", "function_call")
                                    if (sameSourceAndModel && itemId?.startsWith("fc_") == true) {
                                        put("id", itemId)
                                    }
                                    put("call_id", callId)
                                    put("name", toolCall.name)
                                    put("arguments", toolCall.arguments)
                                })
                            }
                        }
                    }
                    ChatRole.System, ChatRole.User -> {
                        add(encodeMessageItem(message.role, message.parts))
                    }
                }
            }
        })
        (chatRequest["tools"] as? JsonArray)?.let { tools ->
            put("tools", buildJsonArray { tools.forEach { value ->
                val function = value.jsonObject.getValue("function").jsonObject
                add(buildJsonObject {
                    put("type", "function")
                    function.forEach { (key, field) -> put(key, field) }
                    // The existing optional action argument is intentionally non-strict.
                    put("strict", false)
                })
            } })
            chatRequest["tool_choice"]?.let { put("tool_choice", it) }
        }
    }

    private fun encodeMessageItem(role: ChatRole, parts: List<ChatContentPart>): JsonObject = buildJsonObject {
        put("role", role.toApiValue())
        put("content", buildJsonArray {
            parts.forEach { part ->
                when (part) {
                    is ChatContentPart.Text -> add(buildJsonObject {
                        put("type", "input_text")
                        put("text", part.text)
                    })
                    is ChatContentPart.Image -> add(buildJsonObject {
                        put("type", "input_image")
                        put("image_url", part.dataUrl)
                    })
                }
            }
        })
    }
}
