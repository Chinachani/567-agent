package org.agent567.android.ui.chat

import org.agent567.android.ui.components.ScrollableDetailDialog

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.session.ContextWorkspaceSnapshot
import org.agent567.android.ui.i18n.Str

@Composable
internal fun ContextWorkspaceBody(
    snapshot: ContextWorkspaceSnapshot,
    busy: Boolean,
    pinned: String,
    excluded: List<String>,
    onPinnedChange: (String) -> Unit,
    onToggleVisible: (List<String>, Boolean) -> Unit,
) {
    var compare by remember { mutableStateOf(false) }
    val visibleTurns = snapshot.turns.asReversed().take(100)
    val selectableTurns = visibleTurns.filter { it.status != "before_reset" }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(Str.contextWorkspaceHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(pinned, onValueChange = { if (it.length <= 16000) onPinnedChange(it) }, label = { Text(Str.contextPinned) }, minLines = 3, maxLines = 6, enabled = !busy && !snapshot.busy, modifier = Modifier.fillMaxWidth())
        if (snapshot.summary.isNotBlank() || snapshot.previousSummary.isNotBlank()) TextButton(onClick = { compare = true }) { Text(Str.contextCompareSummary) }
        Text("${Str.contextWorkspaceTurns}: ${visibleTurns.size} / ${snapshot.totalTurns}", style = MaterialTheme.typography.labelMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { onToggleVisible(selectableTurns.map { it.id }, true) }, enabled = !busy && !snapshot.busy && selectableTurns.any { it.id in excluded }) { Text(Str.contextIncludeVisible) }
            TextButton(onClick = { onToggleVisible(selectableTurns.map { it.id }, false) }, enabled = !busy && !snapshot.busy && selectableTurns.any { it.id !in excluded }) { Text(Str.contextExcludeVisible) }
        }
        visibleTurns.forEach { turn ->
            HorizontalDivider()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Checkbox(modifier = Modifier.alpha(if (turn.status == "before_reset" || turn.id in excluded) 0.5f else 1f), checked = turn.status != "before_reset" && turn.id !in excluded, enabled = !busy && !snapshot.busy && turn.status != "before_reset", onCheckedChange = { checked -> onToggleVisible(listOf(turn.id), checked) })
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(when { turn.status == "before_reset" -> Str.contextTurnBeforeReset; turn.id in excluded -> Str.contextTurnExcluded; turn.status == "summarized" -> Str.contextTurnSummarized; else -> Str.contextTurnIncluded }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    var expanded by remember(turn.id) { mutableStateOf(false) }
                    Text((if (expanded) turn.text else turn.text.take(240)).ifBlank { Str.contextAttachmentTurn }, style = MaterialTheme.typography.bodyMedium)
                    if (turn.text.length > 240) TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) Str.collapse else Str.expand) }
                    TextButton(onClick = { onPinnedChange(listOf(pinned, turn.text).filter(String::isNotBlank).joinToString("\n\n")) }, enabled = !busy && !snapshot.busy && pinned.length + turn.text.length + 2 <= 16000 && turn.text.isNotBlank() && !pinned.contains(turn.text)) { Text(Str.contextPinPreview) }
                    turn.attachments.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
    if (compare) ScrollableDetailDialog(Str.contextCompareSummary, { compare = false }) {
        Text(Str.contextShowSummary, style = MaterialTheme.typography.titleMedium)
        Text(snapshot.summary.ifBlank { Str.contextNoSummary })
        HorizontalDivider()
        Text(Str.contextPreviousSummary, style = MaterialTheme.typography.titleMedium)
        Text(snapshot.previousSummary.ifBlank { Str.contextNoSummary })
    }
}
