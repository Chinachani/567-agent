package org.agent567.android.ui.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.io.encoding.Base64
import kotlinx.coroutines.CancellationException
import org.agent567.android.domain.remote.connection.RemoteRequestException
import org.agent567.android.domain.remote.protocol.RemoteErrorCode
import org.agent567.android.domain.session.*
import org.agent567.android.ui.components.ScrollableDetailDialog
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.media.*

private data class DirectoryRequest(val path: String = "", val offset: Int = 0)

/** Owns only this browser's navigation and reads; disposal cancels requests and drops file bytes. */
@Composable
internal fun SessionFilesPane(
    listFiles: suspend (String, Int) -> RemoteSessionFilePage,
    readFile: suspend (String) -> RemoteSessionFileContent,
    uploadFile: suspend (PickedFileAttachment, (Int, Int) -> Unit) -> String,
    onUseFilePath: (String) -> Unit,
) {
    val list by rememberUpdatedState(listFiles)
    var request by remember { mutableStateOf(DirectoryRequest()) }
    var parents by remember { mutableStateOf(emptyList<DirectoryRequest>()) }
    var page by remember { mutableStateOf<RemoteSessionFilePage?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    var selected by remember { mutableStateOf<RemoteSessionFile?>(null) }
    LaunchedEffect(request, retry) {
        loading = true
        error = null
        page = null
        try { page = list(request.path, request.offset) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = remoteFileError(failure) }
        finally { loading = false }
    }
    RemoteFileUploadPanel(uploadFile, onUseFilePath, onUploaded = { retry++ })
    Text(Str.sessionFilesHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = { request = parents.last(); parents = parents.dropLast(1) }, enabled = parents.isNotEmpty() && !loading) { Text(Str.sessionFilesBack) }
        TextButton(onClick = { retry++ }, enabled = !loading) { Text(Str.sessionFilesRefresh) }
    }
    Text(page?.path?.ifEmpty { Str.sessionFilesRoot } ?: request.path.ifEmpty { Str.sessionFilesRoot }, style = MaterialTheme.typography.titleSmall)
    if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    error?.let {
        Text(it, color = MaterialTheme.colorScheme.error)
        TextButton(onClick = { retry++ }) { Text(Str.sessionFilesRetry) }
    }
    page?.let { current ->
        if (current.entries.isEmpty()) Text(Str.sessionFilesEmpty, style = MaterialTheme.typography.bodySmall)
        current.entries.forEach { entry ->
            key(entry.path) {
                Surface(
                    onClick = {
                        if (entry.isDirectory) {
                            parents = parents + request
                            request = DirectoryRequest(entry.path)
                        } else selected = entry
                    },
                    shape = MaterialTheme.shapes.medium,
                    color = MaterialTheme.colorScheme.surfaceContainerLow,
                ) {
                    Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(if (entry.isDirectory) "▸" else "·")
                        Text(entry.name, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (!entry.isDirectory) Text(fileSize(entry.size), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { request = request.copy(offset = (request.offset - 50).coerceAtLeast(0)) }, enabled = request.offset > 0) { Text(Str.sessionFilesPrevious) }
            TextButton(onClick = { current.nextOffset?.let { request = request.copy(offset = it) } }, enabled = current.nextOffset != null) { Text(Str.sessionFilesNext) }
        }
    }
    selected?.let { file -> key(file.path) { SessionFilePreview(file, readFile) { selected = null } } }
}

@Composable
private fun SessionFilePreview(file: RemoteSessionFile, readFile: suspend (String) -> RemoteSessionFileContent, onDismiss: () -> Unit) {
    val reader by rememberUpdatedState(readFile)
    var content by remember { mutableStateOf<RemoteSessionFileContent?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(retry) {
        content = null
        error = null
        try { content = reader(file.path) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = remoteFileError(failure) }
    }
    val readCopy: suspend (String) -> ByteArray = { requireNotNull(content).bytes }
    val opener = rememberOriginalAttachmentOpener(readCopy) { notice = it }
    val save = rememberOriginalAttachmentSaver(readCopy) { notice = it }
    val jpegCopy = content?.mimeType == "image/jpeg" && file.name.substringAfterLast('.').lowercase() !in setOf("jpg", "jpeg")
    val copyName = if (jpegCopy) file.name.substringBeforeLast('.', file.name) + ".jpg" else file.name
    ScrollableDetailDialog(file.name, onDismiss, footer = {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            notice?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { opener.open(file.path, copyName) }, enabled = content != null && !opener.opening) { Text(Str.sessionFilesOpen) }
                TextButton(onClick = { save(file.path, copyName) }, enabled = content != null && !opener.opening) { Text(Str.sessionFilesSave) }
            }
        }
    }) {
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { retry++ }) { Text(Str.sessionFilesRetry) }
        }
        val loaded = content
        if (loaded == null && error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (loaded != null) {
            if (loaded.mimeType.startsWith("image/") && (loaded.bytes.size.toLong() != file.size || jpegCopy)) Text(Str.sessionFilesScaled, style = MaterialTheme.typography.bodySmall)
            if (loaded.mimeType in setOf("image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp")) {
                val image = remember(loaded) { MessageImage(id = file.path, mimeType = loaded.mimeType, fileName = file.name, base64Data = Base64.encode(loaded.bytes)) }
                when (val bitmap = rememberMessageImageBitmap(image)) {
                    is MessageImageLoadState.Loaded -> Image(bitmap.bitmap, file.name, Modifier.fillMaxWidth().heightIn(max = 480.dp))
                    MessageImageLoadState.Loading -> LinearProgressIndicator(Modifier.fillMaxWidth())
                    else -> Text(Str.workbenchBinaryPreview)
                }
            } else {
                val text = remember(loaded) { attachmentTextPreview(loaded.bytes) }
                if (text == null) Text(Str.workbenchBinaryPreview)
                else {
                    Text(Str.sessionFilesPreviewHint, style = MaterialTheme.typography.bodySmall)
                    SelectionContainer { Text(text) }
                }
            }
        }
    }
}

private fun remoteFileError(error: Exception): String = when {
    error is RemoteFilesUnsupportedException -> Str.sessionFilesUnsupported
    error is RemoteRequestException -> when (error.remoteError.code) {
        RemoteErrorCode.Forbidden, RemoteErrorCode.Unauthorized -> Str.sessionFilesForbidden
        RemoteErrorCode.FileChanged -> Str.sessionFilesChanged
        RemoteErrorCode.TooLarge -> Str.sessionFilesTooLarge
        else -> Str.sessionFilesFailed
    }
    else -> Str.sessionFilesFailed
}

private fun fileSize(bytes: Long): String = when {
    bytes >= 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
    bytes >= 1024 -> "${bytes / 1024} KB"
    else -> "$bytes B"
}
