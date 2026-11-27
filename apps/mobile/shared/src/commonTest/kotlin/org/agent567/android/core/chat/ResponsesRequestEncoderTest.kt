package org.agent567.android.core.chat

import kotlinx.serialization.json.*
import org.agent567.android.core.model.*
import kotlin.test.*

class ResponsesRequestEncoderTest {
    @Test fun preservesRolesAndImagesInManualHistoryWithoutChatOnlyFields() {
        val messages = listOf(ChatMessage(ChatRole.System, "rules"), ChatMessage(ChatRole.User, "draw"),
            ChatMessage(ChatRole.Assistant, listOf(ChatContentPart.Text("generated"), ChatContentPart.Image("image/png", "eA=="))), ChatMessage(ChatRole.User, "edit it"))
        val body = ResponsesRequestEncoder.encode(buildJsonObject { put("model", "codex"); put("stream_options", buildJsonObject { put("include_usage", true) }) }, messages)
        val input = body.getValue("input").jsonArray
        assertEquals(listOf("system", "user", "assistant", "user"), input.map { it.jsonObject.getValue("role").jsonPrimitive.content })
        assertEquals("input_image", input[2].jsonObject.getValue("content").jsonArray[1].jsonObject.getValue("type").jsonPrimitive.content)
        assertEquals(JsonPrimitive(false), body["store"])
        assertFalse(body.containsKey("stream_options"))
    }

    @Test fun encodesSignedReasoningAndToolPairingForMatchingTargetOnly() {
        val sameTarget = ResponsesReplayTarget("https://api.567.wiki", "vip", "gpt-5", InferenceApi.Responses)
        val otherTarget = ResponsesReplayTarget("https://api.567.wiki", "vip", "gpt-5-mini", InferenceApi.Responses)
        val replay = AssistantReplayState(
            inferenceApi = InferenceApi.Responses.wireValue,
            serviceIdentity = "https://api.567.wiki",
            groupName = "vip",
            modelId = "gpt-5",
            reasoningItems = listOf("""{"type":"reasoning","id":"rs_1","encrypted_content":"cipher_1"}"""),
            toolCalls = listOf(ChatToolCall("call_1|fc_1", "lookup", """{"q":"hi"}""")),
        )
        val messages = listOf(
            ChatMessage(ChatRole.User, "find"),
            ChatMessage(ChatRole.Assistant, listOf(ChatContentPart.Text("checking")), replayState = replay),
            ChatMessage(ChatRole.Tool, listOf(ChatContentPart.Text("found")), toolCallId = "call_1|fc_1"),
        )

        val sameInput = ResponsesRequestEncoder.encode(buildJsonObject { put("model", "gpt-5") }, messages, sameTarget).getValue("input").jsonArray
        assertEquals(listOf("user", "reasoning", "assistant", "function_call", "function_call_output"), sameInput.map {
            val obj = it.jsonObject
            obj["type"]?.jsonPrimitive?.content ?: obj.getValue("role").jsonPrimitive.content
        })
        assertEquals("fc_1", sameInput[3].jsonObject.getValue("id").jsonPrimitive.content)
        assertEquals("call_1", sameInput[3].jsonObject.getValue("call_id").jsonPrimitive.content)
        assertEquals("call_1", sameInput[4].jsonObject.getValue("call_id").jsonPrimitive.content)

        val crossInput = ResponsesRequestEncoder.encode(buildJsonObject { put("model", "gpt-5-mini") }, messages, otherTarget).getValue("input").jsonArray
        assertEquals(listOf("user", "assistant", "function_call", "function_call_output"), crossInput.map {
            val obj = it.jsonObject
            obj["type"]?.jsonPrimitive?.content ?: obj.getValue("role").jsonPrimitive.content
        })
        assertFalse(crossInput[2].jsonObject.containsKey("id"))
        assertEquals("call_1", crossInput[2].jsonObject.getValue("call_id").jsonPrimitive.content)
    }
}
