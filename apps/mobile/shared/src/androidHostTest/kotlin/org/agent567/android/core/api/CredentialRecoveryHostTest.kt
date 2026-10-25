package org.agent567.android.core.api

import com.russhwolf.settings.MapSettings
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.toList
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.net.TokenRefresher
import org.agent567.android.core.net.createBareHttpClient
import org.agent567.android.core.net.createAgent567HttpClient
import kotlin.test.*

class CredentialRecoveryHostTest {
    @Test fun restoredGroupKeyIsReplacedAfter401WithoutLoggingOutOrRepeatingSuccessfulChat() = runBlocking {
        Fixture().use { fixture ->
            fixture.api.ensureApiKeyForGroup("B")
            fixture.reopen()
            fixture.key = "sk-new-model-key-123456789"
            val events = fixture.chat()
            assertTrue(events.any { it is ChatStreamEvent.Done }, events.toString())
            assertFalse(events.any { it is ChatStreamEvent.Error }, events.toString())
            assertEquals(listOf("sk-old-model-key-123456789", fixture.key), fixture.chatKeys)
            assertEquals("account-access", fixture.tokens.accessToken)
            fixture.chat()
            assertEquals(listOf("sk-old-model-key-123456789", fixture.key, fixture.key), fixture.chatKeys)
            assertEquals(0, fixture.creates)
        }
    }
    @Test fun tokenManagementRenewsExpiredAccountEnvelopeBeforeReadingModelKey() = runBlocking {
        Fixture().use { fixture ->
            fixture.rejectAccount = true
            assertEquals(fixture.key, fixture.api.ensureApiKeyForGroup("B"))
            assertEquals("renewed-account", fixture.tokens.accessToken)
            assertEquals(1, fixture.refreshes)
            assertEquals(0, fixture.creates)
        }
    }
    @Test fun failedKeyLookupDoesNotSendAccountAccessTokenToModelOrCreateAnotherKey() = runBlocking {
        Fixture().use { fixture ->
            fixture.unavailable = true
            val events = fixture.chat()
            assertTrue(events.any { it is ChatStreamEvent.Error })
            assertTrue(fixture.chatKeys.isEmpty())
            assertEquals(0, fixture.creates)
            assertEquals("account-access", fixture.tokens.accessToken)
            fixture.unavailable = false
            assertTrue(fixture.chat().any { it is ChatStreamEvent.Done })
        }
    }
    @Test fun modelPermissionFailureDoesNotRefreshAccountOrRetryAnAcceptedResponse() = runBlocking {
        Fixture().use { fixture ->
            fixture.chatStatus = 403
            assertTrue(fixture.chat().any { it is ChatStreamEvent.Error })
            assertEquals(1, fixture.chatKeys.size)
            assertEquals(0, fixture.refreshes)
            assertEquals("account-access", fixture.tokens.accessToken)
        }
    }
    @Test fun changingAccountDuringKeyRecoveryCannotSendWithTheNewAccount() = runBlocking {
        Fixture().use { fixture ->
            val started = CompletableDeferred<Unit>()
            val release = java.util.concurrent.CountDownLatch(1)
            fixture.beforeList = { started.complete(Unit); release.await() }
            val pending = async { fixture.chat() }
            try {
                withTimeout(10_000) { started.await() }
                fixture.refresher.installSession("another-account", "another-cookie")
            } finally { release.countDown() }
            assertTrue(withTimeout(10_000) { pending.await() }.any { it is ChatStreamEvent.Error })
            assertTrue(fixture.chatKeys.isEmpty())
            assertEquals("another-account", fixture.tokens.accessToken)
        }
    }
    private class Fixture : AutoCloseable {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val tokens = InMemoryTokenStore("account-access", "session=valid-cookie")
        val preferences = AppPreferences(MapSettings())
        var key = "sk-old-model-key-123456789"
        var rejectAccount = false
        var unavailable = false
        var chatStatus = 200
        var beforeList: (() -> Unit)? = null
        var creates = 0
        var refreshes = 0
        val chatKeys = mutableListOf<String>()
        val config: Agent567Config
        val bare: io.ktor.client.HttpClient
        val client: io.ktor.client.HttpClient
        val refresher: TokenRefresher
        lateinit var api: Agent567Api
        init {
            server.createContext("/") { request ->
                val auth = request.requestHeaders.getFirst("Authorization").orEmpty().removePrefix("Bearer ")
                request.requestBody.close()
                if (request.requestURI.path == "/api/token/" && request.requestMethod == "GET") beforeList?.invoke()
                val (status, body) = when (request.requestURI.path) {
                    "/api/user/auth/refresh" -> {
                        refreshes++
                        200 to """{"success":true,"data":{"access_token":"renewed-account"}}"""
                    }
                    "/api/token/" -> when {
                        unavailable -> 503 to """{"success":false,"message":"unavailable"}"""
                        rejectAccount && auth != "renewed-account" -> 200 to """{"success":false,"message":"登录已过期，请重新登录"}"""
                        request.requestMethod == "POST" -> { creates++; 200 to """{"success":true}""" }
                        else -> 200 to """{"success":true,"data":[{"id":3,"status":1,"group":"B","key":"$key"}]}"""
                    }
                    "/v1/chat/completions" -> {
                        chatKeys.add(auth)
                        if (auth != key) 401 to """{"error":{"message":"Invalid token"}}"""
                        else if (chatStatus != 200) chatStatus to """{"error":{"message":"model permission denied"}}"""
                        else 200 to "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
                    }
                    else -> 404 to "{}"
                }
                val bytes = body.toByteArray()
                request.sendResponseHeaders(status, bytes.size.toLong())
                request.responseBody.use { it.write(bytes) }
            }
            server.start()
            config = Agent567Config("http://127.0.0.1:${server.address.port}")
            bare = createBareHttpClient(config)
            refresher = TokenRefresher(tokens, { api.refreshTokensWithAccountRecovery(it) }, null)
            client = createAgent567HttpClient(config, tokens, refresher)
            reopen()
        }
        fun reopen() { api = Agent567Api(client, bare, config, tokens, refresher, preferences) }
        suspend fun chat() = api.streamChat("test", listOf(ChatMessage(role = ChatRole.User, content = "hello")), groupName = "B").toList()
        override fun close() { client.close(); bare.close(); server.stop(0) }
    }
}
