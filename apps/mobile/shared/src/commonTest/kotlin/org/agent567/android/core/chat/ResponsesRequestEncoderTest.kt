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
}
