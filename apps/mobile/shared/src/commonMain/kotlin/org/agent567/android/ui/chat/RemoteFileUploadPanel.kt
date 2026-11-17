package org.agent567.android.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.agent567.android.domain.session.RemoteFilesUnsupportedException
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.media.*

/** This panel owns upload selection and cancellation. Confirmed files are never uploaded twice. */
@Composable
internal fun RemoteFileUploadPanel(
    upload: suspend (PickedFileAttachment, (Int, Int) -> Unit) -> String,
    onUsePath: (String) -> Unit,
    onUploaded: () -> Unit,
) {
    val uploader by rememberUpdatedState(upload)
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var files by remember { mutableStateOf(emptyList<PickedFileAttachment>()) }
    var paths by remember { mutableStateOf(emptyMap<Int, String>()) }
    var used by remember { mutableStateOf(emptySet<Int>()) }
    var current by remember { mutableIntStateOf(-1) }
    var progress by remember { mutableFloatStateOf(0f) }
    var job by remember { mutableStateOf<Job?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    val busy = job != null
    val picker = rememberFileAttachmentPicker(onPicked = { picked ->
        if (job == null) { files = picked; paths = emptyMap(); used = emptySet(); notice = null; current = -1; progress = 0f }
    }, onRejected = { notice = Str.shareReadFailed })
    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(Str.uploadTitle, style = MaterialTheme.typography.titleSmall)
            Text(Str.uploadHint, style = MaterialTheme.typography.bodySmall)
            files.forEachIndexed { index, file ->
                Text(file.fileName, style = MaterialTheme.typography.bodyMedium)
                val path = paths[index]
                when {
                    path != null -> {
                        Text("${Str.uploadComplete} · $path", style = MaterialTheme.typography.bodySmall)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { clipboard.setText(AnnotatedString(path)); notice = Str.uploadCopied }) { Text(Str.uploadCopy) }
                            TextButton(onClick = { onUsePath(path); used = used + index; notice = Str.uploadAdded }, enabled = index !in used) { Text(Str.uploadUse) }
                        }
                    }
                    busy && index == current -> {
                        LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
                        Text(if (progress >= 1f) Str.uploadSaving else "${(progress * 100).toInt()}%", style = MaterialTheme.typography.bodySmall)
                    }
                    else -> Text(Str.uploadWaiting, style = MaterialTheme.typography.bodySmall)
                }
            }
            notice?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = picker, enabled = !busy) { Text(Str.uploadChoose) }
                if (busy) TextButton(onClick = { job?.cancel() }) { Text(Str.uploadCancel) }
                else if (files.size > paths.size) Button(onClick = {
                    notice = null
                    job = scope.launch(start = kotlinx.coroutines.CoroutineStart.LAZY) {
                        try {
                            files.forEachIndexed { index, file ->
                                if (index !in paths) {
                                    current = index; progress = 0f
                                    val path = uploader(file) { done, total -> progress = done.toFloat() / total.coerceAtLeast(1) }
                                    paths = paths + (index to path)
                                    onUploaded()
                                }
                            }
                        } catch (cancelled: CancellationException) { notice = Str.uploadCancelled; throw cancelled }
                        catch (_: RemoteFilesUnsupportedException) { notice = Str.uploadUnsupported }
                        catch (_: Exception) { notice = Str.uploadFailed }
                        finally { job = null }
                    }
                    job?.start()
                }) { Text(if (current >= 0) Str.uploadRetry else Str.uploadStart) }
            }
        }
    }
}
