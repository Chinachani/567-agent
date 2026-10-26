package org.agent567.android.core.api

import androidx.lifecycle.viewModelScope
import com.russhwolf.settings.MapSettings
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import kotlinx.serialization.json.*
import org.agent567.android.app.*
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.net.*
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.domain.session.*
import org.agent567.android.ui.AppViewModel
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.navigation.AppRoute
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class ContextAndProfileHostFlowTest {
    @Test fun userCompactsThreeTurnsReopensChangesNicknameAndLogsOutKeepingHistory() = runBlocking {
        Dispatchers.setMain(Dispatchers.Unconfined)
        var nickname = "Before"; var summaryRequests = 0
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            val chat = request.requestURI.path == "/v1/chat/completions"
            val body = when {
                chat -> {
                    summaryRequests++
                    "data: {\"choices\":[{\"delta\":{\"content\":\"Concise summary of earlier facts\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
                }
                request.requestMethod == "PUT" -> {
                    val data = Agent567Json.parseToJsonElement(request.requestBody.readBytes().toString(Charsets.UTF_8)).jsonObject
                    nickname = data["display_name"]!!.jsonPrimitive.content
                    """{"success":true}"""
                }
                request.requestURI.path == "/api/user/self" -> """{"success":true,"data":{"id":7,"username":"test","display_name":"$nickname","quota":500000,"group":"default"}}"""
                request.requestURI.path == "/api/user/models" -> """{"success":true,"data":["test-model"]}"""
                else -> """{"success":true,"data":{}}"""
            }
            request.requestBody.close(); val bytes = body.toByteArray()
            request.responseHeaders.add("Content-Type", if (chat) "text/event-stream" else "application/json")
            request.sendResponseHeaders(200, bytes.size.toLong()); request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val preferences = AppPreferences(MapSettings()).apply {
            setServerUrl("http://127.0.0.1:${server.address.port}")
            setCachedGroupModels(null, listOf("test-model")); setInputPredictionEnabled(false)
        }
        val settings = MapSettings()
        val store = SettingsSessionStore(settings, Dispatchers.IO)
        val container = AppContainer(preferences, InMemoryTokenStore("sk-isolated-test", "sk-isolated-test"), store,
            networkAvailability = MutableStateFlow(NetworkAvailability.Available), loadServiceRoutes = { emptyList() })
        val vm = AppViewModel(container)
        suspend fun awaitState(predicate: (org.agent567.android.ui.AppUiState) -> Boolean) = withTimeout(20_000) { vm.state.first(predicate) }
        try {
            awaitState { it.bootstrapped && !it.catalogLoading && it.user?.id == 7L }
            val session = store.createSession("Manual flow", modelId = "test-model")
            val history = (1..3).flatMap { n -> listOf(
                LocalMessage("u$n", session.id, ChatRole.User, "Question $n " + "facts ".repeat(100), MessageStatus.Complete, n * 2L),
                LocalMessage("a$n", session.id, ChatRole.Assistant, "Answer $n " + "details ".repeat(100), MessageStatus.Complete, n * 2L + 1),
            ) }
            store.replaceMessages(session.id, history)
            vm.openChat(session.id); vm.setContextPanelOpen(true)
            awaitState { !it.contextLoading && it.contextSnapshot?.messageCount == 6 }
            vm.compactChatContext()
            awaitState { !it.contextBusy && it.contextNotice == Str.contextCompacted && it.contextSnapshot?.messageCount == 2 }
            assertEquals(1, summaryRequests)
            assertEquals("a2", SettingsSessionStore(settings, Dispatchers.IO).getSession(session.id)!!.context.throughMessageId)
            assertEquals(history, store.getMessages(session.id))
            vm.openChat(null); vm.openChat(session.id); vm.setContextPanelOpen(true)
            awaitState { !it.contextLoading && it.contextSnapshot?.messageCount == 2 }
            vm.compactChatContext()
            awaitState { !it.contextBusy && it.contextNotice == Str.contextTooShort }
            assertEquals(1, summaryRequests)
            vm.setChatInferenceApi(org.agent567.android.core.chat.InferenceApi.Responses)
            awaitState { !it.contextLoading && it.contextSnapshot?.inferenceApiOverride == "openai-responses" }
            assertEquals(org.agent567.android.core.chat.InferenceApi.Responses, preferences.getModelInferenceApi(null, "test-model"))
            vm.setChatInferenceApi(null)
            awaitState { !it.contextLoading && it.contextSnapshot?.inferenceApiOverride == null }
            vm.openAccount(); assertEquals(AppRoute.Account, vm.state.value.route)
            val saved = CompletableDeferred<String?>(); vm.saveProfileName("After") { saved.complete(it) }
            assertNull(withTimeout(20_000) { saved.await() })
            assertEquals("After", vm.state.value.user!!.nickname)
            vm.logout(false); awaitState { it.route == AppRoute.Login && it.user == null }
            assertEquals(history, store.getMessages(session.id))
        } finally { vm.viewModelScope.cancel(); container.close(); server.stop(0); Dispatchers.resetMain() }
    }
}
