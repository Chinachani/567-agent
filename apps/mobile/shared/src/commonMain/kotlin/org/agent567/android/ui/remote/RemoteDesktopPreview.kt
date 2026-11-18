package org.agent567.android.ui.remote

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str

enum class RemotePreviewPhase { Waiting, Ready, Failed }

internal fun remotePreviewPhase(message: String?, hasVideoFrame: Boolean): RemotePreviewPhase = when {
    message != null && message != Str.remoteCaptureWaiting -> RemotePreviewPhase.Failed
    message == null && hasVideoFrame -> RemotePreviewPhase.Ready
    else -> RemotePreviewPhase.Waiting
}

/** Only the video has a fixed aspect ratio. Recovery content grows with text size. */
@Composable
internal fun RemoteDesktopPreview(
    phase: RemotePreviewPhase,
    message: String?,
    onRetry: () -> Unit,
    onClose: () -> Unit,
    onFullscreen: () -> Unit,
    modifier: Modifier = Modifier,
    latency: String? = null,
    reconnectingMessage: String? = null,
    waitingMessage: String = Str.remoteCaptureWaiting,
    onDiagnostics: (() -> Unit)? = null,
    slowFirstFrame: Boolean = false,
    video: @Composable () -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (phase == RemotePreviewPhase.Failed) {
            RemoteCaptureRecoveryCard(message ?: Str.remoteCaptureFailed, onRetry, onClose, compact = true)
        } else {
            Box(
                Modifier.fillMaxWidth().aspectRatio(16f / 10f).clip(MaterialTheme.shapes.large)
                    .background(if (phase == RemotePreviewPhase.Ready) Color.Black else MaterialTheme.colorScheme.surfaceContainerLow),
                contentAlignment = Alignment.Center,
            ) {
                video()
                if (phase == RemotePreviewPhase.Waiting) {
                    Surface(color = MaterialTheme.colorScheme.surfaceContainerLow) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            Text(waitingMessage, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                if (phase == RemotePreviewPhase.Ready && reconnectingMessage != null) {
                    Surface(
                        modifier = Modifier.align(Alignment.TopCenter).padding(8.dp),
                        shape = MaterialTheme.shapes.large,
                        color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.92f),
                    ) {
                        Row(
                            Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                            Text(reconnectingMessage, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
            if (phase == RemotePreviewPhase.Waiting && slowFirstFrame) {
                Text(Str.remoteSlowFirstFrame, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.remoteReconnect) }
            }
            if (phase == RemotePreviewPhase.Ready) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(latency ?: Str.desktopPreview, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = onFullscreen, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(Str.remoteDesktopFullscreen)
                    }
                }
            }
        }
        if (onDiagnostics != null) TextButton(onClick = onDiagnostics, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(Str.connectionStatus)
        }

    }
}
