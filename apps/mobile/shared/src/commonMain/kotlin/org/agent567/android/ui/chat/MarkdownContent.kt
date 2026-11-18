package org.agent567.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.times
import com.mikepenz.markdown.compose.LocalMarkdownColors
import com.mikepenz.markdown.compose.LocalMarkdownDimens
import com.mikepenz.markdown.compose.components.MarkdownComponentModel
import com.mikepenz.markdown.compose.components.markdownComponents
import com.mikepenz.markdown.compose.elements.MarkdownBulletList
import com.mikepenz.markdown.compose.elements.MarkdownCodeBlock
import com.mikepenz.markdown.compose.elements.MarkdownCodeFence
import com.mikepenz.markdown.compose.elements.MarkdownDivider
import com.mikepenz.markdown.compose.elements.MarkdownTable
import com.mikepenz.markdown.compose.elements.MarkdownTableHeader
import com.mikepenz.markdown.compose.elements.MarkdownTableRow
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.markdownDimens
import com.mikepenz.markdown.model.rememberMarkdownState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.conflate
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameNanos
import kotlin.time.TimeSource
import androidx.compose.runtime.snapshotFlow
import org.agent567.android.ui.i18n.Str
import org.agent567.android.core.model.withoutInlineImageData
import org.intellij.markdown.ast.findChildOfType
import org.intellij.markdown.flavours.gfm.GFMElementTypes.HEADER
import org.intellij.markdown.flavours.gfm.GFMTokenTypes.CELL

/**
 * Shared Markdown boundary for assistant text and tool details.
 *
 * The renderer owns parsing and document structure. Agent567 supplies Material 3 tokens,
 * code-fence chrome and wrapping table cells without rewriting the message source.
 */
@Composable
fun MarkdownContent(
    source: String,
    modifier: Modifier = Modifier,
    onSurface: Boolean = false,
    streaming: Boolean = false,
) {
    val textColor = if (onSurface) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    val visibleSource = if (streaming) {
        val latest by rememberUpdatedState(source)
        var snapshot by remember { mutableStateOf(source) }
        LaunchedEffect(Unit) {
            snapshotFlow { latest }.conflate().collect {
                // Read the freshest value after any backpressure, never replay intermediate prefixes.
                val next = latest
                if (snapshot != next) {
                    val start = TimeSource.Monotonic.markNow()
                    snapshot = next
                    // Two frame boundaries let Compose commit this change. The interval includes
                    // scheduling and layout; it is not a measurement of Markdown parsing alone.
                    withFrameNanos { }; withFrameNanos { }
                    val elapsed = start.elapsedNow().inWholeMilliseconds
                    delay(((elapsed * 2).coerceIn(60L, 300L) - elapsed).coerceAtLeast(0L))
                }
            }
        }
        snapshot
    } else source
    val renderSource = remember(visibleSource) { escapeConversationTags(withoutInlineImageData(visibleSource)) }
    if (renderSource.isBlank()) return
    val state = rememberMarkdownState(renderSource, retainState = true)
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
            table = { model -> MobileMarkdownTable(model) },
            unorderedList = { model ->
                val files = remember(model.content, model.node) { artifactFiles(model.content, model.node) }
                if (files != null) ArtifactFiles(files)
                else MarkdownBulletList(model.content, model.node, style = model.typography.bullet)
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
                h1 = MaterialTheme.typography.titleLarge,
                h2 = MaterialTheme.typography.titleMedium,
                h3 = MaterialTheme.typography.titleSmall,
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
                table = MaterialTheme.typography.bodyMedium.copy(color = textColor),
            ),
        dimens = markdownDimens(tableCellWidth = 180.dp, tableCellPadding = 10.dp),
        components = components,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun MobileMarkdownTable(model: MarkdownComponentModel) {
    val dimens = LocalMarkdownDimens.current
    val colors = LocalMarkdownColors.current
    val columnCount = remember(model.node) { model.node.findChildOfType(HEADER)?.children?.count { it.type == CELL } ?: 0 }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val scrollable = columnCount * dimens.tableCellWidth > maxWidth
        Column {
            MarkdownTable(
                content = model.content,
                node = model.node,
                style = model.typography.table,
                headerBlock = { content, header, tableWidth, style ->
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(topStart = dimens.tableCornerSize, topEnd = dimens.tableCornerSize))
                            .background(colors.text.copy(alpha = 0.06f)),
                    ) {
                        MarkdownTableHeader(
                            content = content,
                            header = header,
                            tableWidth = tableWidth,
                            style = style,
                            verticalAlignment = Alignment.Top,
                            maxLines = Int.MAX_VALUE,
                            overflow = TextOverflow.Clip,
                        )
                    }
                },
                rowBlock = { content, row, tableWidth, style ->
                    Column(Modifier.fillMaxWidth()) {
                        // The renderer defaults to one line with ellipsis; rows must keep every cell.
                        MarkdownTableRow(
                            content = content,
                            header = row,
                            tableWidth = tableWidth,
                            style = style,
                            verticalAlignment = Alignment.Top,
                            maxLines = Int.MAX_VALUE,
                            overflow = TextOverflow.Clip,
                        )
                        MarkdownDivider()
                    }
                },
            )
            if (scrollable) {
                Text(
                    text = Str.tableSwipeHint,
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.text.copy(alpha = 0.7f),
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
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
    var copyFailed by remember(code) { mutableStateOf(false) }
    LaunchedEffect(copied, copyFailed) {
        if (copied || copyFailed) {
            delay(if (copyFailed) 4000 else 1600)
            copied = false
            copyFailed = false
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
                        copied = try {
                            clipboard.setText(AnnotatedString(code))
                            true
                        } catch (_: RuntimeException) { false }
                        copyFailed = !copied
                    },
                ) {
                    Icon(
                        imageVector = if (copied) Icons.Default.Check else Icons.Default.ContentCopy,
                        contentDescription = if (copied) Str.copied else Str.copy,
                    )
                }
            }
            if (copyFailed) Text(Str.copyUnavailable, Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.labelSmall)
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
