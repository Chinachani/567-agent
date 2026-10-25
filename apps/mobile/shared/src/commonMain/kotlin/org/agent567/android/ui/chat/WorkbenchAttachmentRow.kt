package org.agent567.android.ui.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.agent567.android.domain.session.MessageImage
import org.agent567.android.domain.session.SessionAttachmentAsset
import org.agent567.android.domain.session.validatedWorkbenchThumbnail
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.media.imageBitmapFromBase64
import org.agent567.android.ui.media.imageThumbnail

@Composable
internal fun WorkbenchAttachmentRow(file: SessionAttachmentAsset, image: MessageImage?, readThumbnail: suspend (String) -> String?, onClick: () -> Unit) {
    var visible by remember(file.id) { mutableStateOf(false) }
    val isImage = file.kind == "image" || Regex(".*\\.(png|jpe?g|webp|gif|bmp)$", RegexOption.IGNORE_CASE).matches(file.name)
    val latestReader by rememberUpdatedState(readThumbnail)
    val bitmap by produceState<ImageBitmap?>(null, file.id, image, visible) {
        if (!visible || !isImage) { value = null; return@produceState }
        try {
            value = if (image != null) withContext(Dispatchers.IO) { imageThumbnail(image) }
            else validatedWorkbenchThumbnail(latestReader(file.id))?.let { data -> withContext(Dispatchers.Default) { imageBitmapFromBase64(data) } }
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { value = null }
    }
    Surface(onClick = onClick, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth().onGloballyPositioned { coordinates -> visible = !coordinates.boundsInWindow().isEmpty }) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(Modifier.size(48.dp), shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHighest) {
                Box(contentAlignment = Alignment.Center) {
                    bitmap?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
                        ?: Icon(if (isImage) Icons.Default.Image else Icons.Default.InsertDriveFile, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(file.name.ifBlank { Str.contextAttachmentTurn }, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(if (isImage) Str.workbenchImageAttachment else Str.workbenchFileAttachment, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
