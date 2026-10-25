package org.agent567.android.core.net

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.runBlocking
import org.agent567.android.core.Agent567Config
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ServiceRouteProbeHostTest {
    @Test fun checksAreAnonymousUnlessValidatingAnAccountAndRejectRedirectsAndOversizedBodies(): Unit = runBlocking {
        val requests = mutableListOf<Pair<String, String?>>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        var mode = "normal"
        var bodyOverride: String? = null
        server.createContext("/") { request ->
            requests.add(request.requestURI.path to request.requestHeaders.getFirst("Authorization"))
            val body = if (mode == "large") " ".repeat(128 * 1024 + 1) else bodyOverride ?: """{"success":true,"data":{}}"""
            if (mode == "redirect") request.responseHeaders.add("Location", "/moved")
            val payload = body.toByteArray()
            request.sendResponseHeaders(if (mode == "redirect") 302 else 200, payload.size.toLong())
            runCatching { request.responseBody.use { it.write(payload) } }
        }
        server.start()
        val origin = "http://127.0.0.1:${server.address.port}"
        val client = createBareHttpClient(Agent567Config(origin), allowRedirects = false)
        try {
            val probe = ServiceRouteProbe()
            assertTrue(probe.checkResponse(client, origin, null))
            assertEquals("/api/status" to null, requests.last())
            assertTrue(probe.checkResponse(client, origin, "account-token"))
            assertEquals("/api/user/self" to "Bearer account-token", requests.last())
            bodyOverride = """{"success":true,"data":{"api_info_enabled":true,"api_info":[{"url":"https://node3.567.wiki","route":"节点三"}]}}"""
            assertEquals("https://node3.567.wiki", probe.discoverResponse(client, origin).single().origin)
            assertEquals("/api/status" to null, requests.last())
            mode = "redirect"
            assertFalse(probe.checkResponse(client, origin, "account-token"))
            kotlin.test.assertFailsWith<IllegalStateException> { probe.discoverResponse(client, origin) }
            assertEquals(0, requests.count { it.first == "/moved" })
            mode = "large"
            assertFalse(probe.checkResponse(client, origin, null))
            kotlin.test.assertFailsWith<IllegalStateException> { probe.discoverResponse(client, origin) }
        } finally { client.close(); server.stop(0) }
    }
}
