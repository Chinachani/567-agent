package org.agent567.android.core.api

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.toList
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.model.*
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.Agent567Client
import kotlin.test.*

class ResponsesChatHostTest {
    @Test fun codexUsesResponsesAndReadsTextAndUsage() = runBlocking {
        val paths = mutableListOf<String>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            paths += request.requestURI.path
            request.requestBody.close()
            val body = if (request.requestURI.path == "/v1/responses") """
                data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"hello"}

                data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"hello"}]}],"usage":{"input_tokens":11,"output_tokens":3,"total_tokens":14}}}

            """.trimIndent() + "\n\n" else "{}"
            val bytes = body.toByteArray()
            request.responseHeaders.add("Content-Type", "text/event-stream")
            request.sendResponseHeaders(if (request.requestURI.path == "/v1/responses") 200 else 404, bytes.size.toLong())
            request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val client = Agent567Client.create(Agent567Config(serverUrl = "http://127.0.0.1:${server.address.port}"), InMemoryTokenStore("sk-test", "sk-test"))
        try {
            val events = client.chat.stream("gpt-5.3-codex", listOf(ChatMessage(ChatRole.User, listOf(ChatContentPart.Text("hi"))))).toList()
            assertEquals(listOf("/v1/responses"), paths)
            assertEquals("hello", events.filterIsInstance<ChatStreamEvent.Delta>().joinToString("") { it.text })
            assertTrue(events.none { it is ChatStreamEvent.Error }, events.toString())
            assertTrue(events.any { it is ChatStreamEvent.Finished && it.usage?.totalTokens == 14 })
        } finally { client.close(); server.stop(0) }
    }

    @Test fun userSwitchesProtocolRestartsAndRestoresAutoWithoutChangingOtherModels() = runBlocking {
        val paths = mutableListOf<String>()
        val bodies = mutableListOf<kotlinx.serialization.json.JsonObject>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            paths += request.requestURI.path
            bodies += org.agent567.android.core.net.Agent567Json.parseToJsonElement(request.requestBody.readBytes().toString(Charsets.UTF_8)) as kotlinx.serialization.json.JsonObject
            val body = if (request.requestURI.path == "/v1/responses")
                """data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}""" + "\n\n"
            else """data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}""" + "\n\ndata: [DONE]\n\n"
            val bytes = body.toByteArray(); request.responseHeaders.add("Content-Type", "text/event-stream")
            request.sendResponseHeaders(200, bytes.size.toLong()); request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val storage = com.russhwolf.settings.MapSettings()
        var prefs = org.agent567.android.app.AppPreferences(storage).apply { setServerUrl("http://127.0.0.1:${server.address.port}") }
        fun client() = Agent567Client.create(Agent567Config(prefs.serverUrl.value), InMemoryTokenStore("sk-test", "sk-test"), preferences = prefs)
        var api = client()
        suspend fun send(model: String) {
            val events = api.chat.stream(model, listOf(ChatMessage(ChatRole.User, listOf(ChatContentPart.Text("hi"), ChatContentPart.Image("image/png", "eA==")))), imageGenModel = "image-test").toList()
            assertTrue(events.any { it is ChatStreamEvent.Done }, events.toString())
            assertTrue(events.none { it is ChatStreamEvent.Error }, events.toString())
        }
        try {
            send("gpt-5-codex")
            prefs.setModelInferenceApi(null, "gpt-5-codex", org.agent567.android.core.chat.InferenceApi.Completions)
            send("gpt-5-codex")
            api.close(); prefs = org.agent567.android.app.AppPreferences(storage); api = client()
            send("gpt-5-codex")
            prefs.setModelInferenceApi(null, "gpt-5-codex", null)
            send("gpt-5-codex"); send("gemini-test")
            assertEquals(listOf("/v1/responses", "/v1/chat/completions", "/v1/chat/completions", "/v1/responses", "/v1/chat/completions"), paths)
            assertEquals(kotlinx.serialization.json.JsonPrimitive(false), bodies.first()["store"])
            assertFalse(bodies.first().containsKey("messages"))
            assertTrue(bodies.first().getValue("input").toString().contains("input_image"))
            assertTrue(bodies.first().getValue("tools").toString().contains("generate_image"))
            assertFalse(bodies.first().getValue("tools").toString().contains("\"function\":"))
        } finally { api.close(); server.stop(0) }
    }

    @Test fun unsupportedProtocolAndMissingTerminalDoNotFallBackOrExecuteTools() = runBlocking {
        val paths = mutableListOf<String>(); var status = 400
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            paths += request.requestURI.path; request.requestBody.close()
            val body = if (status == 400) """{"error":{"message":"unsupported protocol"}}""" else
                """data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"c","name":"generate_image","arguments":"{}"}}""" + "\n\n"
            val bytes = body.toByteArray(); request.responseHeaders.add("Content-Type", "text/event-stream")
            request.sendResponseHeaders(status, bytes.size.toLong()); request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val client = Agent567Client.create(Agent567Config("http://127.0.0.1:${server.address.port}"), InMemoryTokenStore("sk-test", "sk-test"))
        try {
            repeat(2) {
                val events = client.chat.stream("gpt-codex", listOf(ChatMessage(ChatRole.User, "hi"))).toList()
                assertTrue(events.any { it is ChatStreamEvent.Error })
                assertTrue(events.none { it is ChatStreamEvent.Done || it is ChatStreamEvent.Tool })
                status = 200
            }
            assertEquals(listOf("/v1/responses", "/v1/responses"), paths)
        } finally { client.close(); server.stop(0) }
    }
}
