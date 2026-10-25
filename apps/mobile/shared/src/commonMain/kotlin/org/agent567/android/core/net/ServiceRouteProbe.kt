package org.agent567.android.core.net

import io.ktor.client.HttpClient
import io.ktor.client.plugins.timeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.ServiceRoute
import org.agent567.android.core.parseServiceRoutes
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.JsonArray

/** Anonymous probe and a read-only account check; redirects never receive credentials. */
class ServiceRouteProbe {
    suspend fun discover(): List<ServiceRoute> {
        val client = createBareHttpClient(Agent567Config(ServiceRoute.Germany.origin), allowRedirects = false)
        return try { discoverResponse(client, ServiceRoute.Germany.origin) } finally { client.close() }
    }

    internal suspend fun discoverResponse(client: HttpClient, origin: String): List<ServiceRoute> {
        val root = readResponse(client, origin, null) ?: error("Service discovery failed")
        val data = root["data"] as? JsonObject ?: error("Invalid discovery response")
        require((data["api_info_enabled"] as? kotlinx.serialization.json.JsonPrimitive)?.booleanOrNull != false)
        return parseServiceRoutes(data["api_info"] as? JsonArray)
    }
    suspend fun check(route: ServiceRoute, accessToken: String? = null): Boolean {
        val client = createBareHttpClient(Agent567Config(route.origin), allowRedirects = false)
        return try {
            checkResponse(client, route.origin, accessToken)
        } finally { client.close() }
    }

    internal suspend fun checkResponse(client: HttpClient, origin: String, accessToken: String?): Boolean = readResponse(client, origin, accessToken) != null

    private suspend fun readResponse(client: HttpClient, origin: String, accessToken: String?): JsonObject? = withTimeout(8_000) {
        val response = client.get(origin + if (accessToken == null) "/api/status" else "/api/user/self") {
            if (accessToken != null) header(HttpHeaders.Authorization, "Bearer $accessToken")
            timeout { requestTimeoutMillis = 8_000; connectTimeoutMillis = 5_000; socketTimeoutMillis = 5_000 }
        }
        if (response.status.value != 200) { response.bodyAsChannel().cancel(null); return@withTimeout null }
        val channel = response.bodyAsChannel()
        val bytes = ByteArray(128 * 1024 + 1)
        var length = 0
        while (length < bytes.size) {
            val count = channel.readAvailable(bytes, length, bytes.size - length)
            if (count == -1) break
            length += count
        }
        if (length == bytes.size) { channel.cancel(null); return@withTimeout null }
        val root = Agent567Json.parseToJsonElement(bytes.decodeToString(0, length)) as? JsonObject
        root?.takeIf { (it["success"] as? kotlinx.serialization.json.JsonPrimitive)?.booleanOrNull == true }
    }
}
