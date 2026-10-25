package org.agent567.android.ui.remote

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.components.PrimaryBlackButton

@Composable
internal fun RemoteCaptureRecoveryCard(message: String, onRetry: () -> Unit, onExit: () -> Unit, modifier: Modifier = Modifier) {
    Surface(modifier.widthIn(max = 360.dp).padding(16.dp), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(message, style = MaterialTheme.typography.titleSmall)
            Text(Str.remoteRecoveryHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            PrimaryBlackButton(text = Str.remoteReconnect, onClick = onRetry)
            TextButton(onClick = onExit, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(Str.remoteExit) }
        }
    }
}
