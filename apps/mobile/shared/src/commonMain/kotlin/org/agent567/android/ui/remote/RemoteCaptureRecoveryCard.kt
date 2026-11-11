package org.agent567.android.ui.remote

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str

@Composable
internal fun RemoteCaptureRecoveryCard(
    message: String,
    onRetry: () -> Unit,
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    Surface(
        modifier.widthIn(max = 360.dp).fillMaxWidth().padding(if (compact) 0.dp else 16.dp),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(Modifier.padding(if (compact) 12.dp else 16.dp), verticalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 12.dp)) {
            Text(message, style = if (compact) MaterialTheme.typography.labelLarge else MaterialTheme.typography.titleSmall)
            Text(Str.remoteRecoveryHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = onRetry,
                    modifier = Modifier.heightIn(min = 48.dp),
                    contentPadding = PaddingValues(horizontal = 10.dp),
                    shape = MaterialTheme.shapes.medium,
                ) { Text(Str.remoteReconnect) }
                TextButton(onClick = onExit, modifier = Modifier.heightIn(min = 48.dp), contentPadding = PaddingValues(horizontal = 10.dp)) {
                    Text(if (compact) Str.remoteClosePreview else Str.remoteExit)
                }
            }
        }
    }
}
