package org.agent567.android.ui.chat

private val visibleConversationTags = setOf("output", "message")

/** Normalize CRLF/CR line endings from remote release notes so CommonMark blocks parse cleanly. */
internal fun normalizeReleaseNotesMarkdown(raw: String): String =
    raw.replace("\r\n", "\n").replace('\r', '\n').trim()

/**
 * The desktop conversation can intentionally show protocol wrappers such as `<output>`.
 * CommonMark treats those wrappers as raw HTML and removes them from the rendered text, so
 * escape only the known conversation tags while leaving code spans, fences and real links alone.
 */
internal fun escapeConversationTags(source: String): String {
    if (!source.contains("<output", ignoreCase = true) && !source.contains("<message", ignoreCase = true)) return source
    var index = 0
    var retainedFrom = 0
    var output: StringBuilder? = null
    while (index < source.length) {
        val marker = source[index]
        if (marker == '\\') {
            index += 2
            continue
        }
        if (marker == '`' || marker == '~') {
            index = skipMarkdownLiteral(source, index, marker)
            continue
        }
        if (marker != '<') {
            index++
            continue
        }
        val closing = source.indexOf('>', index + 1)
        if (closing < 0 || !isConversationTag(source, index + 1, closing)) {
            index++
            continue
        }
        val result = output ?: StringBuilder().also { output = it }
        result.append(source, retainedFrom, index).append('\\').append(source, index, closing + 1)
        retainedFrom = closing + 1
        index = closing + 1
    }
    return output?.append(source, retainedFrom, source.length)?.toString() ?: source
}

private fun isConversationTag(source: String, start: Int, end: Int): Boolean {
    var cursor = start
    while (cursor < end && source[cursor].isWhitespace()) cursor++
    if (cursor < end && source[cursor] == '/') cursor++
    val nameStart = cursor
    while (cursor < end && source[cursor].isLetter()) cursor++
    if (nameStart == cursor) return false
    val name = source.substring(nameStart, cursor).lowercase()
    while (cursor < end && source[cursor].isWhitespace()) cursor++
    if (cursor < end && source[cursor] == '/') cursor++
    while (cursor < end && source[cursor].isWhitespace()) cursor++
    return cursor == end && name in visibleConversationTags
}

private fun skipMarkdownLiteral(source: String, start: Int, marker: Char): Int {
    var cursor = start
    while (cursor < source.length && source[cursor] == marker) cursor++
    val size = cursor - start
    if (marker == '~' || size >= 3) {
        val lineStart = source.lastIndexOf('\n', start - 1) + 1
        if (start - lineStart <= 3 && source.substring(lineStart, start).all { it == ' ' }) {
            val close = findClosingFence(source, cursor, marker, size)
            if (close >= 0) return close
        }
    }
    if (marker == '`') {
        var close = source.indexOf('`', cursor)
        while (close >= 0) {
            var end = close + 1
            while (end < source.length && source[end] == marker) end++
            if (end - close == size) return end
            close = source.indexOf('`', end)
        }
    }
    return cursor
}

private fun findClosingFence(source: String, from: Int, marker: Char, size: Int): Int {
    var lineStart = source.indexOf('\n', from).let { if (it < 0) source.length else it + 1 }
    while (lineStart < source.length) {
        val lineEnd = source.indexOf('\n', lineStart).let { if (it < 0) source.length else it }
        var cursor = lineStart
        while (cursor < lineEnd && source[cursor] == ' ' && cursor - lineStart < 3) cursor++
        val markerStart = cursor
        while (cursor < lineEnd && source[cursor] == marker) cursor++
        if (cursor - markerStart >= size && source.substring(cursor, lineEnd).all { it == ' ' || it == '\t' || it == '\r' }) {
            return lineEnd
        }
        lineStart = if (lineEnd < source.length) lineEnd + 1 else source.length
    }
    return -1
}
