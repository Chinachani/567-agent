package org.agent567.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mikepenz.markdown.compose.components.markdownComponents
import com.mikepenz.markdown.compose.elements.MarkdownCodeBlock
import com.mikepenz.markdown.compose.elements.MarkdownCodeFence
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.rememberMarkdownState
import kotlinx.coroutines.delay
import org.agent567.android.ui.i18n.Str

/**
 * Shared Markdown boundary for assistant text and tool details.
 *
 * The renderer owns parsing and document structure. Agent567 owns only the Material 3 tokens and
 * code-fence chrome, keeping the message surface consistent with the rest of the app.
 */
@Composable
fun MarkdownContent(
    source: String,
    modifier: Modifier = Modifier,
    onSurface: Boolean = false,
) {
    val textColor = if (onSurface) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    val responsiveSource = remember(source) { renderResponsiveMarkdownTables(source) }
    val state = rememberMarkdownState(responsiveSource, retainState = true)
    val components = remember {
        markdownComponents(
            codeFence = { model ->
                MarkdownCodeFence(model.content, model.node, style = model.typography.code) { code, language, _ ->
                    CodeBlockChrome(language = language, code = code)
                }
            },
            codeBlock = { model ->
                MarkdownCodeBlock(model.content, model.node, style = model.typography.code) { code, language, _ ->
                    CodeBlockChrome(language = language, code = code)
                }
            },
        )
    }
    Markdown(
        markdownState = state,
        colors =
            markdownColor(
                text = textColor,
                codeBackground = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.82f),
                inlineCodeBackground = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.68f),
                dividerColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
            ),
        typography =
            markdownTypography(
                h1 = MaterialTheme.typography.headlineSmall,
                h2 = MaterialTheme.typography.titleLarge,
                h3 = MaterialTheme.typography.titleMedium,
                h4 = MaterialTheme.typography.titleSmall,
                h5 = MaterialTheme.typography.titleSmall,
                h6 = MaterialTheme.typography.labelLarge,
                text = MaterialTheme.typography.bodyLarge.copy(color = textColor),
                paragraph = MaterialTheme.typography.bodyLarge.copy(color = textColor),
                ordered = MaterialTheme.typography.bodyLarge.copy(color = textColor),
                bullet = MaterialTheme.typography.bodyLarge.copy(color = textColor),
                list = MaterialTheme.typography.bodyLarge.copy(color = textColor),
                code =
                    MaterialTheme.typography.bodyMedium.copy(
                        color = MaterialTheme.colorScheme.onSurface,
                        fontFamily = FontFamily.Monospace,
                    ),
                inlineCode =
                    MaterialTheme.typography.bodyMedium.copy(
                        color = textColor,
                        fontFamily = FontFamily.Monospace,
                    ),
                textLink =
                    TextLinkStyles(
                        style = SpanStyle(color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline),
                    ),
            ),
        components = components,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
fun CodeBlockChrome(
    language: String?,
    code: String,
    modifier: Modifier = Modifier,
) {
    @Suppress("DEPRECATION")
    val clipboard = LocalClipboardManager.current
    var copied by remember(code) { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1_600)
            copied = false
        }
    }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
        tonalElevation = 1.dp,
    ) {
        Column {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f))
                        .padding(horizontal = 10.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = language?.ifBlank { Str.code } ?: Str.code,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = {
                        clipboard.setText(AnnotatedString(code))
                        copied = true
                    },
                ) {
                    Icon(
                        imageVector = if (copied) Icons.Default.Check else Icons.Default.ContentCopy,
                        contentDescription = if (copied) Str.copied else Str.copy,
                    )
                }
            }
            SelectionContainer {
                Text(
                    text = code,
                    style =
                        MaterialTheme.typography.bodyMedium.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp,
                            lineHeight = 18.sp,
                        ),
                    modifier =
                        Modifier
                            .horizontalScroll(rememberScrollState())
                            .padding(12.dp),
                )
            }
        }
    }
}


/**
 * Tables are too wide for a phone message bubble. Render each row as a separate blockquote card,
 * with one hard line break per cell, so rows and values remain visually distinct on a narrow screen.
 */
