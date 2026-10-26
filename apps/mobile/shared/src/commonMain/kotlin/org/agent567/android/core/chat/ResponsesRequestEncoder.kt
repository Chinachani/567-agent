package org.agent567.android.core.chat

import kotlinx.serialization.json.*
import org.agent567.android.core.model.*

/** Convert the shared chat request without carrying Chat Completions-only fields. */
object ResponsesRequestEncoder {
    fun encode(chatRequest: JsonObject, messages: List<ChatMessage>): JsonObject = buildJsonObject {
        put("model", chatRequest.getValue("model"))
        put("stream", true)
        put("store", false)
        chatRequest["temperature"]?.let { put("temperature", it) }
        put("input", buildJsonArray {
            messages.forEach { message -> add(buildJsonObject {
                put("role", message.role.toApiValue())
                put("content", buildJsonArray {
                    message.parts.forEach { part -> when (part) {
                        is ChatContentPart.Text -> add(buildJsonObject {
                            put("type", "input_text")
                            put("text", part.text)
                        })
                        is ChatContentPart.Image -> {
                            add(buildJsonObject { put("type", "input_image"); put("image_url", part.dataUrl) })
                        }
                    } }
                })
            }) }
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
}
