package org.agent567.android.ui.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.ast.ASTNode

internal data class ArtifactFile(val path: String) {
    val name get() = path.replace('\\', '/').substringAfterLast('/').ifBlank { path }
}

/** Match whole file-link items in the parsed list, never code or mixed explanatory lists. */
internal fun artifactFiles(content: String, node: ASTNode): List<ArtifactFile>? {
    val items = node.children.filter { it.type == MarkdownElementTypes.LIST_ITEM }
    if (items.isEmpty()) return null
    return items.map { item ->
        val paragraphs = item.children.filter { it.type == MarkdownElementTypes.PARAGRAPH }
        if (paragraphs.size != 1 || item.children.any { it.type == MarkdownElementTypes.UNORDERED_LIST || it.type == MarkdownElementTypes.ORDERED_LIST }) return null
        val paragraph = paragraphs.single()
        val link = paragraph.children.singleOrNull { it.type == MarkdownElementTypes.INLINE_LINK } ?: return null
        if (content.substring(paragraph.startOffset, link.startOffset).isNotBlank() || content.substring(link.endOffset, paragraph.endOffset).isNotBlank()) return null
        val destination = link.children.singleOrNull { it.type == MarkdownElementTypes.LINK_DESTINATION } ?: return null
        val path = content.substring(destination.startOffset, destination.endOffset).removeSurrounding("<", ">")
        val local = path.startsWith("/") || path.startsWith("~/") || path.startsWith("file://") || path.startsWith("\\\\") || Regex("^[A-Za-z]:[/\\\\]").containsMatchIn(path) || (!path.contains(':') && path.substringAfterLast('/').contains('.'))
        if (!local) return null
        ArtifactFile(path)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ArtifactFiles(files: List<ArtifactFile>) {
    var expanded by remember { mutableStateOf(false) }
    var showAll by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<ArtifactFile?>(null) }
    val collapsible = files.size > 3
    val types = remember(files) { files.groupingBy { it.name.substringAfterLast('.', "…").uppercase() }.eachCount().entries.joinToString(" · ") { "${it.key} × ${it.value}" } }
    Column(Modifier.fillMaxWidth()) {
        if (collapsible) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f), shape = MaterialTheme.shapes.medium) {
                Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { expanded = !expanded }.heightIn(min = 44.dp).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("${Str.artifacts} · ${files.size}", style = MaterialTheme.typography.labelLarge)
                        Text(types, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, contentDescription = if (expanded) Str.collapse else Str.expand)
                }
            }
        }
        if (!collapsible || expanded) {
            files.take(if (files.size > 5) 3 else 5).forEach { file -> ArtifactFileRow(file) { selected = file } }
            if (files.size > 5) TextButton(onClick = { showAll = true }) { Text("${Str.viewAll} (${files.size})") }
        }
    }
    if (showAll && selected == null) {
        ModalBottomSheet(onDismissRequest = { showAll = false }) {
            Text("${Str.artifacts} · ${files.size}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(16.dp))
            LazyColumn { itemsIndexed(files) { _, file -> ArtifactFileRow(file) { selected = file } } }
        }
    }
    selected?.let { file ->
        @Suppress("DEPRECATION")
        val clipboard = LocalClipboardManager.current
        ModalBottomSheet(onDismissRequest = { selected = null }) {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(file.name, style = MaterialTheme.typography.titleMedium)
                Text(Str.artifactPathHint, style = MaterialTheme.typography.bodyMedium)
                SelectionContainer { Text(file.path, style = MaterialTheme.typography.bodySmall) }
                TextButton(onClick = { clipboard.setText(AnnotatedString(file.path)) }) { Text(Str.copy) }
            }
        }
    }
}

@Composable
private fun ArtifactFileRow(file: ArtifactFile, open: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = open).heightIn(min = 44.dp).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Icons.Default.Description, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(file.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}
