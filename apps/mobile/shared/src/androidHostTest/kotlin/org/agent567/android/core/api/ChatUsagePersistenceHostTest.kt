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
import org.agent567.android.app.AppContainer
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.net.NetworkAvailability
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.ui.AppViewModel
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class ChatUsagePersistenceHostTest {
    @Test fun apiUsageSurvivesStreamCompletionReopenAndStoreReload() =
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { uiDispatcher -> runBlocking(uiDispatcher) {
        // Match the Android Main boundary: restore callbacks and user edits must not mutate
        // composer state concurrently on the HTTP/IO threads of Dispatchers.Unconfined.
        Dispatchers.setMain(uiDispatcher)
        var mode = "tail"
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val usage = """{"prompt_tokens":11,"completion_tokens":22,"total_tokens":33}"""
        server.createContext("/") { request ->
            val chat = request.requestURI.path == "/v1/chat/completions"
            val body = when {
                chat && mode == "tail" -> "data: {\"choices\":[{\"delta\":{\"content\":\"Answer\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":$usage}\n\ndata: [DONE]\n\n"
                chat && mode == "same" -> "data: {\"choices\":[{\"delta\":{\"content\":\"Answer\"},\"finish_reason\":\"stop\"}],\"usage\":$usage}\n\n"
                chat -> """{"choices":[{"message":{"content":"Answer"},"finish_reason":"stop"}],"usage":$usage}"""
                request.requestURI.path == "/api/user/models" -> """{"success":true,"data":["test-model"]}"""
                request.requestURI.path == "/api/user/self" -> """{"success":true,"data":{"id":7,"username":"test","quota":500000,"group":"default"}}"""
                else -> """{"success":true,"data":{}}"""
            }
            request.requestBody.close()
            val bytes = body.toByteArray()
            request.responseHeaders.add("Content-Type", if (chat && mode != "json") "text/event-stream" else "application/json")
            request.sendResponseHeaders(200, bytes.size.toLong())
            request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val preferences = AppPreferences(MapSettings()).apply {
            setServerUrl("http://127.0.0.1:${server.address.port}")
            setCachedGroupModels(null, listOf("test-model"))
            setInputPredictionEnabled(false)
        }
        val settings = MapSettings()
        val store = SettingsSessionStore(settings, Dispatchers.IO)
        val container = AppContainer(preferences, InMemoryTokenStore("sk-isolated-test", "sk-isolated-test"), store,
            networkAvailability = MutableStateFlow(NetworkAvailability.Available), loadServiceRoutes = { emptyList() })
        val vm = AppViewModel(container)
        try {
            withTimeout(20_000) { vm.state.first { it.bootstrapped && !it.catalogLoading } }
            for (variant in listOf("tail", "same", "json")) {
                mode = variant
                val session = store.createSession("Usage $variant", modelId = "test-model")
                vm.openChat(session.id)
                withTimeout(20_000) { vm.state.first { it.currentSessionId == session.id } }
                vm.onDraftChange("Test usage $variant")
                vm.sendMessage()
                val response = withTimeout(20_000) {
                    vm.state.first { state -> state.currentSessionId == session.id && !state.isStreaming && state.messages.any { it.sessionId == session.id && it.role == ChatRole.Assistant && it.status == MessageStatus.Complete } }
                }.messages.last { it.role == ChatRole.Assistant }
                assertEquals("Answer", response.content)
                assertEquals(33, response.usage?.totalTokens, variant)
                vm.openChat(null)
                vm.openChat(session.id)
                val reopened = withTimeout(20_000) { vm.state.first { it.currentSessionId == session.id && it.messages.any { msg -> msg.id == response.id && msg.status == MessageStatus.Complete } } }
                assertEquals(33, reopened.messages.single { it.id == response.id }.usage?.totalTokens, variant)
                val reloaded = SettingsSessionStore(settings, Dispatchers.IO).getMessages(session.id).last()
                assertEquals(33, reloaded.usage?.totalTokens, variant)
            }
        } finally {
            // Child finally blocks can resume on Main; finish them before resetting it.
            vm.viewModelScope.coroutineContext.job.cancelAndJoin()
            container.close()
            server.stop(0)
            Dispatchers.resetMain()
        }
    } }
}
