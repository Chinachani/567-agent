package org.agent567.android.core.updates

import io.ktor.http.Url
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal data class ReleaseApkAsset(val url: String, val name: String, val size: Long?, val sha256: String?)

/** Metadata stays on the official repository even when the user selects a download mirror. */
internal fun releaseApkAsset(assets: JsonArray?): ReleaseApkAsset? = assets?.firstNotNullOfOrNull { asset ->
    val json = asset as? JsonObject ?: return@firstNotNullOfOrNull null
    val name = (json["name"] as? JsonPrimitive)?.content ?: return@firstNotNullOfOrNull null
    if (!name.matches(Regex("567-agent-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk"))) return@firstNotNullOfOrNull null
    val url = (json["browser_download_url"] as? JsonPrimitive)?.content ?: return@firstNotNullOfOrNull null
    val parsed = runCatching { Url(url) }.getOrNull() ?: return@firstNotNullOfOrNull null
    if (parsed.protocol.name != "https" || parsed.host != "github.com" || parsed.user != null || parsed.password != null ||
        !parsed.encodedPath.startsWith("/Chinachani/567-agent/releases/download/") || '?' in url || '#' in url
    ) return@firstNotNullOfOrNull null
    val size = (json["size"] as? JsonPrimitive)?.content?.toLongOrNull()?.takeIf { it in 1..1024L * 1024 * 1024 }
    val digest = (json["digest"] as? JsonPrimitive)?.content
        ?.takeIf { it.matches(Regex("sha256:[0-9a-fA-F]{64}")) }?.substringAfter(':')
    ReleaseApkAsset(url, name, size, digest)
}
