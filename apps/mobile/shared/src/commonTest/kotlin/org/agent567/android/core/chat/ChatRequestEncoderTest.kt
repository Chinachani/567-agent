package org.agent567.android.core.chat

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.agent567.android.core.model.AssistantReplayState
import org.agent567.android.core.model.ChatContentPart
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatToolCall
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ChatRequestEncoderTest {
    @Test
    fun textOnlyUsesStringContent() {
        val msg = ChatMessage(ChatRole.User, "hello")
        val wire = ChatRequestEncoder.encodeMessage(msg)
        assertEquals("user", (wire["role"] as JsonPrimitive).content)
        val content = wire["content"]
        assertIs<JsonPrimitive>(content)
        assertEquals("hello", content.content)
        assertFalse(ChatRequestEncoder.contentHasImageParts(content))
    }

    @Test
    fun imageAttachmentProducesMultimodalParts() {
        // 1x1 PNG
        val pngBase64 =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        val msg =
            ChatMessage(
                role = ChatRole.User,
                parts =
                    listOf(
                        ChatContentPart.Text("describe this"),
                        ChatContentPart.Image(mimeType = "image/png", base64Data = pngBase64),
                    ),
            )
        val wire = ChatRequestEncoder.encodeMessage(msg)
        val content = wire["content"]
        assertIs<JsonArray>(content)
        assertTrue(ChatRequestEncoder.contentHasImageParts(content))
        val types =
            content.mapNotNull { el ->
                ((el as? JsonObject)?.get("type") as? JsonPrimitive)?.content
            }
        assertTrue(types.contains("text"))
        assertTrue(types.contains("image_url"))
        val imagePart = content.first { ((it as JsonObject)["type"] as JsonPrimitive).content == "image_url" } as JsonObject
        val url =
            ((imagePart["image_url"] as JsonObject)["url"] as JsonPrimitive).content
        assertTrue(url.startsWith("data:image/png;base64,"))
        assertTrue(url.contains(pngBase64))
    }

    @Test
    fun encodeMessagesPreservesOrder() {
        val messages =
            listOf(
                ChatMessage(ChatRole.User, "a"),
                ChatMessage(ChatRole.Assistant, "b"),
            )
        val wires = ChatRequestEncoder.encodeMessages(messages)
        assertEquals(2, wires.size)
        assertEquals("user", (wires[0]["role"] as JsonPrimitive).content)
        assertEquals("assistant", (wires[1]["role"] as JsonPrimitive).content)
    }

    @Test
    fun encodesToolCallsAndToolResultWithoutResponsesReasoningItems() {
        val messages =
            listOf(
                ChatMessage(
                    role = ChatRole.Assistant,
                    parts = listOf(ChatContentPart.Text("")),
                    replayState = AssistantReplayState(
                        inferenceApi = InferenceApi.Responses.wireValue,
                        serviceIdentity = "https://api.567.wiki",
                        groupName = "vip",
                        modelId = "gpt-5",
                        reasoningItems = listOf("""{"type":"reasoning","id":"rs_1","encrypted_content":"secret"}"""),
                        toolCalls = listOf(ChatToolCall("call_1|fc_1", "lookup", """{"q":"x"}""")),
                    ),
                ),
                ChatMessage(ChatRole.Tool, listOf(ChatContentPart.Text("done")), toolCallId = "call_1|fc_1"),
            )
        val wires = ChatRequestEncoder.encodeMessages(messages)
        assertEquals(2, wires.size)
        assertFalse(wires.toString().contains("encrypted_content"))
        val toolCall = wires[0].getValue("tool_calls").jsonArray.single().jsonObject
        assertEquals("call_1", toolCall.getValue("id").jsonPrimitive.content)
        assertEquals("call_1", wires[1].getValue("tool_call_id").jsonPrimitive.content)
    }
}
