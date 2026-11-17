package org.agent567.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.device.SessionListItem
import org.agent567.android.ui.i18n.Str

/** Choosing a destination only fills a draft. Sending remains an explicit chat action. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SharedTextDestinationSheet(
    sessions: List<SessionListItem>,
    currentSessionId: String?,
    files: List<String> = emptyList(),
    error: String? = null,
    busy: Boolean = false,
    queued: Int = 0,
    hasContent: Boolean = true,
    onChoose: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val visible = sessions.distinctBy { it.id }
        .filter { query.isBlank() || it.title.contains(query, ignoreCase = true) }
        .sortedByDescending { it.id == currentSessionId }
    ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(Str.shareDestinationTitle, style = MaterialTheme.typography.titleLarge)
            Text(Str.shareDestinationHint, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (queued > 0) Text(Str.shareQueued(queued), style = MaterialTheme.typography.bodySmall)
            files.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
            if (busy) androidx.compose.material3.LinearProgressIndicator(Modifier.fillMaxWidth())
            ListRow(title = Str.shareDestinationNew, onClick = { if (!busy && hasContent) onChoose(null) })
            Agent567TextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text(Str.searchSessions) },
            )
            LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false)) {
                if (visible.isEmpty()) item { Text(Str.noSessionsMatch, Modifier.padding(vertical = 16.dp)) }
                items(visible, key = { it.id }) { session ->
                    ListRow(
                        title = session.title,
                        subtitle = listOfNotNull(
                            session.sourceLabel,
                            Str.shareDestinationCurrent.takeIf { session.id == currentSessionId },
                        ).joinToString(" · "),
                        onClick = { if (!busy && hasContent) onChoose(session.id) },
                    )
                }
            }
            TextButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.cancel) }
        }
    }
}
