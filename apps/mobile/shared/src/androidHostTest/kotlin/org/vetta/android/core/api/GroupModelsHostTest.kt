package org.vetta.android.core.api

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.runBlocking
import org.vetta.android.core.VettaConfig
import org.vetta.android.core.auth.InMemoryTokenStore
import org.vetta.android.core.net.RefreshOutcome
import org.vetta.android.core.net.TokenRefresher
import org.vetta.android.core.net.createBareHttpClient
import org.vetta.android.core.net.createVettaHttpClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GroupModelsHostTest {
    @Test
    fun testSilentTokenRefreshViaCookieOn401() = runBlocking {
        var refreshCalled = false
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            val auth = request.requestHeaders.getFirst("Authorization")
            val cookie = request.requestHeaders.getFirst("Cookie")
            val body = when {
                request.requestURI.path == "/api/user/models" && auth == "Bearer expired-token" -> {
                    """{"success":false,"message":"token expired"}"""
                }
                request.requestURI.path == "/api/user/auth/refresh" && cookie == "session=valid-cookie" -> {
                    refreshCalled = true
                    """{"success":true,"data":{"access_token":"fresh-new-token"}}"""
                }
                request.requestURI.path == "/api/user/models" && auth == "Bearer fresh-new-token" -> {
                    """{"success":true,"data":["refreshed-model-1","refreshed-model-2"]}"""
                }
                else -> """{"data":[]}"""
            }
            val status = if (body.contains("token expired")) 401 else 200
            val bytes = body.toByteArray()
            request.responseHeaders.add("Content-Type", "application/json")
            request.sendResponseHeaders(status, bytes.size.toLong())
            request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val config = VettaConfig("http://127.0.0.1:${server.address.port}")
        val tokens = InMemoryTokenStore("expired-token", "session=valid-cookie")
        val bare = createBareHttpClient(config)
        val client = createVettaHttpClient(config, tokens, TokenRefresher(tokens, { RefreshOutcome.Transient }, null))
        try {
            val api = VettaApi(client, bare, config, tokens)
            val catalog = api.goModels("B")
            assertTrue(refreshCalled, "Expected /api/user/auth/refresh to be called with session cookie")
            assertEquals(listOf("refreshed-model-1", "refreshed-model-2"), catalog.goModels().map { it.id })
            assertEquals("fresh-new-token", tokens.accessToken)
        } finally {
            client.close()
            bare.close()
            server.stop(0)
        }
    }

    @Test
    fun choosingGroupBDoesNotReuseGroupAToken() = runBlocking {
        val requests = java.util.concurrent.CopyOnWriteArrayList<String>()
        var createdGroupBToken = false
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            requests.add("${request.requestMethod} ${request.requestURI} ${request.requestHeaders.getFirst("Authorization")}")
            val body = when {
                request.requestURI.path == "/api/user/models" -> """{"data":[]}"""
                request.requestURI.path == "/api/token/" && request.requestMethod == "POST" -> {
                    createdGroupBToken = true
                    """{"success":true}"""
                }
                request.requestURI.path == "/api/token/" -> {
                    val groupB = if (createdGroupBToken) """,{"id":2,"group":"B","name":"567 Agent [B]","status":1,"key":"sk-bbbbbbbbbbbbbbbbbbbb"}""" else ""
                    """{"data":[{"id":1,"group":"A","name":"567 Agent [A]","status":1,"key":"sk-aaaaaaaaaaaaaaaaaaaa"}$groupB]}"""
                }
                request.requestURI.path == "/v1/models" && request.requestHeaders.getFirst("Authorization") == "Bearer sk-bbbbbbbbbbbbbbbbbbbb" -> """{"data":[{"id":"B-model"}]}"""
                else -> """{"error":"wrong group token"}"""
            }
            val status = if (body.contains("wrong group token")) 403 else 200
            val bytes = body.toByteArray()
            request.responseHeaders.add("Content-Type", "application/json")
            request.sendResponseHeaders(status, bytes.size.toLong())
            request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val config = VettaConfig("http://127.0.0.1:${server.address.port}")
        val tokens = InMemoryTokenStore("user-token", "user-token")
        val bare = createBareHttpClient(config)
        val client = createVettaHttpClient(config, tokens, TokenRefresher(tokens, { RefreshOutcome.Transient }, null))
        try {
            val catalog = VettaApi(client, bare, config, tokens).goModels("B")
            assertTrue(createdGroupBToken)
            assertEquals(listOf("B-model"), catalog.goModels().map { it.id }, requests.toString())
        } finally {
            client.close()
            bare.close()
            server.stop(0)
        }
    }

    @Test
    fun modelCatalogRecoversOnRetryAfterTemporaryFailure() = runBlocking {
        var requests = 0
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            val body = when (request.requestURI.path) {
                "/api/user/models" -> {
                    requests++
                    if (requests == 1) """{"error":"temporarily unavailable"}""" else """{"data":["restored-model"]}"""
                }
                "/v1/models" -> """{"error":"temporarily unavailable"}"""
                else -> """{"data":[]}"""
            }
            val status = if (body.contains("temporarily unavailable")) 503 else 200
            val bytes = body.toByteArray()
            request.responseHeaders.add("Content-Type", "application/json")
            request.sendResponseHeaders(status, bytes.size.toLong())
            request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val config = VettaConfig("http://127.0.0.1:${server.address.port}")
        val tokens = InMemoryTokenStore("sk-test-token", "sk-test-token")
        val bare = createBareHttpClient(config)
        val client = createVettaHttpClient(config, tokens, TokenRefresher(tokens, { RefreshOutcome.Transient }, null))
        try {
            val api = VettaApi(client, bare, config, tokens)
            assertTrue(api.goModels().goModels().isEmpty(), "On temporary 503 error, models should be empty rather than fake fallback models")
            assertEquals(listOf("restored-model"), api.goModels().goModels().map { it.id })
        } finally {
            client.close()
            bare.close()
            server.stop(0)
        }
    }
}
