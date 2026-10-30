package org.agent567.android.ui.updates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str

@Composable
fun UpdateDownloadPanel(state: UpdateDownloadState, onPause: () -> Unit, onResume: () -> Unit, onInstall: () -> Unit) {
    if (state.phase == UpdateDownloadPhase.Idle) return
    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("${Str.updateDownloadChannel} ${state.version}", style = MaterialTheme.typography.titleSmall)
            Text(Str.updateDownloadProgress(state.downloadedBytes, state.totalBytes), style = MaterialTheme.typography.bodySmall)
        }
        if (state.phase == UpdateDownloadPhase.Downloading) {
            LinearProgressIndicator(
                progress = { if (state.totalBytes > 0) (state.downloadedBytes.toFloat() / state.totalBytes).coerceIn(0f, 1f) else 0f },
                modifier = Modifier.fillMaxWidth(),
            )
            if (state.bytesPerSecond > 0) Text(Str.updateDownloadSpeed(state.bytesPerSecond), style = MaterialTheme.typography.bodySmall)
        }
        Text(when (state.phase) {
            UpdateDownloadPhase.Ready -> Str.updateDownloadReady
            UpdateDownloadPhase.Paused -> Str.updateDownloadPaused
            UpdateDownloadPhase.Pausing -> Str.updateDownloadPausing
            UpdateDownloadPhase.Error -> state.error ?: Str.updateDownloadFailed
            UpdateDownloadPhase.Verifying -> Str.updateDownloadVerifying
            else -> Str.updateDownloadInstallHint
        }, style = MaterialTheme.typography.bodySmall)
        when (state.phase) {
            UpdateDownloadPhase.Downloading -> TextButton(onClick = onPause, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.updateDownloadPause) }
            UpdateDownloadPhase.Paused, UpdateDownloadPhase.Error -> TextButton(onClick = onResume, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.updateDownloadResume) }
            UpdateDownloadPhase.Ready -> Button(onClick = onInstall, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.updateDownloadInstall) }
            else -> Unit
        }
    }
}
