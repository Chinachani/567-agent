package org.agent567.android.ui.media

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
actual fun rememberOriginalAttachmentSaver(load: suspend (String) -> ByteArray, onResult: (String?) -> Unit): (id: String, name: String) -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val currentLoad by rememberUpdatedState(load)
    val result by rememberUpdatedState(onResult)
    var pending by remember { mutableStateOf<Pair<String, suspend (String) -> ByteArray>?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val id = pending; pending = null
        if (uri != null && id != null) scope.launch {
            try {
                val bytes = id.second(id.first)
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri, "w")?.use { it.write(bytes) } ?: error("无法写入所选位置") }
                result("原文件已保存")
            } catch (error: kotlinx.coroutines.CancellationException) { throw error } catch (error: Exception) { result(error.message ?: "原文件保存失败") }
        }
    }
    return { id, name -> if (pending == null) { pending = id to currentLoad; launcher.launch(name) } }
}
