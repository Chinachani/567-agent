package org.agent567.android.core.api

import kotlinx.serialization.json.*
import org.agent567.android.core.net.Agent567Json
import org.agent567.android.core.model.withoutInlineImageData
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMFlavourDescriptor
import org.intellij.markdown.parser.MarkdownParser

/** Only image-bearing protocol fields count as results; a prose download link is not image evidence. */
internal fun extractGeneratedImage(jsonText: String, prompt: String): GeneratedImageResult {
    val root = Agent567Json.parseToJsonElement(jsonText).jsonObject
    var url: String? = null
    var b64: String? = null
    val text = linkedMapOf<String, List<MarkdownImage>>()
    fun base64(value: String?) {
        if (url == null && b64 == null && !value.isNullOrBlank() && value != "null") b64 = value
    }
    fun image(value: String?) {
        if (value.isNullOrBlank() || value == "null" || url != null || b64 != null) return
        val dataStart = value.indexOf(";base64,", ignoreCase = true)
        if (value.startsWith("data:image/", ignoreCase = true) && dataStart >= 0) {
            b64 = value.substring(dataStart + 8)
        } else if (value.startsWith("https://") || value.startsWith("http://")) {
            val parsed = runCatching { java.net.URI(value) }.getOrNull()
            if (parsed?.host != null && parsed.userInfo == null) url = value
        }
    }
    fun parts(value: JsonElement?, imageField: Boolean = false) {
        when (value) {
            is JsonArray -> value.forEach { parts(it, imageField) }
            is JsonObject -> {
                for (key in listOf("b64_json", "b64", "image_base64")) base64((value[key] as? JsonPrimitive)?.contentOrNull)
                val inline = value["inlineData"] as? JsonObject ?: value["inline_data"] as? JsonObject
                base64((inline?.get("data") as? JsonPrimitive)?.contentOrNull)
                image((value["url"] as? JsonPrimitive)?.contentOrNull)
                val imageUrl = value["image_url"]
                image((imageUrl as? JsonPrimitive)?.contentOrNull ?: ((imageUrl as? JsonObject)?.get("url") as? JsonPrimitive)?.contentOrNull)
                (value["text"] as? JsonPrimitive)?.contentOrNull?.let { parts(JsonPrimitive(it)) }
            }
            is JsonPrimitive -> value.contentOrNull?.takeIf { it.isNotBlank() && it != "null" }?.let {
                if (imageField || it.startsWith("data:image/", ignoreCase = true)) image(it) else {
                    val images = markdownImages(it)
                    text[it] = images
                    images.forEach { candidate -> image(candidate.destination) }
                }
            }
            else -> Unit
        }
    }
    parts(root["data"], imageField = true)
    (root["choices"] as? JsonArray)?.forEach { choice ->
        val message = (choice as? JsonObject)?.get("message") as? JsonObject
        parts(message?.get("content")); parts(message?.get("images"), imageField = true)
    }
    (root["candidates"] as? JsonArray)?.forEach { candidate ->
        parts(((candidate as? JsonObject)?.get("content") as? JsonObject)?.get("parts"))
    }
    val description = text.entries.joinToString("\n") { (source, images) ->
        // Match parsed image nodes, so an identical URL inside code remains untouched.
        val attached = images.filter { it.destination == url || it.destination.startsWith("data:image/", ignoreCase = true) }
        val retained = if (attached.isEmpty()) source else buildString {
            var start = 0
            for (image in attached) {
                append(source, start, image.start)
                start = image.end
            }
            append(source, start, source.length)
        }
        withoutInlineImageData(retained)
    }.trim().takeIf { it.isNotBlank() }
    return GeneratedImageResult(url, b64, prompt, description)
}

private data class MarkdownImage(val destination: String, val start: Int, val end: Int)

private fun markdownImages(source: String): List<MarkdownImage> {
    if (!source.contains("![")) return emptyList()
    val pending = ArrayDeque<ASTNode>()
    pending.add(MarkdownParser(GFMFlavourDescriptor()).buildMarkdownTreeFromString(source))
    val result = mutableListOf<MarkdownImage>()
    while (pending.isNotEmpty()) {
        val node = pending.removeLast()
        if (node.type == MarkdownElementTypes.IMAGE) {
            val link = node.children.firstOrNull { it.type == MarkdownElementTypes.INLINE_LINK }
            // GFM 0.7 represents an angled target as AUTOLINK and may label its title
            // LINK_DESTINATION. Only the first direct target counts, never an alt-text link.
            val destination = link?.children?.firstOrNull {
                it.type == MarkdownElementTypes.LINK_DESTINATION || it.type == MarkdownElementTypes.AUTOLINK
            }
            if (destination != null) result += MarkdownImage(source.substring(destination.startOffset, destination.endOffset).removeSurrounding("<", ">"), node.startOffset, node.endOffset)
        } else node.children.asReversed().forEach(pending::add)
    }
    return result
}
