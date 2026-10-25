package org.agent567.android.ui.chat

import org.agent567.android.ui.components.ScrollableDetailDialog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.role
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DataUsage
import org.agent567.android.core.model.parseModelContextCapacityInput
import org.agent567.android.domain.session.ChatContextSnapshot
import org.agent567.android.ui.i18n.Str

@Composable
internal fun ChatContextCapacity(state: ChatContextSnapshot, desktop: Boolean, enabled: Boolean, onCapacityChange: (Long?) -> Unit) {
    var editing by remember(state.modelKey) { mutableStateOf(false) }
    var reference by remember(state.modelKey) { mutableStateOf(false) }
    var draft by remember(state.modelKey, state.manualContextWindow) { mutableStateOf(state.manualContextWindow?.toString().orEmpty()) }
    val parsed = parseModelContextCapacityInput(draft)
    val valid = draft.isBlank() || parsed != null
    val sourceLabel = when (state.contextWindowSource) {
        "manual" -> Str.contextCapacityManual
        "api" -> Str.contextCapacityApi
        "catalog" -> Str.contextCapacityCatalog
        else -> Str.contextCapacityUnknown
    }
    ContextGroup {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                Text(Str.contextCapacityLimit, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(state.contextWindow?.let { "$it tokens" } ?: Str.contextCapacityUnknown, style = MaterialTheme.typography.titleLarge)
            }
            if (!desktop) TextButton(onClick = { editing = !editing }, enabled = enabled) { Text(if (editing) Str.close else Str.contextCapacityAdjust) }
        }
        SourceAction(
            label = "${Str.contextCapacityShowReference} · $sourceLabel",
            icon = Icons.Default.DataUsage,
            onClick = { reference = true },
            modifier = Modifier.fillMaxWidth(),
        )
        if (desktop) Text(Str.contextCapacityDesktop, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        else if (editing) {
            OutlinedTextField(value = draft, onValueChange = { draft = it }, label = { Text(Str.contextCapacityOverride) }, placeholder = { Text(Str.contextCapacityAutomatic) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii), singleLine = true, isError = !valid, enabled = enabled, modifier = Modifier.fillMaxWidth())
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(listOf("32K", "64K", "128K", "200K", "1M")) { value ->
                    FilterChip(selected = parsed == parseModelContextCapacityInput(value), onClick = { draft = value }, enabled = enabled, label = { Text(value) })
                }
                state.automaticContextWindow?.let { value -> item { SuggestionChip(onClick = { draft = value.toString() }, enabled = enabled, label = { Text(Str.contextCapacityFillReference) }) } }
            }
            Text(if (!valid) Str.contextCapacityInvalid else parsed?.let { "${Str.contextCapacityParsed}: $it tokens" } ?: Str.contextCapacityUnits, style = MaterialTheme.typography.bodySmall, color = if (valid) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { draft = ""; onCapacityChange(null) }, enabled = enabled && (state.manualContextWindow != null || draft.isNotEmpty())) { Text(Str.contextCapacityAutomatic) }
                Button(onClick = { onCapacityChange(if (draft.isBlank()) null else parsed) }, enabled = enabled && valid) { Text(Str.contextCapacitySave) }
            }
            Text(Str.contextCapacityScope, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (state.contextWindow == null) Text(Str.contextCapacityUnknownHint, style = MaterialTheme.typography.bodySmall)

    }
    if (reference) {
        val uriHandler = LocalUriHandler.current
        ScrollableDetailDialog(Str.contextCapacityShowReference, onDismiss = { reference = false }) {
            Text("$sourceLabel: ${state.contextWindow ?: Str.contextCapacityUnknown} tokens", style = MaterialTheme.typography.bodyMedium)
            state.referenceModel?.let { model ->
                HorizontalDivider()
                Text(model, style = MaterialTheme.typography.titleLarge)
                state.referenceCheckedAt?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.labelMedium) }
                Text("${Str.contextCapacityInput}: ${state.referenceContextWindow ?: Str.contextCapacityUnknown} tokens\n${Str.contextCapacityOutput}: ${state.referenceMaxOutput ?: Str.contextCapacityUnknown} tokens")
                ModelCapabilityReference(state.referenceCapabilities, state.referenceMaxInput)
                if (state.referenceIsAlias) Text(Str.contextCapacityAliasHint, style = MaterialTheme.typography.bodySmall)
                state.referenceUrl?.takeIf { it.startsWith("https://") && !it.endsWith("/v1/models") }?.let { url -> TextButton(onClick = { runCatching { uriHandler.openUri(url) } }) { Text(Str.contextCapacityReferenceLink) } }
            }
        }
    }
}

@Composable
private fun SourceAction(label: String, icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier
            .heightIn(min = 48.dp)
            .semantics { role = Role.Button },
        onClick = onClick,
        shape = RoundedCornerShape(6.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
            Icon(Icons.Default.ChevronRight, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
