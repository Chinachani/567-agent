package org.agent567.android.core.api

import androidx.lifecycle.viewModelScope
import com.russhwolf.settings.MapSettings
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.Executors
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import org.agent567.android.app.*
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.net.NetworkAvailability
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.domain.session.*
import org.agent567.android.ui.AppViewModel
import org.agent567.android.ui.i18n.Str
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class ImageGenerationFlowHostTest {
    @Test fun editedImageAndTextOnlyFailureSurviveCompletionAndHistoryReload() =
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { ui -> runBlocking(ui) {
        Dispatchers.setMain(ui)
        var mode = "image"
        val imageRequests = mutableListOf<String>()
        val paths = mutableListOf<String>()
        val editBodies = mutableListOf<String>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            val path = request.requestURI.path
            paths += path
            val chat = path == "/v1/chat/completions"
            val raw = request.requestBody.readBytes().toString(Charsets.ISO_8859_1)
            if (path.startsWith("/v1/images/")) { imageRequests += path; editBodies += raw }
            val body = when {
                chat -> """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"image-call","function":{"name":"generate_image","arguments":"{\"prompt\":\"change time\",\"action\":\"edit\"}"}}]},"finish_reason":"tool_calls"}]}""" + "\n\ndata: [DONE]\n\n"
                path.startsWith("/v1/images/") && mode == "image" -> """{"data":[{"b64_json":"${ImageGenerationHostTest.PNG}"}]}"""
                path.startsWith("/v1/images/") -> """{"choices":[{"message":{"content":"All done: [download](https://example.test/fake.png)"}}]}"""
                path == "/api/user/models" -> """{"success":true,"data":["test-model"]}"""
                path == "/api/user/self" -> """{"success":true,"data":{"id":7,"username":"test","quota":500000,"group":"default"}}"""
                else -> """{"success":true,"data":{}}"""
            }
            val bytes = body.toByteArray()
            request.responseHeaders.add("Content-Type", if (chat) "text/event-stream" else "application/json")
            request.sendResponseHeaders(200, bytes.size.toLong()); request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val preferences = AppPreferences(MapSettings()).apply {
            setServerUrl("http://127.0.0.1:${server.address.port}"); setCachedGroupModels(null, listOf("test-model")); setInputPredictionEnabled(false)
            activeImageModel = "gpt-image-2"
        }
        val storage = MapSettings()
        val imageFiles = object : MessageImageFileStore {
            val files = mutableMapOf<String, ByteArray>()
            override fun writeBytes(key: String, bytes: ByteArray): Boolean { files[key] = bytes.copyOf(); return true }
            override fun writeBase64(key: String, base64Data: String): Boolean = writeBytes(key, kotlin.io.encoding.Base64.decode(base64Data))
            override fun readBytes(key: String): ByteArray? = files[key]?.copyOf()
            override fun delete(key: String) { files.remove(key) }
        }
        val store = SettingsSessionStore(storage, Dispatchers.IO, imageFiles)
        val container = AppContainer(preferences, InMemoryTokenStore("sk-isolated", "sk-isolated"), store,
            networkAvailability = MutableStateFlow(NetworkAvailability.Available), loadServiceRoutes = { emptyList() })
        val vm = AppViewModel(container)
        try {
            withTimeout(20_000) { vm.state.first { it.bootstrapped && !it.catalogLoading } }
            for (variant in listOf("image", "text")) {
                mode = variant
                val session = store.createSession("Image $variant", modelId = "test-model")
                vm.openChat(session.id)
                withTimeout(20_000) { vm.state.first { it.currentSessionId == session.id } }
                vm.addPendingImages(listOf(MessageImage(id = "reference", mimeType = "image/png", fileName = "reference.png", base64Data = ImageGenerationHostTest.PNG)))
                vm.onDraftChange("change time"); vm.sendMessage()
                val state = try { withTimeout(20_000) { vm.state.first { !it.isStreaming && it.messages.any { message -> message.sessionId == session.id && message.role == ChatRole.Assistant && message.status in setOf(MessageStatus.Complete, MessageStatus.Error) } } } } catch (error: TimeoutCancellationException) { throw AssertionError("paths=$paths imageModel=${vm.state.value.activeImageModel} state=${vm.state.value.chatError} messages=${vm.state.value.messages.map { it.status to it.content }}", error) }
                val reply = state.messages.last { it.role == ChatRole.Assistant }
                if (variant == "image") {
                    assertEquals(MessageStatus.Complete, reply.status)
                    assertEquals(ImageGenerationHostTest.PNG, kotlin.io.encoding.Base64.encode(assertNotNull(store.readMessageImageBytes(reply.images.single()))))
                    assertEquals("image/png", reply.images.single().mimeType)
                    assertEquals("completed", reply.toolEvents.single().phase)
                } else {
                    assertEquals(MessageStatus.Error, reply.status)
                    assertTrue(reply.images.isEmpty())
                    assertEquals("error", reply.toolEvents.single().phase)
                    assertEquals(Str.toolImageMissing, reply.toolEvents.single().result)
                    assertFalse(reply.content.contains("fake.png"))
                }
                val reloaded = SettingsSessionStore(storage, Dispatchers.IO, imageFiles).getMessages(session.id).last { it.role == ChatRole.Assistant }
                assertEquals(reply.status, reloaded.status)
                assertEquals(reply.images, reloaded.images)
            }
            assertEquals(listOf("/v1/images/edits", "/v1/images/edits"), imageRequests)
            assertTrue(editBodies.all { it.contains("reference-0.png") })
        } finally { vm.viewModelScope.cancel(); container.close(); server.stop(0); Dispatchers.resetMain() }
    } }
}
