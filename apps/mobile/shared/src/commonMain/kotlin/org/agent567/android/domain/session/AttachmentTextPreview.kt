package org.agent567.android.domain.session

/** Bounded, inert source text. Binary Office/PDF/image payloads are never shown as text. */
internal fun attachmentTextPreview(bytes: ByteArray): String? {
    val prefix = bytes.take(8).map { (it.toInt() and 255).toChar() }.joinToString("")
    if (listOf("%PDF-", "PK\u0003\u0004", "\u00d0\u00cf\u0011\u00e0", "\u0089PNG", "GIF8", "\u00ff\u00d8\u00ff", "RIFF", "{\\rtf").any(prefix::startsWith)) return null
    val end = minOf(bytes.size, 32768)
    val little = bytes.size >= 2 && bytes[0] == 0xff.toByte() && bytes[1] == 0xfe.toByte()
    val big = bytes.size >= 2 && bytes[0] == 0xfe.toByte() && bytes[1] == 0xff.toByte()
    val text = if (little || big) {
        if (bytes.size == end && end % 2 != 0) return null
        buildString {
            for (i in 2 until (end - 1) step 2) {
                val a = bytes[i].toInt() and 255
                val b = bytes[i + 1].toInt() and 255
                append((if (little) a or (b shl 8) else (a shl 8) or b).toChar())
            }
        }.let { if (bytes.size > end && it.lastOrNull()?.isHighSurrogate() == true) it.dropLast(1) else it }
    } else {
        var decoded: String? = null
        for (trim in 0..if (bytes.size > end) minOf(3, end) else 0) {
            decoded = runCatching { bytes.decodeToString(0, end - trim, throwOnInvalidSequence = true) }.getOrNull()
            if (decoded != null) break
        }
        decoded?.removePrefix("\uFEFF") ?: return null
    }
    if (text.any { it.code in 0..8 || it.code == 11 || it.code in 14..31 || it.code == 127 }) return null
    for (i in text.indices) {
        if (text[i].isHighSurrogate() && (i == text.lastIndex || !text[i + 1].isLowSurrogate())) return null
        if (text[i].isLowSurrogate() && (i == 0 || !text[i - 1].isHighSurrogate())) return null
    }
    return text
}
