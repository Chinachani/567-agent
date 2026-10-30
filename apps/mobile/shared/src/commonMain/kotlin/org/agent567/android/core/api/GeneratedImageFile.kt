package org.agent567.android.core.api

import kotlin.io.encoding.Base64
import org.agent567.android.core.model.MAX_IMAGE_PAYLOAD_BASE64_CHARS
import org.agent567.android.core.model.MAX_IMAGE_PAYLOAD_BYTES

internal data class GeneratedImageFile(val base64: String, val mimeType: String, val extension: String)

/** Validate bytes before persisting; an HTML error page must not become a broken PNG. */
internal suspend fun resolveGeneratedImage(result: GeneratedImageResult, download: suspend (String) -> ByteArray): GeneratedImageFile? {
    val bytes = if (!result.b64Json.isNullOrBlank()) {
        if (result.b64Json.length > MAX_IMAGE_PAYLOAD_BASE64_CHARS + 64) return null
        runCatching { Base64.decode(result.b64Json.substringAfter("base64,", result.b64Json).trim()) }.getOrNull() ?: return null
    } else result.url?.let { download(it) } ?: return null
    return generatedImageFile(bytes)
}

internal fun generatedImageFile(bytes: ByteArray): GeneratedImageFile? {
    if (bytes.size !in 12..MAX_IMAGE_PAYLOAD_BYTES) return null
    val signature = bytes.take(12).map { it.toInt() and 255 }
    val type = when {
        signature.take(8) == listOf(137, 80, 78, 71, 13, 10, 26, 10) -> "image/png" to "png"
        signature.take(3) == listOf(255, 216, 255) -> "image/jpeg" to "jpg"
        bytes.copyOfRange(0, 4).decodeToString() == "RIFF" && bytes.copyOfRange(8, 12).decodeToString() == "WEBP" -> "image/webp" to "webp"
        else -> return null
    }
    return GeneratedImageFile(Base64.encode(bytes), type.first, type.second)
}
