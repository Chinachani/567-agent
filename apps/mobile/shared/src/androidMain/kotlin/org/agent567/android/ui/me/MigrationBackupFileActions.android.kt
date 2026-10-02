package org.agent567.android.ui.me

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

private const val MAX_ARCHIVE_BYTES = 50 * 1024 * 1024

@Composable
actual fun rememberMigrationBackupFileActions(
    onOpened: (ByteArray?) -> Unit,
    onSaved: (Boolean) -> Unit,
): MigrationBackupFileActions {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pendingBytes by remember { mutableStateOf<ByteArray?>(null) }
    val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val bytes = pendingBytes
        pendingBytes = null
        if (uri == null || bytes == null) {
            onSaved(false)
        } else {
            scope.launch {
                onSaved(withContext(Dispatchers.IO) { writeBackup(context, uri, bytes) })
            }
        }
    }
    val openLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) {
            onOpened(null)
        } else {
            scope.launch {
                onOpened(withContext(Dispatchers.IO) { readBackup(context, uri) })
            }
        }
    }
    return remember(saveLauncher, openLauncher) {
        MigrationBackupFileActions(
            save = { bytes ->
                pendingBytes = bytes
                saveLauncher.launch("567-agent-chat-history.vetta-backup")
            },
            open = { openLauncher.launch(arrayOf("*/*")) },
        )
    }
}

private fun writeBackup(context: Context, uri: Uri, bytes: ByteArray): Boolean =
    runCatching {
        require(bytes.size <= MAX_ARCHIVE_BYTES)
        context.contentResolver.openOutputStream(uri, "w")?.use { output -> output.write(bytes) }
            ?: error("无法写入迁移文件")
        true
    }.getOrDefault(false)

private fun readBackup(context: Context, uri: Uri): ByteArray? =
    runCatching {
        val input = context.contentResolver.openInputStream(uri) ?: error("无法读取迁移文件")
        input.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                total += count
                require(total <= MAX_ARCHIVE_BYTES) { "迁移文件超过 50 MB" }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
    }.getOrNull()
