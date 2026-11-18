package org.agent567.android.core.chat

import kotlinx.serialization.json.*
import org.agent567.android.core.model.ChatSource
import org.agent567.android.core.model.normalizeChatSources

/** Completions nests url_citation fields; Responses places them on the annotation itself. */
internal fun providerSources(raw: JsonElement?, nested: Boolean): List<ChatSource> {
    val annotations = raw as? JsonArray ?: return emptyList()
    fun JsonObject.text(key: String) = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    return normalizeChatSources(annotations.take(96).mapNotNull {
        val item = it as? JsonObject ?: return@mapNotNull null
        if (item.text("type") != "url_citation") return@mapNotNull null
        val citation = if (nested) item["url_citation"] as? JsonObject ?: return@mapNotNull null else item
        ChatSource(citation.text("url") ?: return@mapNotNull null, citation.text("title"))
    })
}
