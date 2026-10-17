package org.agent567.android.ui.me

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.agent567.android.diagnostics.MobileDiagnostics
import org.agent567.android.ui.components.ScrollableDetailDialog
import org.agent567.android.ui.i18n.Str

@Composable
actual fun rememberDiagnosticsFileActions(onSaved: (Boolean?) -> Unit): DiagnosticsFileActions {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var preview by remember { mutableStateOf(false) }
    var report by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableStateOf(0) }
    var includeLogs by remember { mutableStateOf(false) }
    var pendingReport by remember { mutableStateOf<String?>(null) }
    val result by rememberUpdatedState(onSaved)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
        val frozen = pendingReport; pendingReport = null
        if (uri == null || frozen == null) result(null)
        else scope.launch {
            val saved = withContext(Dispatchers.IO) { runCatching { context.contentResolver.openOutputStream(uri, "w")?.use { it.write(frozen.toByteArray(Charsets.UTF_8)) } ?: error("Unable to open diagnostics destination") }.isSuccess }
            result(saved)
        }
    }
    LaunchedEffect(preview, includeLogs, refresh) {
        if (preview) { report = null; report = withContext(Dispatchers.IO) { MobileDiagnostics.exportReport(includeLogs) } }
    }
    if (preview) ScrollableDetailDialog(
        title = Str.diagnosticsDialogTitle,
        onDismiss = { preview = false },
        footer = {
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { refresh++ }, enabled = report != null) { Text(Str.contextRefresh) }
                Button(onClick = { pendingReport = report; preview = false; launcher.launch("567-agent-diagnostics.txt") }, enabled = report != null, modifier = Modifier.weight(1f)) { Text(Str.exportDiagnostics) }
            }
        },
    ) {
        Text(Str.diagnosticsPreviewHint, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth()) {
            Text(Str.diagnosticsIncludeLogs, Modifier.weight(1f))
            Switch(includeLogs, { includeLogs = it })
        }
        if (report == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        report?.let { SelectionContainer { Text(it, style = MaterialTheme.typography.bodySmall) } }
    }
    return remember { DiagnosticsFileActions(export = { preview = true }) }
}
