package org.agent567.android.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalUriHandler
import org.agent567.android.core.model.parseModelContextCapacityInput
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
    onReset: () -> Unit,
    onCancel: () -> Unit,
) {
    var confirmReset by remember { mutableStateOf(false) }
    var showSummary by remember { mutableStateOf(false) }
    var showReference by remember(snapshot?.modelKey) { mutableStateOf(false) }
    var capacityDraft by remember(snapshot?.modelKey, snapshot?.manualContextWindow) { mutableStateOf(snapshot?.manualContextWindow?.toString().orEmpty()) }
    val uriHandler = LocalUriHandler.current
    val canChange = hasSession && snapshot != null && !loading && !busy && !snapshot.busy
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(Str.contextManage, style = MaterialTheme.typography.titleLarge)
            Text(if (desktop) Str.contextDesktopHint else Str.contextMobileHint, style = MaterialTheme.typography.bodyMedium)
            if (!hasSession) Text(Str.contextSendFirst)
            if (loading || busy) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator()
                    Text(if (busy) Str.contextWorking else Str.loading)
                }
            }
            snapshot?.let { state ->
                if (!desktop) state.modelName?.let { Text(it, style = MaterialTheme.typography.titleSmall) }
                val window = state.contextWindow
                val used = state.tokens
                Text(buildString {
                    append(Str.contextUsage).append(": ")
                    if (used == null) append(Str.contextUnknown) else {
                        if (state.estimated) append("≈ ")
                        append(used).append(" tokens")
                        if (window != null) append(" / ").append(window).append(" · ").append((used * 100L / window).coerceAtLeast(0)).append("%")
                    }
                })
                Text("${Str.contextActiveMessages}: ${state.messageCount}")
                Text("${Str.contextCapacitySource}: ${when (state.contextWindowSource) {
                    "manual" -> Str.contextCapacityManual
                    "api" -> Str.contextCapacityApi
                    "catalog" -> Str.contextCapacityCatalog
                    else -> Str.contextCapacityUnknown
                }}", style = MaterialTheme.typography.bodySmall)
                if (desktop) Text(Str.contextCapacityDesktop, style = MaterialTheme.typography.bodySmall)
                else {
                    val canEditCapacity = state.modelKey != null && !loading && !busy && !state.busy
                    state.referenceModel?.let { model ->
                        TextButton(onClick = { showReference = !showReference }) { Text(if (showReference) Str.contextCapacityHideReference else Str.contextCapacityShowReference) }
                        if (showReference) {
                            Text("${Str.contextCapacityReference}: $model · ${state.referenceCheckedAt.orEmpty()}\n${Str.contextCapacityInput}: ${state.referenceContextWindow?.toString() ?: Str.contextCapacityUnknown} tokens · ${Str.contextCapacityOutput}: ${state.referenceMaxOutput?.toString() ?: Str.contextCapacityUnknown} tokens", style = MaterialTheme.typography.bodySmall)
                            ModelCapabilityReference(state.referenceCapabilities, state.referenceMaxInput)
                            if (state.referenceIsAlias) Text(Str.contextCapacityAliasHint, style = MaterialTheme.typography.bodySmall)
                            state.referenceUrl?.takeIf { it.startsWith("https://") && !it.endsWith("/v1/models") }?.let { url -> TextButton(onClick = { runCatching { uriHandler.openUri(url) } }) { Text(Str.contextCapacityReferenceLink) } }
                        }
                    }
                    OutlinedTextField(value = capacityDraft, onValueChange = { capacityDraft = it },
                        label = { Text(Str.contextCapacityOverride) }, placeholder = { Text(Str.contextCapacityAutomatic) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii), singleLine = true,
                        enabled = canEditCapacity, modifier = Modifier.fillMaxWidth())
                    Text(Str.contextCapacityScope, style = MaterialTheme.typography.bodySmall)
                    val capacity = parseModelContextCapacityInput(capacityDraft)
                    Text(Str.contextCapacityInputHint + (capacity?.let { " · $it tokens" } ?: ""), style = MaterialTheme.typography.bodySmall)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("32K", "64K", "128K", "1M").forEach { value -> TextButton(onClick = { capacityDraft = value }, enabled = canEditCapacity) { Text(value) } }
                        state.automaticContextWindow?.let { value -> TextButton(onClick = { capacityDraft = value.toString() }, enabled = canEditCapacity) { Text(Str.contextCapacityFillReference) } }
                    }
                    val valid = capacityDraft.isBlank() || capacity != null
                    if (!valid) Text(Str.contextCapacityInvalid, color = MaterialTheme.colorScheme.error)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TextButton(onClick = { onCapacityChange(if (capacityDraft.isBlank()) null else capacity) }, enabled = canEditCapacity && valid) { Text(Str.contextCapacitySave) }
                        TextButton(onClick = { capacityDraft = ""; onCapacityChange(null) }, enabled = canEditCapacity && (state.manualContextWindow != null || capacityDraft.isNotEmpty())) { Text(Str.contextCapacityAutomatic) }
                    }
                }
                if (window == null) Text(Str.contextCapacityUnknownHint, style = MaterialTheme.typography.bodySmall)
                if (state.estimated) Text(Str.contextEstimateHint, style = MaterialTheme.typography.bodySmall)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(Str.contextAutoCompact, Modifier.weight(1f))
                    Switch(checked = state.autoCompactionEnabled, onCheckedChange = onAutoChange, enabled = canChange)
                }
                Text(if (desktop) Str.contextDesktopAutoHint else Str.contextMobileAutoHint, style = MaterialTheme.typography.bodySmall)
                if (state.summary.isNotBlank()) {
                    TextButton(onClick = { showSummary = !showSummary }) { Text(if (showSummary) Str.contextHideSummary else Str.contextShowSummary) }
                    if (showSummary) Text(state.summary, Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState()), style = MaterialTheme.typography.bodyMedium)
                }
                if (state.busy && !busy) Text(Str.contextWaitForTurn)
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            notice?.let { Text(it) }
            Text(Str.contextCompactionCost, style = MaterialTheme.typography.bodySmall)
            Button(onClick = onCompact, enabled = canChange, modifier = Modifier.fillMaxWidth()) {
                Text(Str.contextCompactNow)
            }
            OutlinedButton(onClick = { confirmReset = true }, enabled = hasSession && !busy && !loading && snapshot?.busy != true, modifier = Modifier.fillMaxWidth()) {
                Text(if (desktop) Str.contextNewDesktopChat else Str.contextReset)
            }
            if (busy) TextButton(onClick = onCancel) { Text(Str.contextCancel) }
            TextButton(onClick = onRefresh, enabled = hasSession && !busy && !loading) { Text(Str.contextRefresh) }
        }
    }
    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text(if (desktop) Str.contextNewDesktopChat else Str.contextReset) },
            text = { Text(if (desktop) Str.contextNewDesktopConfirm else Str.contextResetConfirm) },
            confirmButton = { TextButton(onClick = { confirmReset = false; onReset() }) { Text(Str.contextConfirm) } },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text(Str.close) } },
        )
    }
}
