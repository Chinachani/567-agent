package org.agent567.android.ui.me

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.agent567.android.diagnostics.MobileDiagnostics

@Composable
actual fun rememberDiagnosticsFileActions(onSaved: (Boolean?) -> Unit): DiagnosticsFileActions {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
        if (uri == null) {
            onSaved(null)
        } else {
            scope.launch {
                val saved = withContext(Dispatchers.IO) { writeReport(context, uri) }
                onSaved(saved)
            }
        }
    }
    return remember(launcher) {
        DiagnosticsFileActions(export = { launcher.launch("567-agent-diagnostics.txt") })
    }
}

private fun writeReport(context: Context, uri: android.net.Uri): Boolean = runCatching {
    val report = MobileDiagnostics.exportReport()
    context.contentResolver.openOutputStream(uri, "w")?.use { output ->
        output.write(report.toByteArray(Charsets.UTF_8))
    } ?: error("Unable to open diagnostics destination")
}.isSuccess
