package org.agent567.android.core.api

import kotlin.io.encoding.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.agent567.android.core.model.MAX_IMAGE_PAYLOAD_BASE64_CHARS
import org.agent567.android.core.model.MAX_IMAGE_PAYLOAD_BYTES

internal data class GeneratedImageFile(val base64: String, val mimeType: String, val extension: String)

/** Validate bytes before persisting; an HTML error page must not become a broken PNG. */
internal suspend fun resolveGeneratedImage(result: GeneratedImageResult, download: suspend (String) -> ByteArray): GeneratedImageFile? = withContext(Dispatchers.Default) {
    val bytes = if (!result.b64Json.isNullOrBlank()) {
        val raw = result.b64Json
        if (raw.length > MAX_IMAGE_PAYLOAD_BASE64_CHARS * 2 + 128) return@withContext null
        val headerEnd = if (raw.startsWith("data:image/", ignoreCase = true)) raw.indexOf(";base64,", ignoreCase = true) else -1
        val encoded = StringBuilder(minOf(raw.length, MAX_IMAGE_PAYLOAD_BASE64_CHARS))
        for (index in (if (headerEnd >= 0) headerEnd + 8 else 0) until raw.length) {
            val character = raw[index]
            if (character in " \r\n\t") continue
            if (encoded.length >= MAX_IMAGE_PAYLOAD_BASE64_CHARS) return@withContext null
            encoded.append(when (character) { '-' -> '+'; '_' -> '/'; else -> character })
        }
        runCatching { Base64.decode(encoded.toString()) }.getOrNull() ?: return@withContext null
    } else result.url?.let { download(it) } ?: return@withContext null
    generatedImageFile(bytes)
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
