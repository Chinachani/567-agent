package org.agent567.android.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.session.MessageFileAttachment
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.media.*

class RetryFileSelection internal constructor(
    val sessionId: String,
    val assistantId: String,
    val files: List<MessageFileAttachment>,
    internal val authRevision: Long,
    internal val owner: String,
)

@Composable
internal fun RetryFileDraftDialog(selection: RetryFileSelection, onDismiss: () -> Unit,
    onRestore: suspend (List<PickedFileAttachment>) -> String?) {
    var picked by remember(selection) { mutableStateOf<List<PickedFileAttachment>?>(null) }
    var error by remember(selection) { mutableStateOf<String?>(null) }
    val pick = rememberFileAttachmentPicker(onPicked = { picked = it; error = null }, onRejected = { error = Str.shareReadFailed })
    LaunchedEffect(picked) { val batch = picked ?: return@LaunchedEffect; error = onRestore(batch); picked = null }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(Str.retryPickFiles) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(Str.retryPickFilesHint)
            selection.files.forEach { Text("${it.fileName} · ${it.sizeBytes} B") }
            if (selection.files.any { it.sha256 == null }) Text(Str.retryPickLegacyHint)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (picked != null) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
    }, confirmButton = { TextButton(onClick = pick, enabled = picked == null) { Text(Str.retryPickFilesAction) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(Str.cancel) } })
}
