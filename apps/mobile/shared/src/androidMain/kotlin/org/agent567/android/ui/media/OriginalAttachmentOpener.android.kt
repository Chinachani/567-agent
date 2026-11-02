package org.agent567.android.ui.media

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.agent567.android.ui.i18n.Str

class AttachmentPreviewProvider : FileProvider()

internal fun attachmentOpenIntent(uri: Uri, name: String): Intent {
    val extension = name.substringAfterLast('.', "").lowercase()
    val mime = when (extension) {
        "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        "csv" -> "text/csv"
        "tsv" -> "text/tab-separated-values"
        "md", "markdown" -> "text/plain"
        else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
    }
    return Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        .apply { clipData = ClipData.newRawUri("attachment", uri) }
}

internal fun cacheOriginalAttachment(context: Context, name: String, bytes: ByteArray): Uri {
    require(bytes.size <= MAX_MESSAGE_FILE_BYTES) { Str.workbenchOriginalTooLarge }
    // Reopening the same original reuses its immutable copy, rather than
    // accumulating another potentially 12 MB download on each tap.
    val key = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    val folder = File(context.cacheDir, "attachment-previews/$key")
    check(folder.isDirectory || folder.mkdirs())
    val safeName = name.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[\\p{Cntrl}]"), "_").take(160)
        .takeUnless { it.isBlank() || it == "." || it == ".." } ?: "attachment"
    val file = File(folder, safeName)
    if (!file.isFile || file.length() != bytes.size.toLong()) {
        val temporary = File.createTempFile("preparing-", null, folder)
        try {
            temporary.writeBytes(bytes)
            check(temporary.renameTo(file))
        } finally { temporary.delete() }
    }
    return FileProvider.getUriForFile(context, "${context.packageName}.attachments", file)
}

@Composable
actual fun rememberOriginalAttachmentOpener(load: suspend (String) -> ByteArray, onResult: (String?) -> Unit): OriginalAttachmentOpener {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val currentLoad by rememberUpdatedState(load)
    val result by rememberUpdatedState(onResult)
    var opening by remember { mutableStateOf(false) }
    return OriginalAttachmentOpener(opening) { id, name ->
        if (!opening) {
            opening = true
            val reader = currentLoad
            scope.launch {
                try {
                    val bytes = reader(id)
                    val uri = withContext(Dispatchers.IO) { cacheOriginalAttachment(context, name, bytes) }
                    context.startActivity(attachmentOpenIntent(uri, name))
                    result(null)
                } catch (error: CancellationException) { throw error }
                catch (_: ActivityNotFoundException) { result(Str.workbenchNoViewer) }
                catch (_: Exception) { result(Str.workbenchOpenFailed) }
                finally { opening = false }
            }
        }
    }
}
