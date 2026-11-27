package org.agent567.android.core.model

internal enum class GroupModelKind {
    Conversation,
    ImageOnly,
    ConversationAndImage,
}

private val imageModelFamilies = listOf(
    "gpt-image", "dall-e", "dalle", "flux", "sdxl", "stable-diffusion", "imagen", "ideogram", "recraft",
    "midjourney", "seedream", "nano-banana", "qwen-image", "doubao-seedream",
)
private val nonDrawingNameMarkers = listOf("ocr", "vision", "embedding", "video", "caption", "image-to-text")

internal fun groupModelKind(id: String): GroupModelKind {
    val key = id.substringAfterLast('/').lowercase()
    val outputs = (bundledModelContexts[id] ?: bundledModelContexts[key])?.capabilities?.output
    if (!outputs.isNullOrEmpty()) {
        if (outputs.none { it.equals("image", ignoreCase = true) }) return GroupModelKind.Conversation
        return if (outputs.any { it.equals("text", ignoreCase = true) }) GroupModelKind.ConversationAndImage
        else GroupModelKind.ImageOnly
    }
    if (nonDrawingNameMarkers.any { it in key }) return GroupModelKind.Conversation
    val isDrawingFamily = imageModelFamilies.any { name -> key == name || key.startsWith("$name-") || key.startsWith("$name.") }
    val isGeminiImage = key.startsWith("gemini-") && "image" in key.split('-')
    return if (isDrawingFamily || isGeminiImage || "text-to-image" in key) GroupModelKind.ImageOnly else GroupModelKind.Conversation
}