private fun renderResponsiveMarkdownTables(source: String): String {
    val lines = source.lines()
    val output = mutableListOf<String>()
    var index = 0
    var fenceCharacter: Char? = null
    var fenceLength = 0

    while (index < lines.size) {
        val line = lines[index]
        val trimmed = line.trimStart()
        val activeFenceCharacter = fenceCharacter
        if (activeFenceCharacter != null && isMarkdownFenceClose(line, activeFenceCharacter, fenceLength)) {
            fenceCharacter = null
            fenceLength = 0
            output += line
            index += 1
            continue
        }
        val fence = if (fenceCharacter == null) markdownFence(line) else null
        if (fence != null) {
            fenceCharacter = fence.first
            fenceLength = fence.second
            output += line
            index += 1
            continue
        }

        if (fenceCharacter == null && leadingIndentColumns(line) < 4 && index + 1 < lines.size) {
            val headers = splitMarkdownTableRow(line)
            val separators = splitMarkdownTableRow(lines[index + 1])
            if (headers != null && separators != null && headers.size == separators.size && isMarkdownTableSeparator(separators)) {
                val tableStart = index
                val rows = mutableListOf<List<String>>()
                var malformedRow = false
                index += 2
                while (index < lines.size) {
                    val row = splitMarkdownTableRow(lines[index]) ?: break
                    if (row.size != headers.size) {
                        malformedRow = true
                        break
                    }
                    rows += row
                    index += 1
                }
                if (malformedRow) {
                    output += line
                    index = tableStart + 1
                    continue
                }

                val renderedRows = rows.mapIndexed { rowIndex, row ->
                    val cells = headers.indices.map { column ->
                        val label = headers[column].ifBlank { "列 ${column + 1}" }
                        val value = row.getOrNull(column).orEmpty()
                        "**$label：**${if (value.isBlank()) "" else " $value"}"
                    }
                    (listOf("**第 ${rowIndex + 1} 行**") + cells)
                        .joinToString("  \n") { "> $it" }
                }.ifEmpty {
                    listOf(
                        headers.mapIndexed { column, header ->
                            "**${header.ifBlank { "列 ${column + 1}" }}**"
                        }.joinToString("  \n") { "> $it" },
                    )
                }
                if (output.isNotEmpty() && output.last().isNotBlank()) output += ""
                output += renderedRows.joinToString("\n\n")
                if (index < lines.size && lines[index].isNotBlank()) output += ""
                continue
            }
        }

        output += line
        index += 1
    }
    return output.joinToString("\n")
}

private fun markdownFence(line: String): Pair<Char, Int>? {
    val trimmed = line.trimStart()
    if (leadingIndentColumns(line) > 3) return null
    val marker = trimmed.firstOrNull()?.takeIf { it == '`' || it == '~' } ?: return null
    val length = trimmed.takeWhile { it == marker }.length
    return if (length >= 3) marker to length else null
}

private fun isMarkdownFenceClose(line: String, marker: Char, minimumLength: Int): Boolean {
    if (leadingIndentColumns(line) > 3) return false
    val trimmed = line.trimStart()
    val runLength = trimmed.takeWhile { it == marker }.length
    return runLength >= minimumLength && trimmed.drop(runLength).all { it == ' ' || it == '\t' }
}

private fun leadingIndentColumns(line: String): Int {
    var columns = 0
    for (character in line) {
        when (character) {
            ' ' -> columns += 1
            '\t' -> return 4
            else -> return columns
        }
    }
    return columns
}

private fun splitMarkdownTableRow(line: String): List<String>? {
    val trimmed = line.trim()
    if ('|' !in trimmed || trimmed.startsWith('>')) return null

    val cells = mutableListOf<String>()
    val cell = StringBuilder()
    var escaped = false
    var codeTicks = 0
    var index = 0
    while (index < trimmed.length) {
        val character = trimmed[index]
        if (escaped) {
            cell.append(character)
            escaped = false
        } else if (character == '\\') {
            cell.append(character)
            escaped = true
        } else if (character == '`') {
            var tickCount = 1
            while (index + tickCount < trimmed.length && trimmed[index + tickCount] == '`') tickCount += 1
            repeat(tickCount) { cell.append('`') }
            codeTicks = if (codeTicks == 0) tickCount else if (codeTicks == tickCount) 0 else codeTicks
            index += tickCount - 1
        } else if (character == '|' && codeTicks == 0) {
            cells += cell.toString().trim()
            cell.clear()
        } else {
            cell.append(character)
        }
        index += 1
    }
    cells += cell.toString().trim()
    if (trimmed.startsWith('|') && cells.firstOrNull().isNullOrEmpty()) cells.removeAt(0)
    if (trimmed.endsWith('|') && cells.lastOrNull().isNullOrEmpty()) cells.removeAt(cells.lastIndex)
    return cells.takeIf { it.isNotEmpty() }
}

private fun isMarkdownTableSeparator(cells: List<String>): Boolean =
    cells.isNotEmpty() && cells.all { cell -> cell.matches(Regex(":?-{3,}:?")) }
