package org.agent567.android.core.api

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.spec.MGF1ParameterSpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.agent567.android.core.Agent567Client
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.net.Agent567Json
import kotlin.test.*

class PasswordLoginHostTest {
    @Test fun cookieOnlyLoginUsesApiOriginForAccessTokenExchange() = runBlocking {
        var receivedOrigin: String? = null
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            val body = when {
                request.requestURI.path.endsWith("/encryption-key") -> """{"success":true,"data":{"enabled":false}}"""
                request.requestURI.path.endsWith("/refresh") -> {
                    receivedOrigin = request.requestHeaders.getFirst("Origin")
                    """{"success":true,"data":{"access_token":"cookie-exchange-token"}}"""
                }
                else -> {
                    request.responseHeaders.add("Set-Cookie", "session=login-cookie; HttpOnly")
                    """{"success":true,"data":{"id":7,"username":"test"}}"""
                }
            }
            val bytes = body.toByteArray()
            request.responseHeaders.add("Content-Type", "application/json")
            request.sendResponseHeaders(200, bytes.size.toLong())
            request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val origin = "http://127.0.0.1:${server.address.port}"
        val client = Agent567Client.create(Agent567Config("$origin/prefix"), InMemoryTokenStore())
        try {
            assertEquals("cookie-exchange-token", client.auth.loginWithEmailPassword("test", "password").accessToken)
            assertEquals(origin, receivedOrigin)
        } finally { client.close(); server.stop(0) }
    }

    @Test fun encryptedAndLegacyLoginWorkButHandshakeFailuresNeverPostThePassword() = runBlocking {
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val kid = MessageDigest.getInstance("SHA-256").digest(pair.public.encoded).take(16).joinToString("") { "%02x".format(it.toInt() and 255) }
        val pem = "-----BEGIN PUBLIC KEY-----\n${Base64.getMimeEncoder(64, byteArrayOf(10)).encodeToString(pair.public.encoded)}\n-----END PUBLIC KEY-----\n"
        var mode = "encrypted"
        var loginCount = 0
        var received: JsonObject? = null
        val password = "测试长密码🔑".repeat(30)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            val isKey = request.requestURI.path.endsWith("/encryption-key")
            val body = if (isKey) {
                buildJsonObject { put("success", true); put("data", buildJsonObject {
                    put("enabled", mode == "encrypted" || mode == "invalid"); put("kid", if (mode == "invalid") "0".repeat(32) else kid); put("public_key", pem)
                }) }.toString()
            } else {
                loginCount++
                received = Agent567Json.parseToJsonElement(request.requestBody.bufferedReader().readText()).jsonObject
                if (mode == "nested") """{"success":true,"data":{"access_token":"isolated-account-token","user":{"id":7,"username":"test","display_name":"Nested profile","email":"user@example.test"}}}"""
                else """{"success":true,"data":{"access_token":"isolated-account-token","id":7,"username":"test"}}"""
            }
            val bytes = body.toByteArray()
            request.responseHeaders.add("Content-Type", "application/json")
            request.sendResponseHeaders(if (isKey && mode == "old") 404 else if (isKey && mode == "error") 503 else 200, bytes.size.toLong())
            request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val client = Agent567Client.create(Agent567Config("http://127.0.0.1:${server.address.port}"), InMemoryTokenStore())
        try {
            assertEquals("isolated-account-token", client.auth.loginWithEmailPassword("test", password).accessToken)
            val payload = assertNotNull(received)
            assertTrue(payload["password"] == null || payload["password"] == JsonNull)
            val parts = payload["password_encrypted"]!!.jsonPrimitive.content.split('.')
            val rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
            rsa.init(Cipher.DECRYPT_MODE, pair.private, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified("password-v2".toByteArray())))
            val key = rsa.doFinal(Base64.getDecoder().decode(parts[1]))
            val aes = Cipher.getInstance("AES/GCM/NoPadding")
            aes.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, Base64.getDecoder().decode(parts[2])))
            aes.updateAAD("password-v2:$kid".toByteArray())
            assertEquals(password, aes.doFinal(Base64.getDecoder().decode(parts[3])).toString(Charsets.UTF_8))
            assertEquals(kid, payload["encryption_key_id"]!!.jsonPrimitive.content)
            for (legacy in listOf("disabled", "old")) {
                mode = legacy
                client.auth.loginWithEmailPassword("test", password)
                assertEquals(password, received?.get("password")?.jsonPrimitive?.content)
            }
            for (invalid in listOf("error", "invalid")) {
                mode = invalid
                val before = loginCount
                assertFails { client.auth.loginWithEmailPassword("test", password) }
                assertEquals(before, loginCount)
                assertEquals("isolated-account-token", client.tokenStore.accessToken)
            }
            mode = "nested"
            val nested = client.auth.loginWithEmailPassword("test", password)
            assertEquals(7L, nested.user.id)
            assertEquals("Nested profile", nested.user.nickname)
            assertEquals("user@example.test", nested.user.email)
        } finally { client.close(); server.stop(0) }
    }
}
