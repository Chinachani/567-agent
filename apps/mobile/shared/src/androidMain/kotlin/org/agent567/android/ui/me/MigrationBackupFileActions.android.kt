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
import org.agent567.android.data.session.MIGRATION_BACKUP_MAX_BYTES
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

@Composable
actual fun rememberMigrationBackupFileActions(
    onOpened: (ByteArray?, MigrationBackupFileError?) -> Unit,
    onSaved: (Boolean, MigrationBackupFileError?) -> Unit,
): MigrationBackupFileActions {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pendingBytes by remember { mutableStateOf<ByteArray?>(null) }
    val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val bytes = pendingBytes
        pendingBytes = null
        if (uri == null || bytes == null) {
            onSaved(false, null)
        } else {
            scope.launch {
                val error = withContext(Dispatchers.IO) { writeBackup(context, uri, bytes) }
                onSaved(error == null, error)
            }
        }
    }
    val openLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) {
            onOpened(null, null)
        } else {
            scope.launch {
                val result = withContext(Dispatchers.IO) { readBackupResult(context, uri) }
                onOpened(result.first, result.second)
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

private fun writeBackup(context: Context, uri: Uri, bytes: ByteArray): MigrationBackupFileError? {
    if (bytes.size > MIGRATION_BACKUP_MAX_BYTES) return MigrationBackupFileError.TooLarge
    return try {
        context.contentResolver.openOutputStream(uri, "w")?.use { output -> output.write(bytes) }
            ?: error("无法写入迁移文件")
        null
    } catch (_: Exception) {
        MigrationBackupFileError.Access
    }
}

private fun readBackupResult(context: Context, uri: Uri): Pair<ByteArray?, MigrationBackupFileError?> =
    try {
        val input = context.contentResolver.openInputStream(uri) ?: error("无法读取迁移文件")
        input.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                total += count
                if (total > MIGRATION_BACKUP_MAX_BYTES) {
                    return@use Pair(null, MigrationBackupFileError.TooLarge)
                }
                output.write(buffer, 0, count)
            }
            Pair(output.toByteArray(), null)
        }
    } catch (_: Exception) {
        Pair(null, MigrationBackupFileError.Access)
    }
