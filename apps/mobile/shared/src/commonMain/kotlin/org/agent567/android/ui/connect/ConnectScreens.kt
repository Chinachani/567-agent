package org.agent567.android.ui.connect

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.remote.remoteDesktopViewerTarget
import androidx.compose.foundation.layout.aspectRatio
import org.agent567.android.ui.components.MobilePageIntro
import org.agent567.android.ui.components.MobileIconTile
import org.agent567.android.ui.components.Agent567Card
import org.agent567.android.ui.components.SecondaryOutlineButton
import org.agent567.android.ui.components.FilterChipRow
import org.agent567.android.ui.components.EmptyState
import org.agent567.android.ui.components.ListRow
import org.agent567.android.ui.components.PrimaryBlackButton
import org.agent567.android.ui.components.SectionHeader
import org.agent567.android.ui.components.StatusChip
import org.agent567.android.ui.components.StatusDot
import org.agent567.android.ui.components.Agent567TextField
import org.agent567.android.ui.components.Agent567ListGroup
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra
import org.agent567.android.ui.remote.RemoteDesktopSurface
import org.agent567.android.ui.remote.PairingScannerButton

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiscoverConnectScreen(
    devices: List<DesktopDevice>,
    channelIndex: Int,
    onChannelChange: (Int) -> Unit,
    onOpenDevice: (String) -> Unit,
    onConnectManual: (String) -> Unit,
    onUseCloud: () -> Unit,
    remoteConnecting: Boolean = false,
    error: org.agent567.android.domain.error.UiError? = null,
    onClearError: () -> Unit = {},
) {
    var host by remember { mutableStateOf("") }
    val channels = listOf(Str.channelLan, Str.channelRemote, Str.channelCloud)

    Scaffold(
        containerColor = MaterialTheme.agent567Extra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.discoverTitle, style = MaterialTheme.typography.titleLarge) },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.agent567Extra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            MobilePageIntro(Str.mobileConnectTitle, Str.discoverSubtitle)
            if (error != null) {
                Spacer(Modifier.height(10.dp))
                org.agent567.android.ui.components.Agent567ErrorBanner(error = error, onDismiss = onClearError)
            }
            if (remoteConnecting) {
                Spacer(Modifier.height(10.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    androidx.compose.material3.CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(Str.connectingDesktop, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
                }
            }
            Spacer(Modifier.height(14.dp))
            FilterChipRow(options = channels, selectedIndex = channelIndex, onSelect = onChannelChange)
            Spacer(Modifier.height(16.dp))

            when (channelIndex) {
                2 -> {
                    SectionHeader(title = Str.channelCloud)
                    Text(
                        Str.featureCloudDesc,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.agent567Extra.secondaryText,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                    Spacer(Modifier.height(18.dp))
                    PrimaryBlackButton(text = Str.useCloudAi, onClick = onUseCloud)
                }
                else -> {
                    val remote = channelIndex == 1
                    SectionHeader(
                        title =
                            if (remote) {
                                if (devices.isEmpty()) Str.remoteDesktopSection else Str.connectedDesktop
                            } else {
                                Str.lanDevices
                            },
                    )
                    if (remote) {
                        PairingScannerButton(
                            onScanned = onConnectManual,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            label = Str.scanDesktop,
                        )
                        Spacer(Modifier.height(12.dp))
                    }
                    if (devices.isEmpty()) {
                        EmptyState(
                            title = if (remote) Str.noRemoteDevices else Str.disconnected,
                            subtitle = if (remote) Str.noRemoteDevicesHint else Str.noDevicesHint,
                            icon = Icons.Default.Computer,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    devices.forEachIndexed { index, device ->
                        ListRow(
                            title = device.name,
                            subtitle =
                                "${if (remote) Str.remoteDesktop else Str.lanDesktop} · " +
                                    if (device.status == DeviceStatus.Online) Str.online else Str.offline,
                            leading = { MobileIconTile(Icons.Default.Computer) },
                            trailing = {
                                StatusDot(online = device.status == DeviceStatus.Online)
                                Spacer(Modifier.width(12.dp))
                                Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.agent567Extra.secondaryText)
                            },
                            onClick = { onOpenDevice(device.id) },
                            showDivider = index < devices.lastIndex,
                        )
                    }
                    Spacer(Modifier.height(22.dp))
                    if (!remote) {
                        SectionHeader(title = Str.manualConnect)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Agent567TextField(
                                value = host,
                                onValueChange = { host = it },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                                placeholder = { Text(Str.lanAddressHint) },
                            )
                            Spacer(Modifier.width(6.dp))
                            PairingScannerButton(onScanned = { value ->
                                if (value.startsWith("vetta://pair") || value.startsWith("agent567://pair")) {
                                    onConnectManual(value)
                                } else {
                                    host = value
                                }
                            })
                        }
                        Spacer(Modifier.height(10.dp))
                        PrimaryBlackButton(
                            text = Str.connectAction,
                            onClick = { onConnectManual(host.trim()) },
                            enabled = host.isNotBlank(),
                        )
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceDetailScreen(
    device: DesktopDevice,
    autoRequestDesktopScreen: Boolean,
    onBack: () -> Unit,
    onDisconnect: () -> Unit,
    onNewChat: () -> Unit,
    onOpenCapabilities: () -> Unit,
) {
    var desktopPreviewRequested by remember(device.id) { mutableStateOf(autoRequestDesktopScreen) }
    val desktopTarget = remoteDesktopViewerTarget(device.host)
    val statusLabel =
        when (device.status) {
            DeviceStatus.Online -> Str.deviceConnected
            DeviceStatus.Connecting -> Str.connectingDesktop
            DeviceStatus.Offline -> Str.disconnected
        }
    Scaffold(
        containerColor = MaterialTheme.agent567Extra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(device.name, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.agent567Extra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusChip(text = statusLabel, positive = device.status == DeviceStatus.Online)
                Spacer(Modifier.weight(1f))
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Metric(Str.duration, device.connectedDuration ?: Str.notAvailable)
                Metric(Str.latency, device.latencyMs?.let { "${it}ms" } ?: Str.notAvailable)
            }

            Spacer(Modifier.height(20.dp))
            Agent567Card {
                Text(Str.deviceConversationTitle, style = MaterialTheme.typography.titleSmall)
                Text(Str.deviceConversationHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
                Spacer(Modifier.height(8.dp))
                PrimaryBlackButton(text = Str.startConversation, onClick = onNewChat, enabled = device.status == DeviceStatus.Online)
            }

            AnimatedVisibility(
                visible = desktopTarget != null,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                desktopTarget?.let {
                    Column {
                        Spacer(Modifier.height(20.dp))
                        Agent567Card {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(Str.desktopPreview, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                            if (desktopPreviewRequested) {
                                Row {
                                    TextButton(onClick = { desktopPreviewRequested = false }) { Text(Str.mobileStopPreview) }
                                }
                            }
                        }
                        if (!desktopPreviewRequested) {
                            Text(
                                Str.mobilePreviewHint,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.agent567Extra.secondaryText,
                            )
                            Spacer(Modifier.height(8.dp))
                            SecondaryOutlineButton(text = Str.mobileRequestPreview, onClick = { desktopPreviewRequested = true }, enabled = device.status == DeviceStatus.Online)
                        } else {
                            RemoteDesktopSurface(
                                target = it.url,
                                modifier = Modifier.fillMaxWidth().aspectRatio(16f / 10f).clip(MaterialTheme.shapes.large),
                            )
                        }
                        }
                    }
                }
            }

            Spacer(Modifier.height(20.dp))
            Agent567Card {
                ListRow(title = Str.mobileCapabilities, subtitle = Str.deviceCapabilitiesHint, trailing = { Icon(Icons.Default.ChevronRight, contentDescription = null) }, onClick = onOpenCapabilities, showDivider = false)
            }
            Spacer(Modifier.height(20.dp))
            SectionHeader(title = Str.systemInfo)
            Agent567ListGroup {
                SystemInfoRow(Str.operatingSystem, device.osLabel)
                SystemInfoRow(Str.processor, device.cpu)
                SystemInfoRow(Str.memory, device.ram)
            }

            Spacer(Modifier.height(20.dp))
            TextButton(onClick = onDisconnect, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(Str.disconnect, color = MaterialTheme.colorScheme.error) }
            Spacer(Modifier.height(24.dp))
        }
    }

}

@Composable
private fun Metric(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun SystemInfoRow(label: String, value: String?) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText, modifier = Modifier.weight(.35f))
        Text(value ?: Str.notAvailable, style = MaterialTheme.typography.bodySmall, textAlign = androidx.compose.ui.text.style.TextAlign.End, modifier = Modifier.weight(.65f))
    }
}
