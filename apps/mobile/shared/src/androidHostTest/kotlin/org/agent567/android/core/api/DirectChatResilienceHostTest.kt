package org.agent567.android.core.api

import com.russhwolf.settings.MapSettings
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.Collections
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.ChatRepository
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.chat.InferenceApi
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.net.RefreshOutcome
import org.agent567.android.core.net.TokenRefresher
import org.agent567.android.core.net.createAgent567HttpClient
import org.agent567.android.core.net.createBareHttpClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DirectChatResilienceHostTest {
    @Test
    fun retryAfterParsesAnHttpDateUsingUtc() {
        val receivedAt = 1_445_412_478_000L
        assertEquals(2_000L, chatRetryAfterMs("Wed, 21 Oct 2015 07:28:00 GMT", receivedAt))
        assertEquals(0L, chatRetryAfterMs("Wed, 21 Oct 2015 07:27:00 GMT", receivedAt))
        assertEquals(null, chatRetryAfterMs("Wed, 21 Oct 2015 07:28:00 GMT invalid", receivedAt))
    }

    @Test
    fun emptyResponsesIsRetriedThroughChatRepository() = runBlocking {
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Responses,
            policy = shortPolicy(),
        ) { exchange, attempt ->
            if (attempt == 1) {
                sendEmptySse(exchange)
            } else {
                sendSse(
                    exchange,
                    """
                    data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"ok"}

                    data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}

                    """.trimIndent(),
                )
            }
        }
        fixture.use {
            val events = withTimeout(4_000) {
                ChatRepository(it.api).stream(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "hello")),
                ).toList()
            }

            assertEquals(2, it.requests.get(), events.toString())
            assertEquals(listOf("/v1/responses", "/v1/responses"), it.paths)
            assertEquals("ok", events.filterIsInstance<ChatStreamEvent.Delta>().joinToString("") { event -> event.text })
            assertEquals(2, events.filterIsInstance<ChatStreamEvent.Finished>().single().usage?.totalTokens)
            assertTrue(events.any { event -> event is ChatStreamEvent.Done })
            assertFalse(events.any { event -> event is ChatStreamEvent.Error }, events.toString())
        }
    }

    @Test
    fun emptyCompletionsIsRetriedThroughStreamChat() = runBlocking {
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Completions,
            policy = shortPolicy(),
        ) { exchange, attempt ->
            if (attempt == 1) {
                sendEmptySse(exchange)
            } else {
                sendSse(
                    exchange,
                    """
                    data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}

                    data: [DONE]

                    """.trimIndent(),
                )
            }
        }
        fixture.use {
            val events = withTimeout(4_000) {
                it.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "hello")),
                ).toList()
            }

            assertEquals(2, it.requests.get(), events.toString())
            assertEquals(listOf("/v1/chat/completions", "/v1/chat/completions"), it.paths)
            assertEquals("ok", events.filterIsInstance<ChatStreamEvent.Delta>().joinToString("") { event -> event.text })
            assertEquals(2, events.filterIsInstance<ChatStreamEvent.Finished>().single().usage?.totalTokens)
            assertTrue(events.any { event -> event is ChatStreamEvent.Done })
            assertFalse(events.any { event -> event is ChatStreamEvent.Error }, events.toString())
        }
    }

    @Test
    fun secondEmptyResponseFailsAfterOneTransparentRetry() = runBlocking {
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Responses,
            policy = shortPolicy(),
        ) { exchange, _ ->
            sendEmptySse(exchange)
        }
        fixture.use {
            val events = withTimeout(4_000) {
                it.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "still empty")),
                ).toList()
            }

            assertEquals(2, it.requests.get())
            assertTrue(events.any { event -> event is ChatStreamEvent.Error }, events.toString())
            assertFalse(events.any { event -> event is ChatStreamEvent.Done }, events.toString())
        }
    }

    @Test
    fun emptyCompletionWithReportedUsageIsNeverReplayed() = runBlocking {
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Responses,
            policy = shortPolicy(),
        ) { exchange, attempt ->
            if (attempt == 1) {
                sendSse(
                    exchange,
                    """
                    data: {"type":"response.completed","response":{"status":"completed","output":[],"usage":{"input_tokens":4,"output_tokens":0,"total_tokens":4}}}

                    """.trimIndent(),
                )
            } else {
                sendSse(
                    exchange,
                    """
                    data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"must-not-run"}

                    data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"must-not-run"}]}]}}

                    """.trimIndent(),
                )
            }
        }
        fixture.use {
            val events = withTimeout(4_000) {
                it.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "explicit empty completion")),
                ).toList()
            }

            assertEquals(1, it.requests.get())
            assertEquals(4, events.filterIsInstance<ChatStreamEvent.Finished>().single().usage?.totalTokens)
            assertTrue(events.any { event -> event is ChatStreamEvent.Error }, events.toString())
            assertFalse(events.any { event -> event is ChatStreamEvent.Delta }, events.toString())
            assertFalse(events.any { event -> event is ChatStreamEvent.Done }, events.toString())
        }
    }

    @Test
    fun usageBeforeEofIsPreservedAndNeverReplayed() = runBlocking {
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Completions,
            policy = shortPolicy(),
        ) { exchange, _ ->
            sendSse(
                exchange,
                """
                data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":5,"total_tokens":9}}

                """.trimIndent(),
            )
        }
        fixture.use {
            val events = withTimeout(4_000) {
                it.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "usage then close")),
                ).toList()
            }

            assertEquals(1, it.requests.get())
            assertEquals(9, events.filterIsInstance<ChatStreamEvent.State>().single().usage?.totalTokens)
            assertTrue(events.any { event -> event is ChatStreamEvent.Error }, events.toString())
            assertFalse(events.any { event -> event is ChatStreamEvent.Done }, events.toString())
        }
    }

    @Test
    fun partialToolArgumentsBeforeEofAreNeverReplayedOrExecuted() = runBlocking {
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Completions,
            policy = shortPolicy(),
        ) { exchange, _ ->
            sendSse(
                exchange,
                """
                data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-image-1","function":{"name":"generate_image","arguments":"{\"prompt\":"}}]}}]}

                """.trimIndent(),
            )
        }
        fixture.use {
            val events = withTimeout(4_000) {
                it.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "draw")),
                    imageGenModel = "image-test",
                ).toList()
            }

            assertEquals(1, it.requests.get())
            assertTrue(events.any { event -> event is ChatStreamEvent.Error }, events.toString())
            assertFalse(events.any { event -> event is ChatStreamEvent.Tool }, events.toString())
            assertFalse(events.any { event -> event is ChatStreamEvent.Done }, events.toString())
        }
    }

    @Test
    fun firstEventTimeoutIgnoresHeartbeatsAndDoesNotReplay() = runBlocking {
        val heartbeatSeen = CountDownLatch(1)
        val keepAlive = AtomicBoolean(true)
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Responses,
            policy = shortPolicy(firstEventTimeoutMs = 160, idleEventTimeoutMs = 500),
        ) { exchange, _ ->
            val output = openSse(exchange)
            try {
                while (keepAlive.get()) {
                    output.write(": keep-alive\n\n".toByteArray())
                    output.flush()
                    heartbeatSeen.countDown()
                    Thread.sleep(20)
                }
            } catch (_: Exception) {
            } finally {
                runCatching { output.close() }
            }
        }
        try {
            val pending = async(Dispatchers.IO) {
                fixture.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "no semantic event")),
                ).toList()
            }
            assertTrue(heartbeatSeen.await(2, TimeUnit.SECONDS))

            val events = withTimeout(3_000) { pending.await() }
            assertEquals(1, fixture.requests.get())
            assertTrue(events.any { event -> event is ChatStreamEvent.Error }, events.toString())
            assertFalse(events.any { event -> event is ChatStreamEvent.Done }, events.toString())
        } finally {
            keepAlive.set(false)
            fixture.close()
        }
    }

    @Test
    fun idleTimeoutAfterPartialOutputPreservesDeltaAndDoesNotReplay() = runBlocking {
        val keepAlive = AtomicBoolean(true)
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Responses,
            policy = shortPolicy(firstEventTimeoutMs = 500, idleEventTimeoutMs = 140),
        ) { exchange, _ ->
            val output = openSse(exchange)
            try {
                output.write(
                    "data: {\"type\":\"response.output_text.delta\",\"output_index\":0,\"content_index\":0,\"delta\":\"partial\"}\n\n"
                        .toByteArray(),
                )
                output.flush()
                while (keepAlive.get()) Thread.sleep(20)
            } catch (_: Exception) {
            } finally {
                runCatching { output.close() }
            }
        }
        try {
            val events = withTimeout(4_000) {
                fixture.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "pause")),
                ).toList()
            }

            assertEquals(1, fixture.requests.get())
            assertEquals("partial", events.filterIsInstance<ChatStreamEvent.Delta>().single().text)
            assertTrue(events.any { event -> event is ChatStreamEvent.Error }, events.toString())
            assertFalse(events.any { event -> event is ChatStreamEvent.Done }, events.toString())
        } finally {
            keepAlive.set(false)
            fixture.close()
        }
    }

    @Test
    fun cancellationAfterPartialOutputClosesTheKtorStreamWithoutAnErrorEvent() = runBlocking {
        val deltaReceived = CompletableDeferred<Unit>()
        val connectionClosed = CountDownLatch(1)
        val keepAlive = AtomicBoolean(true)
        val received = Collections.synchronizedList(mutableListOf<ChatStreamEvent>())
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Responses,
            policy = shortPolicy(firstEventTimeoutMs = 1_000, idleEventTimeoutMs = 5_000),
        ) { exchange, _ ->
            val output = openSse(exchange)
            try {
                output.write(
                    "data: {\"type\":\"response.output_text.delta\",\"output_index\":0,\"content_index\":0,\"delta\":\"partial\"}\n\n"
                        .toByteArray(),
                )
                output.flush()
                while (keepAlive.get()) {
                    output.write(": keep-alive\n\n".toByteArray())
                    output.flush()
                    Thread.sleep(20)
                }
            } catch (_: Exception) {
                connectionClosed.countDown()
            } finally {
                runCatching { output.close() }
            }
        }
        try {
            val job = launch(Dispatchers.IO) {
                fixture.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "cancel")),
                ).collect { event ->
                    received += event
                    if (event is ChatStreamEvent.Delta) deltaReceived.complete(Unit)
                }
            }
            withTimeout(2_000) { deltaReceived.await() }
            withTimeout(2_000) { job.cancelAndJoin() }
            assertTrue(connectionClosed.await(2, TimeUnit.SECONDS))

            assertEquals(1, fixture.requests.get())
            assertEquals("partial", received.filterIsInstance<ChatStreamEvent.Delta>().single().text)
            assertFalse(received.any { event -> event is ChatStreamEvent.Error }, received.toString())
        } finally {
            keepAlive.set(false)
            fixture.close()
        }
    }

    @Test
    fun retryAfterOn429WaitsWithinTheCapThenRetriesOnce() = runBlocking {
        val firstRequestAt = AtomicLong(0)
        val secondRequestAt = AtomicLong(0)
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Completions,
            policy = shortPolicy(
                transientRetryDelayMs = 5,
                maxRetryDelayMs = 2_000,
                jitterMs = 0,
            ),
        ) { exchange, attempt ->
            if (attempt == 1) {
                firstRequestAt.compareAndSet(0, System.nanoTime())
                sendError(
                    exchange = exchange,
                    status = 429,
                    body = """{"error":{"message":"rate limited","code":"rate_limit"}}""",
                    retryAfter = "1",
                )
            } else {
                secondRequestAt.compareAndSet(0, System.nanoTime())
                sendSse(
                    exchange,
                    """
                    data: {"choices":[{"delta":{"content":"after-wait"},"finish_reason":"stop"}]}

                    data: [DONE]

                    """.trimIndent(),
                )
            }
        }
        fixture.use {
            val events = withTimeout(4_000) {
                it.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "retry")),
                ).toList()
            }

            assertEquals(2, it.requests.get())
            assertTrue(secondRequestAt.get() > firstRequestAt.get())
            val delayMs = TimeUnit.NANOSECONDS.toMillis(secondRequestAt.get() - firstRequestAt.get())
            assertTrue(delayMs >= 950, "Retry-After was not honored: ${delayMs}ms")
            assertEquals("after-wait", events.filterIsInstance<ChatStreamEvent.Delta>().joinToString("") { event -> event.text })
            assertTrue(events.any { event -> event is ChatStreamEvent.Done })
            assertFalse(events.any { event -> event is ChatStreamEvent.Error }, events.toString())
        }
    }

    @Test
    fun retryAfterOn503UsesTheSameBoundedRetryPath() = runBlocking {
        val firstRequestAt = AtomicLong(0)
        val secondRequestAt = AtomicLong(0)
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Responses,
            policy = shortPolicy(
                transientRetryDelayMs = 5,
                maxRetryDelayMs = 2_000,
                jitterMs = 0,
            ),
        ) { exchange, attempt ->
            if (attempt == 1) {
                firstRequestAt.compareAndSet(0, System.nanoTime())
                sendError(
                    exchange = exchange,
                    status = 503,
                    body = """{"error":{"message":"service busy","code":"server_busy"}}""",
                    retryAfter = "1",
                )
            } else {
                secondRequestAt.compareAndSet(0, System.nanoTime())
                sendSse(
                    exchange,
                    """
                    data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"after-busy"}

                    data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"after-busy"}]}]}}

                    """.trimIndent(),
                )
            }
        }
        fixture.use {
            val events = withTimeout(4_000) {
                it.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "retry busy")),
                ).toList()
            }

            assertEquals(2, it.requests.get())
            assertTrue(secondRequestAt.get() > firstRequestAt.get())
            val delayMs = TimeUnit.NANOSECONDS.toMillis(secondRequestAt.get() - firstRequestAt.get())
            assertTrue(delayMs >= 950, "503 Retry-After was not honored: ${delayMs}ms")
            assertEquals("after-busy", events.filterIsInstance<ChatStreamEvent.Delta>().joinToString("") { event -> event.text })
            assertTrue(events.any { event -> event is ChatStreamEvent.Done })
            assertFalse(events.any { event -> event is ChatStreamEvent.Error }, events.toString())
        }
    }

    @Test
    fun retryAfterOverBudgetOrQuotaRejectionDoesNotRepeatTheRequest() = runBlocking {
        for ((retryAfter, code) in listOf("120" to "rate_limit", "0" to "insufficient_quota")) {
            DirectChatFixture(InferenceApi.Completions, shortPolicy()) { exchange, _ ->
                sendError(exchange, 429, """{"error":{"message":"request rejected","code":"$code"}}""", retryAfter)
            }.use { fixture ->
                val events = withTimeout(4_000) {
                    fixture.api.streamChat(MODEL, listOf(ChatMessage(ChatRole.User, "do not retry"))).toList()
                }
                assertEquals(1, fixture.requests.get(), code)
                assertTrue(events.single() is ChatStreamEvent.Error, events.toString())
            }
        }
    }

    @Test
    fun completionSseErrorRetainsUsageAndNeverRetriesAsEmpty() = runBlocking {
        DirectChatFixture(InferenceApi.Completions, shortPolicy()) { exchange, _ ->
            sendSse(exchange, """
                data: {"error":{"message":"upstream rejected"},"usage":{"prompt_tokens":2,"completion_tokens":0,"total_tokens":2}}

                data: [DONE]

            """.trimIndent())
        }.use { fixture ->
            val events = withTimeout(4_000) {
                fixture.api.streamChat(MODEL, listOf(ChatMessage(ChatRole.User, "do not retry"))).toList()
            }
            assertEquals(1, fixture.requests.get())
            assertEquals(2, events.filterIsInstance<ChatStreamEvent.State>().single().usage?.totalTokens)
            assertEquals("upstream rejected", events.filterIsInstance<ChatStreamEvent.Error>().single().exception.message)
            assertFalse(events.any { it is ChatStreamEvent.Done })
        }
    }

    @Test
    fun cancellingDuringRetryBackoffDoesNotSendASecondRequest() = runBlocking {
        val retrying = CompletableDeferred<Unit>()
        val received = Collections.synchronizedList(mutableListOf<ChatStreamEvent>())
        val fixture = DirectChatFixture(
            inferenceApi = InferenceApi.Completions,
            policy = shortPolicy(
                transientRetryDelayMs = 5,
                maxRetryDelayMs = 2_000,
                jitterMs = 0,
            ),
        ) { exchange, attempt ->
            if (attempt == 1) {
                sendError(
                    exchange = exchange,
                    status = 429,
                    body = """{"error":{"message":"rate limited","code":"rate_limit"}}""",
                    retryAfter = "1",
                )
            } else {
                sendSse(
                    exchange,
                    """
                    data: {"choices":[{"delta":{"content":"must-not-run"},"finish_reason":"stop"}]}

                    data: [DONE]

                    """.trimIndent(),
                )
            }
        }
        fixture.use {
            val job = launch(Dispatchers.IO) {
                it.api.streamChat(
                    model = MODEL,
                    messages = listOf(ChatMessage(ChatRole.User, "cancel backoff")),
                ).collect { event ->
                    received += event
                    if (event is ChatStreamEvent.State && event.value == "retrying") retrying.complete(Unit)
                }
            }
            withTimeout(2_000) { retrying.await() }
            withTimeout(2_000) { job.cancelAndJoin() }

            assertEquals(1, it.requests.get())
            assertFalse(
                received.filterIsInstance<ChatStreamEvent.Delta>().any { event -> event.text == "must-not-run" },
                received.toString(),
            )
            assertFalse(received.any { event -> event is ChatStreamEvent.Error }, received.toString())
        }
    }

    private class DirectChatFixture(
        inferenceApi: InferenceApi,
        policy: DirectChatStreamPolicy,
        private val respond: (HttpExchange, Int) -> Unit,
    ) : AutoCloseable {
        private val executor = Executors.newCachedThreadPool()
        private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        private val tokens = InMemoryTokenStore("sk-direct-chat-fixture", "sk-direct-chat-fixture")
        private val refresher = TokenRefresher(tokens, { RefreshOutcome.Unauthorized }, null)
        private val preferences = AppPreferences(MapSettings())
        private val config: Agent567Config
        private val client: io.ktor.client.HttpClient
        private val bareClient: io.ktor.client.HttpClient
        val requests = AtomicInteger()
        val paths = CopyOnWriteArrayList<String>()
        val api: Agent567Api

        init {
            server.executor = executor
            server.createContext("/") { exchange ->
                val attempt = requests.incrementAndGet()
                paths += exchange.requestURI.path
                exchange.requestBody.use { it.readBytes() }
                try {
                    respond(exchange, attempt)
                } finally {
                    runCatching { exchange.responseBody.close() }
                    runCatching { exchange.close() }
                }
            }
            server.start()
            val origin = "http://127.0.0.1:${server.address.port}"
            preferences.setServerUrl(origin)
            preferences.setModelInferenceApi(null, MODEL, inferenceApi)
            config = Agent567Config(origin)
            client = createAgent567HttpClient(config, tokens, refresher)
            bareClient = createBareHttpClient(config)
            api = Agent567Api(
                client = client,
                bareClient = bareClient,
                config = config,
                tokenStore = tokens,
                tokenRefresher = refresher,
                preferences = preferences,
                chatStreamPolicy = policy,
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
        private const val MODEL = "test-model"

        private fun shortPolicy(
            firstEventTimeoutMs: Long = 1_000,
            idleEventTimeoutMs: Long = 1_000,
            emptyRetryDelayMs: Long = 10,
            transientRetryDelayMs: Long = 10,
            maxRetryDelayMs: Long = 100,
            jitterMs: Long = 0,
        ) = DirectChatStreamPolicy(
            firstEventTimeoutMs = firstEventTimeoutMs,
            idleEventTimeoutMs = idleEventTimeoutMs,
            emptyRetryDelayMs = emptyRetryDelayMs,
            transientRetryDelayMs = transientRetryDelayMs,
            maxRetryDelayMs = maxRetryDelayMs,
            jitterMs = jitterMs,
        )

        private fun sendEmptySse(exchange: HttpExchange) {
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
        }

        private fun openSse(exchange: HttpExchange): java.io.OutputStream {
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.responseHeaders.add("Cache-Control", "no-cache")
            exchange.sendResponseHeaders(200, 0)
            return exchange.responseBody
        }

        private fun sendSse(exchange: HttpExchange, body: String) {
            val bytes = body.toByteArray()
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }

        private fun sendError(
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
