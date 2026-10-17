package org.agent567.android.ui.chat

import org.agent567.android.ui.components.ScrollableDetailDialog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.session.ChatContextSnapshot
import org.agent567.android.ui.i18n.Str

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatContextSheet(
    desktop: Boolean,
    snapshot: ChatContextSnapshot?,
    loading: Boolean,
    busy: Boolean,
    hasSession: Boolean,
    error: String?,
    notice: String?,
    onDismiss: () -> Unit,
    onRefresh: () -> Unit,
    onCompact: () -> Unit,
    onAutoChange: (Boolean) -> Unit,
    onCapacityChange: (Long?) -> Unit = {},
    onOpenWorkbench: () -> Unit,
    onReset: () -> Unit,
    onCancel: () -> Unit,
) {
    var confirmReset by remember { mutableStateOf(false) }
    var showSummary by remember { mutableStateOf(false) }
    val canChange = hasSession && snapshot != null && !loading && !busy && !snapshot.busy
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(Str.contextManage, Modifier.weight(1f).padding(top = 8.dp), style = MaterialTheme.typography.titleLarge)
                TextButton(onClick = onRefresh, enabled = hasSession && !busy && !loading) { Text(Str.contextRefresh) }
            }
            Text(if (desktop) Str.contextDesktopHint else Str.contextMobileHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!hasSession) Text(Str.contextSendFirst)
            if (loading || busy) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(Modifier.size(20.dp))
                Text(if (busy) Str.contextWorking else Str.loading)
            }
            snapshot?.let { state ->
                ContextGroup {
                    state.modelName?.let { Text(it, style = MaterialTheme.typography.titleSmall) }
                    Text(Str.contextUsage, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(state.tokens?.let { "${if (state.estimated) "≈ " else ""}$it tokens" } ?: Str.contextUnknown, style = MaterialTheme.typography.headlineSmall)
                    val window = state.contextWindow?.takeIf { it > 0 }
                    val used = state.tokens
                    if (window != null && used != null) {
                        LinearProgressIndicator(progress = { (used.toFloat() / window).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                        Text("${(used * 100L / window).coerceAtLeast(0)}% · ${Str.contextActiveMessages}: ${state.messageCount}", style = MaterialTheme.typography.bodySmall)
                    } else Text("${Str.contextActiveMessages}: ${state.messageCount}", style = MaterialTheme.typography.bodySmall)
                    if (state.estimated) Text(Str.contextEstimateHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    HorizontalDivider()
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(Str.contextAutoCompact, Modifier.weight(1f).padding(top = 12.dp))
                        Switch(checked = state.autoCompactionEnabled, onCheckedChange = onAutoChange, enabled = canChange)
                    }
                    Text(if (desktop) Str.contextDesktopAutoHint else Str.contextMobileAutoHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (state.summary.isNotBlank()) TextButton(onClick = { showSummary = true }) { Text("${Str.contextShowSummary} · ${state.summary.length}") }
                    if (state.busy && !busy) Text(Str.contextWaitForTurn)
                }
                ChatContextCapacity(state, desktop, state.modelKey != null && !loading && !busy && !state.busy, onCapacityChange)
            }
            OutlinedButton(onClick = onOpenWorkbench, modifier = Modifier.fillMaxWidth()) { Text(Str.workbenchTitle) }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            notice?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            ContextGroup {
                Text(Str.contextCompactActions, style = MaterialTheme.typography.titleSmall)
                Text(Str.contextCompactionCost, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FilledTonalButton(onClick = onCompact, enabled = canChange, modifier = Modifier.fillMaxWidth()) { Text(Str.contextCompactNow) }
                TextButton(onClick = { confirmReset = true }, enabled = hasSession && !busy && !loading && snapshot?.busy != true, modifier = Modifier.fillMaxWidth()) { Text(if (desktop) Str.contextNewDesktopChat else Str.contextReset) }
                if (busy) OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text(Str.contextCancel) }
            }
        }
    }
    if (showSummary) ScrollableDetailDialog(Str.contextShowSummary, onDismiss = { showSummary = false }) { Text(snapshot?.summary.orEmpty(), style = MaterialTheme.typography.bodyLarge) }
    if (confirmReset) AlertDialog(
        onDismissRequest = { confirmReset = false },
        title = { Text(if (desktop) Str.contextNewDesktopChat else Str.contextReset) },
        text = { Text(if (desktop) Str.contextNewDesktopConfirm else Str.contextResetConfirm) },
        confirmButton = { TextButton(onClick = { confirmReset = false; onReset() }) { Text(Str.contextConfirm) } },
        dismissButton = { TextButton(onClick = { confirmReset = false }) { Text(Str.close) } },
    )
}
