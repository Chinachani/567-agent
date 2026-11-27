package org.agent567.android.core.api

import androidx.lifecycle.viewModelScope
import com.russhwolf.settings.MapSettings
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.agent567.android.app.AppContainer
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.ServiceRoute
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.chat.InferenceApi
import org.agent567.android.core.error.Agent567Exception
import org.agent567.android.core.error.ChatFailureStage
import org.agent567.android.core.error.chatFailureDiagnostic
import org.agent567.android.core.model.AssistantReplayState
import org.agent567.android.core.model.ChatContentPart
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.model.ChatToolCall
import org.agent567.android.core.net.Agent567Json
import org.agent567.android.core.net.NetworkAvailability
import org.agent567.android.core.net.RefreshOutcome
import org.agent567.android.core.net.TokenRefresher
import org.agent567.android.core.net.createAgent567HttpClient
import org.agent567.android.core.net.createBareHttpClient
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageImageFileStore
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.ui.AppViewModel
import org.agent567.android.ui.i18n.Str
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class ResponsesSignatureRecoveryHostTest {
    @Test
    fun http400SignatureRejectionRepairsOnceAndPreservesTextAndToolPairing() = runBlocking {
        for (errorPayload in listOf(
            """{"error":{"code":"invalid_encrypted_content","message":"invalid ciphertext"}}""",
            """{"error":{"message":"The `encrypted_content` could not be verified."}}""",
            """{"error":{"message":"Encrypted content has expired"}}""",
        )) {
            val bodies = CopyOnWriteArrayList<JsonObject>()
            val fixture = ResponsesHostFixture { exchange, body, attempt ->
                bodies += body
                if (attempt == 1) {
                    sendJson(exchange, 400, errorPayload)
                } else {
                    sendSse(
                        exchange,
                        completedSse(
                            reasoningId = "rs_new",
                            encryptedContent = "enc_new",
                            text = "repaired answer",
                        ),
                    )
                }
            }
            fixture.use {
                val initialHistory = listOf(
                    ChatMessage(ChatRole.User, "check weather"),
                    ChatMessage(
                        role = ChatRole.Assistant,
                        parts = listOf(ChatContentPart.Text("calling tool")),
                        replayState = AssistantReplayState(
                            inferenceApi = InferenceApi.Responses.wireValue,
                            serviceIdentity = it.serviceIdentity,
                            groupName = "vip",
                            modelId = MODEL,
                            reasoningItems = listOf(signedReasoning("rs_old", "enc_old")),
                            toolCalls = listOf(ChatToolCall("call_1|fc_1", "lookup", """{"city":"SH"}""")),
                        ),
                    ),
                    ChatMessage(ChatRole.Tool, listOf(ChatContentPart.Text("""{"temp":22}""")), toolCallId = "call_1|fc_1"),
                    ChatMessage(ChatRole.User, "summarize"),
                )
                val events = withTimeout(4_000) {
                    it.api.streamChat(MODEL, initialHistory, groupName = "vip").toList()
                }

                assertEquals(2, bodies.size, errorPayload)
                assertTrue(bodies[0].toString().contains("enc_old"))
                assertFalse(bodies[1].toString().contains("enc_old"))
                val repairedInput = bodies[1].getValue("input").jsonArray
                assertEquals(
                    listOf("user", "assistant", "function_call", "function_call_output", "user"),
                    inputTypes(repairedInput),
                )
                assertEquals("fc_1", repairedInput[2].jsonObject.getValue("id").jsonPrimitive.content)
                assertEquals("repaired answer", events.filterIsInstance<ChatStreamEvent.Delta>().joinToString("") { d -> d.text })
                val replayEvent = events.filterIsInstance<ChatStreamEvent.ReplayState>().single()
                assertTrue(replayEvent.replayState.signedReasoningReset)
                assertEquals(1, replayEvent.replayState.reasoningItems.size)
                assertTrue(replayEvent.replayState.reasoningItems.single().contains("enc_new"))
                assertEquals(ChatStreamEvent.Done, events.last())
            }
        }
    }

    @Test
    fun nonSignature400AndRejectionWithoutSentSignatureNeverRepair() = runBlocking {
        val bodies = CopyOnWriteArrayList<JsonObject>()
        val fixture = ResponsesHostFixture { exchange, body, _ ->
            bodies += body
            sendJson(exchange, 400, """{"error":{"code":"invalid_encrypted_content","message":"The encrypted content could not be verified."}}""")
        }
        fixture.use {
            val noSigEvents = withTimeout(4_000) {
                it.api.streamChat(MODEL, listOf(ChatMessage(ChatRole.User, "hello")), groupName = "vip").toList()
            }
            assertEquals(1, bodies.size)
            assertTrue(noSigEvents.single() is ChatStreamEvent.Error)
        }

        val nonSigBodies = CopyOnWriteArrayList<JsonObject>()
        val nonSigFixture = ResponsesHostFixture { exchange, body, _ ->
            nonSigBodies += body
            sendJson(exchange, 400, """{"error":{"code":"invalid_request_error","message":"Bad parameter"}}""")
        }
        nonSigFixture.use {
            val history = historyWithSignedTurn(it.serviceIdentity, "vip", MODEL, "enc_old")
            val events = withTimeout(4_000) {
                it.api.streamChat(MODEL, history, groupName = "vip").toList()
            }
            assertEquals(1, nonSigBodies.size)
            assertTrue(events.single() is ChatStreamEvent.Error)
        }
    }

    @Test
    fun sseStreamErrorBeforeActivityRepairsOnceWhileActivityUsageOrCancelledBlocksRepair() = runBlocking {
        for (streamError in listOf(
            """data: {"type":"response.failed","response":{"error":{"code":"invalid_encrypted_content","message":"cannot verify"}}}""",
            """data: {"type":"error","error":{"message":"The encrypted content could not be verified."}}""",
        )) {
            val bodies = CopyOnWriteArrayList<JsonObject>()
            val fixture = ResponsesHostFixture { exchange, body, attempt ->
                bodies += body
                if (attempt == 1) {
                    sendSse(exchange, "$streamError\n\n")
                } else {
                    sendSse(exchange, completedSse("rs_new", "enc_new", "ok"))
                }
            }
            fixture.use {
                val history = historyWithSignedTurn(it.serviceIdentity, "vip", MODEL, "enc_old")
                val events = withTimeout(4_000) {
                    it.api.streamChat(MODEL, history, groupName = "vip").toList()
                }
                assertEquals(2, bodies.size, streamError)
                assertFalse(bodies[1].toString().contains("enc_old"))
                assertTrue(events.filterIsInstance<ChatStreamEvent.ReplayState>().single().replayState.signedReasoningReset)
                assertTrue(events.none { ev -> ev is ChatStreamEvent.Error }, events.toString())
            }
        }

        val blockedStreams = listOf(
            // Hidden reasoning delta already arrived -> replayUnsafe == true -> must NOT repair
            """
            data: {"type":"response.reasoning_summary_text.delta","delta":"thinking"}

            data: {"type":"response.failed","response":{"error":{"code":"invalid_encrypted_content","message":"cannot verify"}}}
            """.trimIndent(),
            // Hidden reasoning item already arrived -> replayUnsafe == true -> must NOT repair
            """
            data: {"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"rs_part"}}

            data: {"type":"response.failed","response":{"error":{"code":"invalid_encrypted_content","message":"cannot verify"}}}
            """.trimIndent(),
            // Visible text delta already arrived -> must NOT repair
            """
            data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"partial"}

            data: {"type":"response.failed","response":{"error":{"code":"invalid_encrypted_content","message":"cannot verify"}}}
            """.trimIndent(),
            // Tool activity already arrived -> must NOT repair
            """
            data: {"type":"response.function_call_arguments.delta","delta":"{"}

            data: {"type":"response.failed","response":{"error":{"code":"invalid_encrypted_content","message":"cannot verify"}}}
            """.trimIndent(),
            // Usage already arrived in failed response -> must NOT repair
            """
            data: {"type":"response.failed","response":{"usage":{"input_tokens":5,"output_tokens":0,"total_tokens":5},"error":{"code":"invalid_encrypted_content","message":"cannot verify"}}}
            """.trimIndent(),
            // response.cancelled must NEVER trigger signature repair
            """
            data: {"type":"response.cancelled","response":{"error":{"code":"invalid_encrypted_content","message":"The encrypted content could not be verified."}}}
            """.trimIndent(),
        )
        for (blocked in blockedStreams) {
            val fixture = ResponsesHostFixture { exchange, _, _ ->
                sendSse(exchange, "$blocked\n\n")
            }
            fixture.use {
                val history = historyWithSignedTurn(it.serviceIdentity, "vip", MODEL, "enc_old")
                val events = withTimeout(4_000) {
                    it.api.streamChat(MODEL, history, groupName = "vip").toList()
                }
                assertEquals(1, it.requests.get(), blocked)
                assertTrue(events.last() is ChatStreamEvent.Error, events.toString())
            }
        }
    }

    @Test
    fun secondFailureAfterSignatureRepairStopsAutomaticRetries() = runBlocking {
        for (secondFailure in listOf<(HttpExchange) -> Unit>(
            { exchange: HttpExchange -> sendJson(exchange, 400, """{"error":{"code":"invalid_encrypted_content","message":"still bad"}}""") },
            { exchange: HttpExchange -> sendEmptySse(exchange) },
            { exchange: HttpExchange -> sendJson(exchange, 429, """{"error":{"message":"rate limit"}}""", retryAfter = "0") },
        )) {
            val fixture = ResponsesHostFixture { exchange, _, attempt ->
                if (attempt == 1) {
                    sendJson(exchange, 400, """{"error":{"code":"invalid_encrypted_content","message":"invalid"}}""")
                } else {
                    secondFailure(exchange)
                }
            }
            fixture.use {
                val history = historyWithSignedTurn(it.serviceIdentity, "vip", MODEL, "enc_old")
                val events = withTimeout(4_000) {
                    it.api.streamChat(MODEL, history, groupName = "vip").toList()
                }
                assertEquals(2, it.requests.get(), events.toString())
                assertTrue(events.last() is ChatStreamEvent.Error, events.toString())
                assertFalse(events.any { ev -> ev is ChatStreamEvent.ReplayState || ev is ChatStreamEvent.Done })
            }
        }
    }

    @Test
    fun credential401RepairAndTransientRetryCombineWithAtMostOneSignatureRepair() = runBlocking {
        val seenAuths = CopyOnWriteArrayList<String?>()
        val seenBodies = CopyOnWriteArrayList<JsonObject>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val executor = Executors.newCachedThreadPool()
        val chatAttempts = AtomicInteger()
        val tokenLookupCount = AtomicInteger()
        server.executor = executor
        server.createContext("/") { exchange ->
            val path = exchange.requestURI.path
            val bodyText = exchange.requestBody.use { it.readBytes().toString(Charsets.UTF_8) }
            if (path == "/api/token/") {
                val lookup = tokenLookupCount.incrementAndGet()
                val key = if (lookup == 1) "sk-initial-key-0123456789abcdef" else "sk-rotated-key-0123456789abcdef"
                sendJson(exchange, 200, """{"success":true,"data":{"items":[{"id":1,"name":"567 Agent [vip]","group":"vip","status":1,"unlimited_quota":true,"key":"$key"}]}}""")
            } else {
                seenAuths += exchange.requestHeaders.getFirst("Authorization")
                seenBodies += Agent567Json.parseToJsonElement(bodyText) as JsonObject
                when (chatAttempts.incrementAndGet()) {
                    1 -> sendJson(exchange, 401, """{"error":{"message":"stale group token"}}""")
                    2 -> sendJson(exchange, 400, """{"error":{"code":"invalid_encrypted_content","message":"cannot verify"}}""")
                    else -> sendSse(exchange, completedSse("rs_new", "enc_new", "after-401-and-sig"))
                }
            }
        }
        server.start()
        val origin = "http://127.0.0.1:${server.address.port}"
        val prefs = AppPreferences(MapSettings()).apply {
            setServerUrl(origin)
            setModelInferenceApi("vip", MODEL, InferenceApi.Responses)
        }
        val tokens = InMemoryTokenStore("jwt-account-token", "refresh-token")
        val refresher = TokenRefresher(tokens, { RefreshOutcome.Unauthorized }, null)
        val config = Agent567Config(origin)
        val client = createAgent567HttpClient(config, tokens, refresher)
        val bareClient = createBareHttpClient(config)
        val api = Agent567Api(client, bareClient, config, tokens, refresher, prefs, shortPolicy())
        try {
            val history = historyWithSignedTurn(prefs.serviceIdentity(config.apiBaseUrl), "vip", MODEL, "enc_old")
            val events = withTimeout(4_000) { api.streamChat(MODEL, history, groupName = "vip").toList() }
            assertEquals(3, chatAttempts.get(), events.toString())
            assertEquals(
                listOf<String?>(
                    "Bearer sk-initial-key-0123456789abcdef",
                    "Bearer sk-rotated-key-0123456789abcdef",
                    "Bearer sk-rotated-key-0123456789abcdef",
                ),
                seenAuths.toList(),
            )
            assertTrue(seenBodies[1].toString().contains("enc_old"))
            assertFalse(seenBodies[2].toString().contains("enc_old"))
            assertEquals("after-401-and-sig", events.filterIsInstance<ChatStreamEvent.Delta>().joinToString("") { it.text })
            assertTrue(events.filterIsInstance<ChatStreamEvent.ReplayState>().single().replayState.signedReasoningReset)
        } finally {
            client.close()
            bareClient.close()
            server.stop(0)
            executor.shutdownNow()
        }

        // Transient 429 before signature rejection still permits one signature repair, then stops on any further failure.
        val transientBodies = CopyOnWriteArrayList<JsonObject>()
        val transientFixture = ResponsesHostFixture { exchange, body, attempt ->
            transientBodies += body
            when (attempt) {
                1 -> sendJson(exchange, 429, """{"error":{"message":"slow down"}}""", retryAfter = "0")
                2 -> sendJson(exchange, 400, """{"error":{"code":"invalid_encrypted_content","message":"cannot verify"}}""")
                else -> sendJson(exchange, 429, """{"error":{"message":"still limited"}}""", retryAfter = "0")
            }
        }
        transientFixture.use {
            val history = historyWithSignedTurn(it.serviceIdentity, "vip", MODEL, "enc_old")
            val events = withTimeout(4_000) { it.api.streamChat(MODEL, history, groupName = "vip").toList() }
            assertEquals(3, transientBodies.size)
            assertTrue(transientBodies[1].toString().contains("enc_old"))
            assertFalse(transientBodies[2].toString().contains("enc_old"))
            assertTrue(events.last() is ChatStreamEvent.Error)
        }
    }

    @Test
    fun crossModelGroupServiceIdentityAndProtocolIsolationNeverReusesOldCiphertext() = runBlocking {
        val bodies = CopyOnWriteArrayList<JsonObject>()
        val paths = CopyOnWriteArrayList<String>()
        val fixture = ResponsesHostFixture { exchange, body, _ ->
            paths += exchange.requestURI.path
            bodies += body
            if (exchange.requestURI.path == "/v1/responses") {
                sendSse(exchange, completedSse("rs_res", "enc_res", "ok"))
            } else {
                sendSse(
                    exchange,
                    """data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}""" + "\n\ndata: [DONE]\n\n",
                )
            }
        }
        fixture.use {
            val baseService = it.serviceIdentity
            val history = listOf(
                ChatMessage(ChatRole.User, "step1"),
                ChatMessage(
                    role = ChatRole.Assistant,
                    parts = listOf(ChatContentPart.Text("tool step")),
                    replayState = AssistantReplayState(
                        inferenceApi = InferenceApi.Responses.wireValue,
                        serviceIdentity = baseService,
                        groupName = "vip",
                        modelId = MODEL,
                        reasoningItems = listOf(signedReasoning("rs_a", "enc_secret_a")),
                        toolCalls = listOf(ChatToolCall("call_1|fc_1", "lookup", """{"q":"a"}""")),
                    ),
                ),
                ChatMessage(ChatRole.Tool, listOf(ChatContentPart.Text("res")), toolCallId = "call_1|fc_1"),
                ChatMessage(ChatRole.User, "step2"),
            )

            // Cross model -> no enc_secret_a, no fc_1 id, preserves function_call/output pairing
            it.api.streamChat("other-model", history, groupName = "vip").toList()
            // Cross group -> no enc_secret_a
            it.api.streamChat(MODEL, history, groupName = "default").toList()
            // Completions protocol -> no enc_secret_a, preserves tool_calls/tool pairing
            it.preferences.setModelInferenceApi("vip", MODEL, InferenceApi.Completions)
            it.api.streamChat(MODEL, history, groupName = "vip").toList()

            assertFalse(bodies[0].toString().contains("enc_secret_a"))
            assertFalse(bodies[0].getValue("input").jsonArray[2].jsonObject.containsKey("id"))
            assertEquals("call_1", bodies[0].getValue("input").jsonArray[2].jsonObject.getValue("call_id").jsonPrimitive.content)
            assertFalse(bodies[1].toString().contains("enc_secret_a"))
            assertEquals("/v1/chat/completions", paths[2])
            assertFalse(bodies[2].toString().contains("enc_secret_a"))
            assertTrue(bodies[2].getValue("messages").jsonArray[1].jsonObject.containsKey("tool_calls"))

            // Official ServiceRoutes share serviceIdentity, while different custom server identities stay isolated.
            val routePrefs = AppPreferences(MapSettings())
            assertEquals(
                routePrefs.serviceIdentity(ServiceRoute.Mainland.origin),
                routePrefs.serviceIdentity(ServiceRoute.Germany.origin),
            )
            assertTrue(
                routePrefs.serviceIdentity("https://custom-a.example.com") !=
                    routePrefs.serviceIdentity("https://custom-b.example.com"),
            )
        }
    }

    @Test
    fun appViewModelReloadPersistenceNonSessionIsolationToolPairingAndCancellation() =
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { uiDispatcher ->
            runBlocking(uiDispatcher) {
                Dispatchers.setMain(uiDispatcher)
                val chatBodies = CopyOnWriteArrayList<JsonObject>()
                val chatAttempt = AtomicInteger()
                val cancelGate = CountDownLatch(1)
                val cancelStarted = CompletableDeferred<Unit>()
                val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
                val executor = Executors.newCachedThreadPool()
                server.executor = executor
                server.createContext("/") { exchange ->
                    val path = exchange.requestURI.path
                    val bodyText = exchange.requestBody.use { it.readBytes().toString(Charsets.UTF_8) }
                    if (path == "/v1/responses") {
                        val json = Agent567Json.parseToJsonElement(bodyText) as JsonObject
                        val inputText = json.getValue("input").toString()
                        when {
                            inputText.contains("为这段对话起一个简短") -> {
                                sendSse(exchange, completedSse("rs_title", "enc_title", "测试标题"))
                            }
                            inputText.contains("预测用户接下来最可能发送") -> {
                                sendSse(exchange, completedSse("rs_pred", "enc_pred", "继续说说"))
                            }
                            inputText.contains("Summarize the quoted conversation") -> {
                                sendSse(exchange, completedSse("rs_sum", "enc_sum", "简短摘要"))
                            }
                            else -> {
                                chatBodies += json
                                when (chatAttempt.incrementAndGet()) {
                                    1 -> sendSse(exchange, completedSse("rs_1", "enc_1", "第一轮回复"))
                                    2 -> sendJson(exchange, 400, """{"error":{"code":"invalid_encrypted_content","message":"expired"}}""")
                                    3 -> sendSse(exchange, completedSse("rs_2", "enc_2", "修复后第二轮回复"))
                                    4 -> sendSse(exchange, completedSse("rs_3", "enc_3", "重启后第三轮回复"))
                                    5 -> sendJson(exchange, 400, """{"error":{"code":"invalid_encrypted_content","message":"expired"}}""")
                                    6 -> {
                                        cancelStarted.complete(Unit)
                                        cancelGate.await(5, TimeUnit.SECONDS)
                                        sendSse(exchange, completedSse("rs_aborted", "enc_aborted", "should not persist"))
                                    }
                                    else -> sendSse(exchange, completedSse("rs_other", "enc_other", "other"))
                                }
                            }
                        }
                    } else if (path == "/api/user/models") {
                        sendJson(exchange, 200, """{"success":true,"data":["$MODEL"]}""")
                    } else if (path == "/api/user/self") {
                        sendJson(exchange, 200, """{"success":true,"data":{"id":7,"username":"test","quota":500000,"group":"vip"}}""")
                    } else if (path == "/api/user/groups") {
                        sendJson(exchange, 200, """{"success":true,"data":{"vip":{"desc":"","ratio":1}}}""")
                    } else {
                        sendJson(exchange, 200, """{"success":true,"data":{}}""")
                    }
                }
                server.start()
                val origin = "http://127.0.0.1:${server.address.port}"
                val prefSettings = MapSettings()
                val sessionSettings = MapSettings()
                val preferences = AppPreferences(prefSettings).apply {
                    setServerUrl(origin)
                    active567Group = "vip"
                    setModelInferenceApi("vip", MODEL, InferenceApi.Responses)
                    setCachedGroupModels("vip", listOf(MODEL))
                    setInputPredictionEnabled(true)
                }
                val store1 = SettingsSessionStore(sessionSettings, Dispatchers.IO)
                val container1 = AppContainer(
                    preferences = preferences,
                    tokenStore = InMemoryTokenStore("sk-isolated-test-token-123456", "sk-isolated-test-token-123456"),
                    sessionStore = store1,
                    networkAvailability = MutableStateFlow(NetworkAvailability.Available),
                    loadServiceRoutes = { emptyList() },
                )
                val vm1 = AppViewModel(container1)
                var vm2: AppViewModel? = null
                var container2: AppContainer? = null
                try {
                    withTimeout(20_000) { vm1.state.first { it.bootstrapped && !it.catalogLoading } }
                    val session = store1.createSession("ReplaySession", modelId = MODEL)
                    vm1.openChat(session.id)
                    withTimeout(20_000) { vm1.state.first { it.currentSessionId == session.id } }

                    // Turn 1: produces enc_1 (plus background auto-title & input prediction which must not pollute history)
                    vm1.onDraftChange("第一问")
                    vm1.sendMessage()
                    withTimeout(20_000) {
                        vm1.state.first { state ->
                            !state.isStreaming && state.messages.count { it.role == ChatRole.Assistant && it.status == MessageStatus.Complete } == 1
                        }
                    }
                    val afterTurn1 = store1.getMessages(session.id)
                    assertTrue(afterTurn1.last().replayState?.reasoningItems?.singleOrNull()?.contains("enc_1") == true)
                    assertFalse(afterTurn1.any { it.content.contains("继续说说") || it.content.contains("测试标题") })

                    // Turn 2: HTTP 400 signature rejection -> repairs once -> persists enc_2 + signedReasoningReset = true
                    vm1.onDraftChange("第二问")
                    vm1.sendMessage()
                    withTimeout(20_000) {
                        vm1.state.first { state ->
                            !state.isStreaming && state.messages.count { it.role == ChatRole.Assistant && it.status == MessageStatus.Complete } == 2
                        }
                    }
                    assertEquals(3, chatBodies.size)
                    assertTrue(chatBodies[1].toString().contains("enc_1"))
                    assertFalse(chatBodies[2].toString().contains("enc_1"))
                    val afterTurn2 = store1.getMessages(session.id)
                    val repairedMsg = afterTurn2.last()
                    assertEquals("修复后第二轮回复", repairedMsg.content)
                    assertEquals(true, repairedMsg.replayState?.signedReasoningReset)
                    assertTrue(repairedMsg.replayState?.reasoningItems?.singleOrNull()?.contains("enc_2") == true)
                    assertFalse(repairedMsg.replayState.toString().contains("enc_2"))

                    // Simulate process restart / store reload
                    vm1.viewModelScope.coroutineContext.job.cancelAndJoin()
                    container1.close()

                    val store2 = SettingsSessionStore(sessionSettings, Dispatchers.IO)
                    val prefs2 = AppPreferences(prefSettings)
                    container2 = AppContainer(
                        preferences = prefs2,
                        tokenStore = InMemoryTokenStore("sk-isolated-test-token-123456", "sk-isolated-test-token-123456"),
                        sessionStore = store2,
                        networkAvailability = MutableStateFlow(NetworkAvailability.Available),
                        loadServiceRoutes = { emptyList() },
                    )
                    vm2 = AppViewModel(container2)
                    withTimeout(20_000) { vm2.state.first { it.bootstrapped && !it.catalogLoading } }
                    vm2.openChat(session.id)
                    withTimeout(20_000) { vm2.state.first { it.currentSessionId == session.id } }

                    // Turn 3 after reload: omits enc_1 before reset boundary and carries enc_2
                    vm2.onDraftChange("第三问")
                    vm2.sendMessage()
                    withTimeout(20_000) {
                        vm2.state.first { state ->
                            !state.isStreaming && state.messages.count { it.role == ChatRole.Assistant && it.status == MessageStatus.Complete } == 3
                        }
                    }
                    assertEquals(4, chatBodies.size)
                    assertFalse(chatBodies[3].toString().contains("enc_1"))
                    assertTrue(chatBodies[3].toString().contains("enc_2"))

                    // Verify tool call / tool output pairing and orphan stripping through ViewModel + SessionStore
                    val pairSession = store2.createSession("ToolPairSession", modelId = MODEL)
                    val svc = prefs2.serviceIdentity(origin)
                    store2.upsertMessage(LocalMessage("u0", pairSession.id, ChatRole.User, "run tools", MessageStatus.Complete, 1))
                    store2.upsertMessage(
                        LocalMessage(
                            id = "a0",
                            sessionId = pairSession.id,
                            role = ChatRole.Assistant,
                            content = "calling",
                            status = MessageStatus.Complete,
                            createdAtEpochMs = 2,
                            replayState = AssistantReplayState(
                                inferenceApi = InferenceApi.Responses.wireValue,
                                serviceIdentity = svc,
                                groupName = "vip",
                                modelId = MODEL,
                                reasoningItems = listOf(signedReasoning("rs_p", "enc_pair")),
                                toolCalls = listOf(
                                    ChatToolCall("call_ok|fc_ok", "lookup", """{"q":1}"""),
                                    ChatToolCall("call_orphan|fc_orphan", "generate_image", """{"prompt":"cat"}"""),
                                ),
                            ),
                        ),
                    )
                    store2.upsertMessage(
                        LocalMessage("t0", pairSession.id, ChatRole.Tool, """{"ok":true}""", MessageStatus.Complete, 3, toolCallId = "call_ok|fc_ok"),
                    )
                    store2.upsertMessage(
                        LocalMessage("t_orphan", pairSession.id, ChatRole.Tool, "dangling", MessageStatus.Complete, 4, toolCallId = "call_missing"),
                    )
                    vm2.openChat(pairSession.id)
                    withTimeout(20_000) { vm2.state.first { it.currentSessionId == pairSession.id } }
                    vm2.onDraftChange("continue")
                    vm2.sendMessage()
                    // Request 5 gets 400 -> repairs to Request 6 which blocks on cancelGate -> cancel mid-flight!
                    withTimeout(10_000) { cancelStarted.await() }
                    vm2.stopStreaming()
                    withTimeout(20_000) {
                        vm2.state.first { state ->
                            !state.isStreaming && state.messages.lastOrNull()?.status == MessageStatus.Aborted
                        }
                    }

                    assertEquals(6, chatBodies.size)
                    val pairInput = chatBodies[4].getValue("input").jsonArray
                    assertEquals(
                        listOf("user", "reasoning", "assistant", "function_call", "function_call_output", "user"),
                        inputTypes(pairInput),
                    )
                    assertFalse(pairInput.toString().contains("call_orphan"))
                    assertFalse(pairInput.toString().contains("call_missing"))

                    val abortedMsg = store2.getMessages(pairSession.id).last()
                    assertEquals(MessageStatus.Aborted, abortedMsg.status)
                    assertNull(abortedMsg.replayState)

                    // Diagnostics never leak ciphertext
                    val diag = chatFailureDiagnostic(
                        ChatFailureStage.Chat,
                        Agent567Exception.Api(400, null, "invalid enc_1", rawBody = """{"encrypted_content":"enc_2"}""", providerCode = "invalid_encrypted_content"),
                    )
                    assertFalse(diag.contains("enc_1"))
                    assertFalse(diag.contains("enc_2"))
                } finally {
                    cancelGate.countDown()
                    vm1.viewModelScope.coroutineContext.job.cancelAndJoin()
                    vm2?.viewModelScope?.coroutineContext?.job?.cancelAndJoin()
                    container1.close()
                    container2?.close()
                    server.stop(0)
                    executor.shutdownNow()
                    Dispatchers.resetMain()
                }
            }
        }

    @OptIn(ExperimentalEncodingApi::class)
    @Test
    fun inlineImageToolStripsUnpairedFunctionCallAndCompactionKeepsHistoryClean() =
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { uiDispatcher ->
            runBlocking(uiDispatcher) {
                Dispatchers.setMain(uiDispatcher)
                val chatBodies = CopyOnWriteArrayList<JsonObject>()
                val chatTurn = AtomicInteger()
                val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
                val executor = Executors.newCachedThreadPool()
                server.executor = executor
                server.createContext("/") { exchange ->
                    val path = exchange.requestURI.path
                    val bodyText = exchange.requestBody.use { it.readBytes().toString(Charsets.UTF_8) }
                    when {
                        path == "/v1/responses" -> {
                            val json = Agent567Json.parseToJsonElement(bodyText) as JsonObject
                            val inputText = json.getValue("input").toString()
                            if (inputText.contains("Summarize the quoted conversation")) {
                                sendSse(exchange, completedSse("rs_compact", "enc_compact", "摘要完成"))
                            } else {
                                chatBodies += json
                                if (chatTurn.incrementAndGet() == 1) {
                                    val reasoning = signedReasoning("rs_img", "enc_img")
                                    val toolCall = """{"type":"function_call","id":"fc_img","call_id":"call_img","name":"generate_image","arguments":"{\"prompt\":\"a small cat\"}"}"""
                                    sendSse(
                                        exchange,
                                        """
                                        data: {"type":"response.output_item.done","output_index":0,"item":$reasoning}

                                        data: {"type":"response.output_item.done","output_index":1,"item":$toolCall}

                                        data: {"type":"response.completed","response":{"status":"completed","output":[$reasoning,$toolCall],"usage":{"input_tokens":8,"output_tokens":4,"total_tokens":12}}}

                                        """.trimIndent() + "\n\n",
                                    )
                                } else {
                                    sendSse(exchange, completedSse("rs_follow", "enc_follow", "图片已就绪"))
                                }
                            }
                        }
                        path.startsWith("/v1/images/") -> {
                            sendJson(exchange, 200, """{"data":[{"b64_json":"$PNG_1X1"}]}""")
                        }
                        path == "/api/user/models" -> sendJson(exchange, 200, """{"success":true,"data":["$MODEL","gpt-image-2"]}""")
                        path == "/api/user/self" -> sendJson(exchange, 200, """{"success":true,"data":{"id":7,"username":"test","quota":500000,"group":"vip"}}""")
                        path == "/api/user/groups" -> sendJson(exchange, 200, """{"success":true,"data":{"vip":{"desc":"","ratio":1}}}""")
                        else -> sendJson(exchange, 200, """{"success":true,"data":{}}""")
                    }
                }
                server.start()
                val origin = "http://127.0.0.1:${server.address.port}"
                val preferences = AppPreferences(MapSettings()).apply {
                    setServerUrl(origin)
                    active567Group = "vip"
                    activeImageGroup = "vip"
                    activeImageModel = "gpt-image-2"
                    imageGenEnabled = true
                    setModelInferenceApi("vip", MODEL, InferenceApi.Responses)
                    setCachedGroupModels("vip", listOf(MODEL, "gpt-image-2"))
                    setInputPredictionEnabled(false)
                }
                val imageFiles = object : MessageImageFileStore {
                    private val files = mutableMapOf<String, ByteArray>()
                    override fun writeBytes(key: String, bytes: ByteArray): Boolean {
                        files[key] = bytes.copyOf()
                        return true
                    }
                    override fun writeBase64(key: String, base64Data: String): Boolean =
                        writeBytes(key, Base64.decode(base64Data.substringAfter(',', base64Data)))
                    override fun readBytes(key: String): ByteArray? = files[key]?.copyOf()
                    override fun delete(key: String) {
                        files.remove(key)
                    }
                }
                val store = SettingsSessionStore(MapSettings(), Dispatchers.IO, imageFiles)
                val container = AppContainer(
                    preferences = preferences,
                    tokenStore = InMemoryTokenStore("sk-isolated-test-token-123456", "sk-isolated-test-token-123456"),
                    sessionStore = store,
                    networkAvailability = MutableStateFlow(NetworkAvailability.Available),
                    loadServiceRoutes = { emptyList() },
                )
                val vm = AppViewModel(container)
                try {
                    withTimeout(20_000) { vm.state.first { it.bootstrapped && !it.catalogLoading } }
                    val session = store.createSession("ImageToolSession", modelId = MODEL)
                    vm.openChat(session.id)
                    withTimeout(20_000) { vm.state.first { it.currentSessionId == session.id } }

                    vm.onDraftChange("画一只小猫")
                    vm.sendMessage()
                    withTimeout(20_000) {
                        vm.state.first { state ->
                            !state.isStreaming && state.messages.any { it.role == ChatRole.Assistant && it.status == MessageStatus.Complete && it.images.isNotEmpty() }
                        }
                    }
                    val imgAssistant = store.getMessages(session.id).last()
                    assertEquals(emptyList(), imgAssistant.replayState?.toolCalls)
                    assertTrue(imgAssistant.replayState?.reasoningItems?.singleOrNull()?.contains("enc_img") == true)

                    vm.onDraftChange("再加个帽子")
                    vm.sendMessage()
                    withTimeout(20_000) {
                        vm.state.first { state ->
                            !state.isStreaming && state.messages.count { it.role == ChatRole.Assistant && it.status == MessageStatus.Complete } == 2
                        }
                    }
                    val secondInput = chatBodies[1].getValue("input").jsonArray
                    assertTrue(secondInput.toString().contains("enc_img"))
                    assertFalse(inputTypes(secondInput).contains("function_call"))

                    // Add extra turns so compactChatContext() triggers summarization without polluting replayState
                    for (i in 1..4) {
                        store.upsertMessage(LocalMessage("u_extra_$i", session.id, ChatRole.User, "请记住一条较长的背景说明 $i " + "内容".repeat(40), MessageStatus.Complete, 100L + i * 2))
                        store.upsertMessage(LocalMessage("a_extra_$i", session.id, ChatRole.Assistant, "收到第 $i 条说明 " + "回复".repeat(40), MessageStatus.Complete, 101L + i * 2))
                    }
                    vm.compactChatContext()
                    withTimeout(20_000) {
                        vm.state.first { !it.contextBusy && (it.contextNotice == Str.contextCompacted || it.contextError != null) }
                    }
                    assertNull(vm.state.value.contextError)
                    assertEquals("摘要完成", store.getSession(session.id)?.context?.summary)
                    assertFalse(store.getMessages(session.id).any { it.replayState?.reasoningItems?.any { r -> r.contains("enc_compact") } == true })
                } finally {
                    vm.viewModelScope.coroutineContext.job.cancelAndJoin()
                    container.close()
                    server.stop(0)
                    executor.shutdownNow()
                    Dispatchers.resetMain()
                }
            }
        }

    private class ResponsesHostFixture(
        private val respond: (HttpExchange, JsonObject, Int) -> Unit,
    ) : AutoCloseable {
        private val executor = Executors.newCachedThreadPool()
        private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        private val tokens = InMemoryTokenStore("sk-responses-recovery-test", "sk-responses-recovery-test")
        private val refresher = TokenRefresher(tokens, { RefreshOutcome.Unauthorized }, null)
        val preferences = AppPreferences(MapSettings())
        private val config: Agent567Config
        private val client: io.ktor.client.HttpClient
        private val bareClient: io.ktor.client.HttpClient
        val requests = AtomicInteger()
        val serviceIdentity: String
        val api: Agent567Api

        init {
            server.executor = executor
            server.createContext("/") { exchange ->
                val attempt = requests.incrementAndGet()
                val bodyText = exchange.requestBody.use { it.readBytes().toString(Charsets.UTF_8) }
                val bodyJson = Agent567Json.parseToJsonElement(bodyText) as JsonObject
                try {
                    respond(exchange, bodyJson, attempt)
                } finally {
                    runCatching { exchange.responseBody.close() }
                    runCatching { exchange.close() }
                }
            }
            server.start()
            val origin = "http://127.0.0.1:${server.address.port}"
            preferences.setServerUrl(origin)
            preferences.setModelInferenceApi("vip", MODEL, InferenceApi.Responses)
            preferences.setModelInferenceApi("vip", "other-model", InferenceApi.Responses)
            preferences.setModelInferenceApi("default", MODEL, InferenceApi.Responses)
            config = Agent567Config(origin)
            serviceIdentity = preferences.serviceIdentity(config.apiBaseUrl)
            client = createAgent567HttpClient(config, tokens, refresher)
            bareClient = createBareHttpClient(config)
            api = Agent567Api(
                client = client,
                bareClient = bareClient,
                config = config,
                tokenStore = tokens,
                tokenRefresher = refresher,
                preferences = preferences,
                chatStreamPolicy = shortPolicy(),
            )
        }

        override fun close() {
            client.close()
            bareClient.close()
            server.stop(0)
            executor.shutdownNow()
        }
    }

    companion object {
        private const val MODEL = "gpt-5-codex"
        private const val PNG_1X1 =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

        private fun shortPolicy() = DirectChatStreamPolicy(
            firstEventTimeoutMs = 2_000,
            idleEventTimeoutMs = 2_000,
            emptyRetryDelayMs = 10,
            transientRetryDelayMs = 10,
            maxRetryDelayMs = 100,
            jitterMs = 0,
        )

        private fun signedReasoning(id: String, encrypted: String): String =
            """{"type":"reasoning","id":"$id","encrypted_content":"$encrypted","summary":[]}"""

        private fun historyWithSignedTurn(
            serviceIdentity: String,
            groupName: String?,
            modelId: String,
            encrypted: String,
        ): List<ChatMessage> = listOf(
            ChatMessage(ChatRole.User, "hi"),
            ChatMessage(
                role = ChatRole.Assistant,
                parts = listOf(ChatContentPart.Text("prev")),
                replayState = AssistantReplayState(
                    inferenceApi = InferenceApi.Responses.wireValue,
                    serviceIdentity = serviceIdentity,
                    groupName = groupName,
                    modelId = modelId,
                    reasoningItems = listOf(signedReasoning("rs_prev", encrypted)),
                ),
            ),
            ChatMessage(ChatRole.User, "next"),
        )

        private fun inputTypes(input: JsonArray): List<String> = input.map { element ->
            val obj = element.jsonObject
            obj["type"]?.jsonPrimitive?.content ?: obj.getValue("role").jsonPrimitive.content
        }

        private fun completedSse(reasoningId: String, encryptedContent: String, text: String): String {
            val reasoning = signedReasoning(reasoningId, encryptedContent)
            return """
                data: {"type":"response.output_item.done","output_index":0,"item":$reasoning}

                data: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":"$text"}

                data: {"type":"response.completed","response":{"status":"completed","output":[$reasoning,{"type":"message","content":[{"type":"output_text","text":"$text"}]}],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}

            """.trimIndent() + "\n\n"
        }

        private fun sendEmptySse(exchange: HttpExchange) {
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
        }

        private fun sendSse(exchange: HttpExchange, body: String) {
            val bytes = body.toByteArray()
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }

        private fun sendJson(
            exchange: HttpExchange,
            status: Int,
            body: String,
            retryAfter: String? = null,
        ) {
            val bytes = body.toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            retryAfter?.let { exchange.responseHeaders.add("Retry-After", it) }
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
    }
}
