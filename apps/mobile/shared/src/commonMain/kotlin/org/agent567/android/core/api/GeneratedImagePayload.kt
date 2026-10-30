package org.agent567.android.core.api

import kotlinx.serialization.json.*
import org.agent567.android.core.net.Agent567Json

/** Only image-bearing protocol fields count as results; a prose download link is not image evidence. */
internal fun extractGeneratedImage(jsonText: String, prompt: String): GeneratedImageResult {
    val root = Agent567Json.parseToJsonElement(jsonText).jsonObject
    var url: String? = null
    var b64: String? = null
    val text = mutableListOf<String>()
    fun base64(value: String?) {
        if (url == null && b64 == null && !value.isNullOrBlank() && value != "null") b64 = value
    }
    fun image(value: String?) {
        if (value.isNullOrBlank() || value == "null" || url != null || b64 != null) return
        if (value.startsWith("data:image/") && ";base64," in value) {
            b64 = value.substringAfter(";base64,")
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
                if (imageField || it.startsWith("data:image/")) image(it) else {
                    text += it
                    Regex("""!\[[^\]]*\]\((https?://[^\s)]+|data:image/[^\s)]+)\)""").findAll(it).forEach { match -> image(match.groupValues[1]) }
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
    return GeneratedImageResult(url, b64, prompt, text.distinct().joinToString("\n").takeIf { it.isNotBlank() })
}
