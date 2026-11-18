package org.agent567.android.ui.remote

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.remote.RemoteScreenStage
import org.agent567.android.domain.remote.RemoteStreamStats
import org.agent567.android.domain.remote.RemoteVideoPreference
import org.agent567.android.ui.i18n.Str
import kotlin.math.roundToInt

internal fun RemoteScreenStage.label(): String = when (this) {
    RemoteScreenStage.Connecting -> Str.remoteStageConnecting
    RemoteScreenStage.WaitingForScreen -> Str.remoteStageWaiting
    RemoteScreenStage.Negotiating -> Str.remoteStageNegotiating
    RemoteScreenStage.WaitingForFrame -> Str.remoteWaitingFirstFrame
    RemoteScreenStage.Receiving -> Str.remoteStageReceiving
    RemoteScreenStage.Reconnecting -> Str.remoteStageRecovering
    RemoteScreenStage.Ended -> Str.remoteStageEnded
}

internal fun RemoteVideoPreference.label(): String = when (this) {
    RemoteVideoPreference.Auto -> Str.remoteVideoAuto
    RemoteVideoPreference.Smooth -> Str.remoteVideoSmooth
    RemoteVideoPreference.Clear -> Str.remoteVideoClear
}

/** Whitelist only transport measurements; never include signaling exceptions or target URLs. */
private fun connectionMeasurements(stats: RemoteStreamStats?): List<Pair<String, String>> {
    fun measured(value: Double?, unit: String) = value?.takeIf { it.isFinite() && it >= 0 && it < Int.MAX_VALUE }
        ?.let { "${it.roundToInt()} $unit" } ?: Str.remoteStatsUnavailable
    return listOf(
        Str.remoteRoundTrip to measured(stats?.roundTripMs, "ms"),
        Str.remoteFrameRate to measured(stats?.framesPerSecond, "FPS"),
        Str.remoteResolution to if (stats?.frameWidth != null && stats.frameWidth > 0 && stats.frameHeight != null && stats.frameHeight > 0) "${stats.frameWidth} × ${stats.frameHeight}" else Str.remoteStatsUnavailable,
        Str.remoteJitter to measured(stats?.jitterBufferMs, "ms"),
        Str.remoteDecode to measured(stats?.decodeMs, "ms"),
        Str.remoteReceiveEstimate to measured(stats?.pictureDelayMs, "ms"),
    )
}

@Composable
internal fun RemoteConnectionPanel(
    stage: RemoteScreenStage,
    stats: RemoteStreamStats?,
    inputEnabled: Boolean,
    preference: RemoteVideoPreference,
    preferenceSupported: Boolean,
    onPreference: (RemoteVideoPreference) -> Boolean,
    onReconnect: () -> Unit,
    onDismiss: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    var feedback by remember { mutableStateOf<String?>(null) }
    val measurements = connectionMeasurements(stats)
    val route = when (stats?.route) {
        RemoteStreamStats.Route.Lan -> Str.remoteHostRoute
        RemoteStreamStats.Route.Internet -> Str.remoteOtherDirectRoute
        RemoteStreamStats.Route.Relayed -> Str.remoteRelayedRoute
        null -> Str.remoteRouteChecking
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(Str.connectionStatus) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stage.label(), style = MaterialTheme.typography.titleSmall)
                Text(route)
                Text(if (inputEnabled) Str.remoteControlGranted else Str.viewOnly)
                measurements.forEach { (label, value) ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        Text(value, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Text(Str.remoteEstimateHint, style = MaterialTheme.typography.bodySmall)
                HorizontalDivider()
                Text(Str.remoteVideoPreference, style = MaterialTheme.typography.titleSmall)
                RemoteVideoPreference.entries.forEach { option ->
                    Row {
                        RadioButton(selected = preference == option, enabled = preferenceSupported, onClick = {
                            feedback = if (onPreference(option)) Str.remoteVideoSent else Str.remoteVideoPending
                        })
                        TextButton(onClick = { feedback = if (onPreference(option)) Str.remoteVideoSent else Str.remoteVideoPending }, enabled = preferenceSupported) { Text(option.label()) }
                    }
                }
                Text(if (preferenceSupported) Str.remoteVideoHint else Str.remoteVideoUnsupported, style = MaterialTheme.typography.bodySmall)
                feedback?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                TextButton(onClick = {
                    clipboard.setText(AnnotatedString(buildString {
                        appendLine("567 Agent screen diagnostics v1")
                        appendLine("stage=${stage.name}; route=${stats?.route?.name ?: "unknown"}; input=$inputEnabled; preference=${preference.wire}")
                        measurements.forEach { (label, value) -> appendLine("$label: $value") }
                    }))
                    feedback = Str.remoteDiagnosticsCopied
                }, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.remoteCopyDiagnostics) }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(Str.close) } },
        dismissButton = { TextButton(onClick = { onDismiss(); onReconnect() }) { Text(Str.remoteReconnect) } },
    )
}
