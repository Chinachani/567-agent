package org.agent567.android.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import org.agent567.android.core.chat.InferenceApi
import org.agent567.android.domain.session.ChatContextSnapshot
import org.agent567.android.ui.i18n.Str

@Composable
internal fun ChatInferenceApiSettings(state: ChatContextSnapshot, enabled: Boolean, onChange: (InferenceApi?) -> Unit, notice: String? = null, error: String? = null) {
    var expanded by remember(state.modelKey) { mutableStateOf(false) }
    LaunchedEffect(enabled) { if (!enabled) expanded = false }
    val automatic = InferenceApi.fromWire(state.automaticInferenceApi) ?: InferenceApi.Completions
    val selected = InferenceApi.fromWire(state.inferenceApiOverride)
    fun label(api: InferenceApi) = if (api == InferenceApi.Responses) Str.modelProtocolResponses else Str.modelProtocolCompletions
    val autoLabel = "${Str.modelProtocolAuto} · ${label(automatic)}"
    ContextGroup {
        Text(Str.modelProtocol, style = MaterialTheme.typography.titleSmall)
        OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(selected?.let(::label) ?: autoLabel)
        }
        notice?.let { Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        Text(Str.modelProtocolHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (expanded && enabled) AlertDialog(
        onDismissRequest = { expanded = false },
        title = { Text(Str.modelProtocol) },
        text = {
            Column {
                for (api in listOf(null) + InferenceApi.entries) {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .selectable(selected = selected == api, role = Role.RadioButton, onClick = { expanded = false; onChange(api) })
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        RadioButton(selected = selected == api, onClick = null)
                        Text(api?.let(::label) ?: autoLabel, Modifier.weight(1f))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { expanded = false }) { Text(Str.close) } },
    )
}
