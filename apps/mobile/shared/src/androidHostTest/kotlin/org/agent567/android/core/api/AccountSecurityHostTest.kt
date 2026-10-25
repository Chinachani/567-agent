package org.agent567.android.core.api

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.net.*
import kotlin.test.*

class AccountSecurityHostTest {
    @Test fun nativePasswordAndEmailFlowsRequireConfirmationAndPreserveAccountFields() = runBlocking {
        var email = ""; var reject = false
        val writes = Collections.synchronizedList(mutableListOf<Pair<String, JsonObject>>())
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            val path = request.requestURI.path
            val body = when {
                request.requestMethod != "GET" -> {
                    val data = Agent567Json.parseToJsonElement(request.requestBody.readBytes().toString(Charsets.UTF_8)).jsonObject
                    writes += path to data
                    if (reject) """{"success":false,"message":"Invalid verification"}"""
                    else if (path == "/api/user/self") """{"success":true,"data":{"access_token":"renewed-access"}}"""
                    else { email = data["email"]!!.jsonPrimitive.content; """{"success":true}""" }
                }
                path == "/api/verification" -> """{"success":true}"""
                else -> """{"success":true,"data":{"id":7,"username":"login-name","display_name":"Display name","email":"$email","quota":500000}}"""
            }
            val bytes = body.toByteArray(); request.sendResponseHeaders(200, bytes.size.toLong()); request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val config = Agent567Config("http://127.0.0.1:${server.address.port}")
        val tokens = InMemoryTokenStore("initial-access", "session=refresh")
        val refresher = TokenRefresher(tokens, { error("Unexpected refresh") }, null)
        val bare = createBareHttpClient(config); val http = createAgent567HttpClient(config, tokens, refresher)
        val api = Agent567Api(http, bare, config, tokens, refresher)
        try {
            val user = api.me()
            api.updatePassword(user, "old-password", "new-password")
            assertEquals("renewed-access", tokens.accessToken)
            assertEquals("session=refresh", tokens.refreshToken)
            val passwordBody = writes.first().second
            assertEquals(setOf("username", "display_name", "password", "original_password"), passwordBody.keys)
            assertEquals("login-name", passwordBody["username"]!!.jsonPrimitive.content)
            assertEquals("Display name", passwordBody["display_name"]!!.jsonPrimitive.content)
            api.sendBindingEmailCode(user, "test@example.test")
            val saved = api.bindEmail(user, "test@example.test", "123456")
            assertEquals("test@example.test", saved.email)
            assertEquals(setOf("email", "code"), writes.last().second.keys)
            reject = true
            assertFails { api.bindEmail(user, "other@example.test", "bad-code") }
            assertEquals("test@example.test", api.me().email)
            val count = writes.size
            assertFails { api.updatePassword(user.copy(id = 99), "old-password", "new-password") }
            assertEquals(count, writes.size)
        } finally { http.close(); bare.close(); server.stop(0) }
    }

    @Test fun aLatePasswordResponseCannotRestoreCredentialsAfterLogout() = runBlocking {
        val received = CountDownLatch(1); val release = CountDownLatch(1)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            val body = if (request.requestMethod == "PUT") {
                request.requestBody.readBytes(); received.countDown(); release.await(10, TimeUnit.SECONDS)
                """{"success":true,"data":{"access_token":"must-not-return"}}"""
            } else """{"success":true,"data":{"id":7,"username":"test","display_name":"Test","quota":5}}"""
            val bytes = body.toByteArray(); request.sendResponseHeaders(200, bytes.size.toLong()); request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val config = Agent567Config("http://127.0.0.1:${server.address.port}")
        val tokens = InMemoryTokenStore("before", "refresh")
        val refresher = TokenRefresher(tokens, { error("Unexpected refresh") }, null)
        val bare = createBareHttpClient(config); val http = createAgent567HttpClient(config, tokens, refresher)
        val api = Agent567Api(http, bare, config, tokens, refresher)
        try {
            val user = api.me()
            val change = async(Dispatchers.IO) { runCatching { api.updatePassword(user, "old-password", "new-password") } }
            assertTrue(withContext(Dispatchers.IO) { received.await(5, TimeUnit.SECONDS) })
            refresher.clearSession(); release.countDown()
            assertTrue(change.await().isFailure)
            assertNull(tokens.accessToken)
        } finally { release.countDown(); http.close(); bare.close(); server.stop(0) }
    }
}
