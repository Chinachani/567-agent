package org.agent567.android.core.api

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.runBlocking
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.net.*
import kotlinx.serialization.json.*
import kotlin.test.*

class ProfileHostTest {
    @Test fun profileSavePreservesLoginUsernameAndRequiresServerConfirmation() = runBlocking {
        var name = "Original"; var reject = false; var accountId = 7; var updates = 0
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { req ->
            val body = if (req.requestMethod == "PUT") {
                updates++
                val data = Agent567Json.parseToJsonElement(req.requestBody.readBytes().toString(Charsets.UTF_8)).jsonObject
                assertEquals(setOf("username", "display_name"), data.keys)
                assertEquals("login-name", data["username"]!!.jsonPrimitive.content)
                assertTrue(req.requestHeaders.getFirst("Origin").startsWith("http://127.0.0.1:"))
                if (reject) """{"success":false,"message":"Not allowed"}"""
                else { name = data["display_name"]!!.jsonPrimitive.content; """{"success":true}""" }
            } else """{"success":true,"data":{"id":$accountId,"username":"login-name","display_name":"$name","quota":50}}"""
            val bytes = body.toByteArray(); req.sendResponseHeaders(200, bytes.size.toLong()); req.responseBody.use { it.write(bytes) }
        }
        server.start()
        val config = Agent567Config("http://127.0.0.1:${server.address.port}")
        val tokens = InMemoryTokenStore("account-token", "refresh")
        val bare = createBareHttpClient(config)
        val refresher = TokenRefresher(tokens, { error("Unexpected refresh") }, null)
        val client = createAgent567HttpClient(config, tokens, refresher)
        val api = Agent567Api(client, bare, config, tokens, refresher)
        try {
            val before = api.me()
            val saved = api.updateDisplayName(before.id, before.username, " New nickname ")
            assertEquals("New nickname", saved.nickname)
            assertEquals("New nickname", api.me().nickname)
            assertEquals(before.username, saved.username)
            reject = true
            assertFails { api.updateDisplayName(7, "login-name", "Rejected") }
            assertEquals("New nickname", api.me().nickname)
            accountId = 8
            assertFails { api.updateDisplayName(7, "login-name", "Wrong account") }
            assertEquals(2, updates)
            assertFails { api.updateDisplayName(8, "login-name", " ") }
            assertEquals("account-token", tokens.accessToken)
        } finally { client.close(); bare.close(); server.stop(0) }
    }
}
