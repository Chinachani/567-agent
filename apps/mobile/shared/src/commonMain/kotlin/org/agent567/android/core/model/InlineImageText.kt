package org.agent567.android.core.model

/**
 * Image bytes belong to image attachments, not text layout or the next text prompt.
 * Keep the stored source intact and tolerate an unfinished data URL in legacy/streaming text.
 */
internal fun withoutInlineImageData(source: String): String {
    if (!source.contains("data:image/", ignoreCase = true)) return source
    var index = 0
    var retainedFrom = 0
    var output: StringBuilder? = null
    while (index < source.length) {
        val character = source[index]
        if (character == '\\') {
            index += 2
            continue
        }
        if (character == '`' || character == '~') {
            val start = index
            while (index < source.length && source[index] == character) index++
            val size = index - start
            val lineStart = source.lastIndexOf('\n', start - 1) + 1
            val lineEnd = source.indexOf('\n', index).let { if (it < 0) source.length else it }
            val fenced = size >= 3 && start - lineStart <= 3 && source.substring(lineStart, start).all { it == ' ' } &&
                (character != '`' || !source.substring(index, lineEnd).contains('`'))
            if (fenced) {
                val close = closingFenceEnd(source, lineEnd, character, size)
                if (close < 0) break
                index = close
            } else if (character == '`') {
                val close = closingCodeSpanEnd(source, index, size)
                if (close >= 0) index = close
            }
            continue
        }
        if (!source.regionMatches(index, "data:image/", 0, 11, ignoreCase = true)) {
            index++
            continue
        }
        var target = index - 1
        if (source.getOrNull(target) == '<') target--
        while (target >= 0 && source[target].isWhitespace()) target--
        if (source.getOrNull(target) != '(' || source.getOrNull(target - 1) != ']') {
            index++
            continue
        }
        var label = target - 2
        var depth = 1
        val limit = (label - 4096).coerceAtLeast(0)
        while (label >= limit) {
            if (source[label] == ']' && !isEscaped(source, label)) depth++
            if (source[label] == '[' && !isEscaped(source, label)) {
                depth--
                if (depth == 0) break
            }
            label--
        }
        if (depth != 0 || label - 1 < retainedFrom || source.getOrNull(label - 1) != '!' || isEscaped(source, label - 1)) {
            index++
            continue
        }
        val headerEnd = minOf(index + 128, source.length)
        if (!imageDataHeader.containsMatchIn(source.substring(index, headerEnd))) {
            index++
            continue
        }
        val closing = source.indexOf(')', index)
        val end = if (closing < 0) source.length else closing + 1
        val result = output ?: StringBuilder().also { output = it }
        result.append(source, retainedFrom, label - 1)
        retainedFrom = end
        index = end
    }
    return output?.append(source, retainedFrom, source.length)?.toString() ?: source
}

private val imageDataHeader = Regex("^data:image/[A-Za-z0-9.+-]{1,64};base64,", RegexOption.IGNORE_CASE)

private fun closingFenceEnd(source: String, openingLineEnd: Int, marker: Char, size: Int): Int {
    var lineStart = openingLineEnd + 1
    while (lineStart < source.length) {
        val lineEnd = source.indexOf('\n', lineStart).let { if (it < 0) source.length else it }
        var start = lineStart
        while (start < lineEnd && source[start] == ' ' && start - lineStart < 3) start++
        var end = start
        while (end < lineEnd && source[end] == marker) end++
        if (end - start >= size && (end until lineEnd).all { source[it] in " \t\r" }) return lineEnd
        lineStart = lineEnd + 1
    }
    return -1
}

private fun closingCodeSpanEnd(source: String, from: Int, size: Int): Int {
    var start = source.indexOf('`', from)
    while (start >= 0) {
        var end = start + 1
        while (end < source.length && source[end] == '`') end++
        if (end - start == size) return end
        start = source.indexOf('`', end)
    }
    return -1
}

private fun isEscaped(source: String, index: Int): Boolean {
    var position = index - 1
    while (position >= 0 && source[position] == '\\') position--
    return (index - 1 - position) % 2 != 0
}
