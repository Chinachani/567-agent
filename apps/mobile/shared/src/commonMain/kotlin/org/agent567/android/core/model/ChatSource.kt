package org.agent567.android.core.model

import io.ktor.http.Url
import kotlinx.serialization.Serializable

/** Provider-supplied display metadata. Never inserted into request text. */
@Serializable
data class ChatSource(val url: String, val title: String? = null)

fun normalizeChatSources(raw: List<ChatSource>): List<ChatSource> {
    val result = linkedMapOf<String, ChatSource>()
    for (item in raw.take(128)) {
        val url = item.url
        if (url.length !in 1..2048 || url.any { it.isWhitespace() || it.isISOControl() || it == '\\' } ||
            !(url.startsWith("https://", true) || url.startsWith("http://", true))) continue
        val authority = url.substringAfter("://").takeWhile { it !in "/?#" }
        if (authority.isBlank() || '@' in authority) continue
        val parsed = runCatching { Url(url) }.getOrNull() ?: continue
        if (parsed.host.isBlank() || parsed.user != null || parsed.password != null || parsed.protocol.name !in setOf("http", "https")) continue
        val key = parsed.toString()
        if (key.length > 2048) continue
        val old = result[key]
        if (old == null && result.size >= 32) continue
        val title = item.title?.take(240)?.filterNot { it.isISOControl() || it in '\u202a'..'\u202e' || it in '\u2066'..'\u2069' }?.trim()?.ifEmpty { null }
        if (old == null || (old.title == null && title != null)) result[key] = ChatSource(key, title)
    }
    return result.values.toList()
}
