package org.agent567.android.ui.media

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Reads only system-granted content URIs, with per-file and aggregate memory bounds. */
suspend fun readGrantedFileAttachments(context: Context, uris: List<Uri>): List<PickedFileAttachment> = withContext(Dispatchers.IO) {
    val files = mutableListOf<PickedFileAttachment>()
    var total = 0
    for (uri in uris.distinct().take(MAX_MESSAGE_FILE_COUNT)) {
        currentCoroutineContext().ensureActive()
        if (uri.scheme != "content") continue
        try {
            val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0) else null
            }?.takeIf { it.isNotBlank() }?.take(180) ?: "attachment"
            val mime = context.contentResolver.getType(uri)?.substringBefore(';')?.trim()?.lowercase()
                ?.takeIf { it.matches(Regex("[a-z0-9.+-]{1,127}/[a-z0-9.+-]{1,127}")) } ?: "application/octet-stream"
            val limit = minOf(MAX_MESSAGE_FILE_BYTES, MAX_MESSAGE_FILE_TOTAL_BYTES - total)
            if (limit <= 0) break
            val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                while (output.size() <= limit) {
                    currentCoroutineContext().ensureActive()
                    val count = input.read(buffer, 0, minOf(buffer.size, limit + 1 - output.size()))
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: continue
            if (bytes.isEmpty() || bytes.size > limit) continue
            total += bytes.size
            files += PickedFileAttachment(name, mime, bytes)
        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (_: Exception) { /* Caller compares accepted count and presents partial failure. */ }
    }
    files
}
