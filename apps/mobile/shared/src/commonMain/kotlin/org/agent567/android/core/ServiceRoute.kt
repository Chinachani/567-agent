package org.agent567.android.core

import io.ktor.http.Url
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class ServiceRoute(val origin: String, val name: String? = null, val description: String? = null) {
    // Display text may change after a refresh; request identity stays the exact origin.
    override fun equals(other: Any?): Boolean = other is ServiceRoute && origin == other.origin
    override fun hashCode(): Int = origin.hashCode()
    companion object {
        val Mainland = ServiceRoute("https://a.567.wiki")
        val Germany = ServiceRoute("https://api.567.wiki")
        val entries = listOf(Mainland, Germany)
        fun fromServer(server: String, routes: List<ServiceRoute> = entries): ServiceRoute? = runCatching {
            val url = Url(server.trim())
            if (url.user != null || url.password != null || url.parameters.names().isNotEmpty() || url.fragment.isNotEmpty()) return null
            if (url.encodedPath.trimEnd('/') !in listOf("", "/v1", "/api/v1")) return null
            routes.firstOrNull { url.protocol.name == "https" && url.port == 443 && url.host == Url(it.origin).host }
        }.getOrNull()
    }
}

@Serializable
data class ServiceRouteCatalog(val routes: List<ServiceRoute> = ServiceRoute.entries, val updatedAt: Long? = null, val source: String = "builtin", val refreshFailed: Boolean = false)

fun normalizeServiceOrigin(value: String): String? = runCatching {
    if (value.length > 500) return null
    val url = Url(value)
    if (url.protocol.name != "https" || url.port != 443 || url.user != null || url.password != null || url.parameters.names().isNotEmpty() || url.fragment.isNotEmpty()) return null
    if (url.encodedPath.trimEnd('/') !in listOf("", "/v1", "/api/v1")) return null
    if (!url.host.matches(Regex("[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\\.[a-z]{2,}", RegexOption.IGNORE_CASE)) || url.host.contains(Regex("(?:^|\\.)(?:localhost|local|internal|invalid)$", RegexOption.IGNORE_CASE))) return null
    "https://${url.host.lowercase()}"
}.getOrNull()

fun parseServiceRoutes(value: JsonElement?): List<ServiceRoute> {
    val array = value as? JsonArray ?: error("Invalid service route list")
    require(array.size <= 50) { "Service route list too large" }
    val seen = mutableSetOf<String>()
    val routes = array.mapNotNull { element ->
        val item = element as? JsonObject ?: return@mapNotNull null
        val raw = (item["url"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
        val origin = normalizeServiceOrigin(raw) ?: return@mapNotNull null
        if (!seen.add(origin)) return@mapNotNull null
        fun text(key: String, limit: Int) = (item[key] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.take(limit)?.takeIf { it.isNotEmpty() }
        ServiceRoute(origin, text("route", 100), text("description", 200))
    }
    require(routes.isNotEmpty()) { "Service route list is empty" }
    return routes
}

/** Only origins explicitly discovered from the bootstrap share the account namespace. */
fun serviceIdentity(server: String, routes: List<ServiceRoute> = ServiceRoute.entries): String =
    if (ServiceRoute.fromServer(server, routes) != null) ServiceRoute.Germany.origin else server.trim().trimEnd('/')

data class ServiceRouteResult(val route: ServiceRoute, val ok: Boolean, val elapsedMs: Long? = null, val error: String? = null)
