package org.agent567.android.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.agent567.android.core.chat.InferenceApi
import org.agent567.android.domain.session.ChatContextSnapshot
import org.agent567.android.ui.i18n.Str

@Composable
internal fun ChatInferenceApiSettings(state: ChatContextSnapshot, enabled: Boolean, onChange: (InferenceApi?) -> Unit, notice: String? = null, error: String? = null) {
    var expanded by remember(state.modelKey) { mutableStateOf(false) }
    val automatic = InferenceApi.fromWire(state.automaticInferenceApi) ?: InferenceApi.Completions
    val selected = InferenceApi.fromWire(state.inferenceApiOverride)
    fun label(api: InferenceApi) = if (api == InferenceApi.Responses) Str.modelProtocolResponses else Str.modelProtocolCompletions
    val autoLabel = "${Str.modelProtocolAuto} · ${label(automatic)}"
    ContextGroup {
        Text(Str.modelProtocol, style = MaterialTheme.typography.titleSmall)
        Box {
            OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(selected?.let(::label) ?: autoLabel)
            }
            DropdownMenu(expanded = expanded && enabled, onDismissRequest = { expanded = false }) {
                DropdownMenuItem(text = { Text(autoLabel) }, onClick = { expanded = false; onChange(null) })
                InferenceApi.entries.forEach { api ->
                    DropdownMenuItem(text = { Text(label(api)) }, onClick = { expanded = false; onChange(api) })
                }
            }
        }
        notice?.let { Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        Text(Str.modelProtocolHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
