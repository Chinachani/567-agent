package org.agent567.android.ui.home

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.device.SessionListItem
import org.agent567.android.ui.components.ListRow
import org.agent567.android.ui.components.SectionHeader
import org.agent567.android.ui.components.Agent567Card
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    primaryDevice: DesktopDevice?,
    recentSessions: List<SessionListItem>,
    onOpenDevice: (String) -> Unit,
    onOpenDevices: () -> Unit,
    onOpenSessions: () -> Unit,
    onOpenDesktopSessions: () -> Unit = {},
    onOpenSession: (String) -> Unit,
    onNewConversation: () -> Unit,
    onUseCloudAi: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.agent567Extra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.tabHome, style = MaterialTheme.typography.titleMedium) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.agent567Extra.pageBackground),
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onNewConversation,
                shape = CircleShape,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.semantics { contentDescription = Str.newConversation },
            ) {
                Icon(Icons.Outlined.Add, contentDescription = null)
            }
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionHeader(title = Str.myDevices)
            DeviceStatusCard(
                device = primaryDevice,
                onClick = if (primaryDevice != null) ({ onOpenDevice(primaryDevice.id) }) else onOpenDevices,
            )

            SectionHeader(title = Str.phoneSessions)
            Agent567Card {
                if (recentSessions.isEmpty()) {
                    Text(
                        Str.noSessionsHint,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.agent567Extra.secondaryText,
                        modifier = Modifier.padding(vertical = 4.dp),
                    )
                } else {
                    val visibleSessions = recentSessions.take(3)
                    visibleSessions.forEachIndexed { index, item ->
                        SessionMiniRow(
                            item = item,
                            onClick = { onOpenSession(item.id) },
                            showDivider = index < visibleSessions.lastIndex,
                        )
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 44.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .clickable(onClick = onOpenSessions)
                            .padding(horizontal = 4.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "查看全部会话${if (recentSessions.size > 3) " (${recentSessions.size})" else ""}",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Icon(
                            Icons.Default.ChevronRight,
                            contentDescription = null,
                            tint = MaterialTheme.agent567Extra.secondaryText,
                        )
                    }
                }
            }

            SectionHeader(title = Str.quickStart)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                QuickActionCard(
                    modifier = Modifier.weight(1f),
                    icon = { Icon(Icons.Default.Computer, contentDescription = null) },
                    title = Str.openDesktopSessions,
                    onClick = onOpenDesktopSessions,
                )
                QuickActionCard(
                    modifier = Modifier.weight(1f),
                    icon = { Icon(Icons.Outlined.Cloud, contentDescription = null) },
                    title = Str.useCloudAi,
                    onClick = onUseCloudAi,
                )
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun DeviceStatusCard(device: DesktopDevice?, onClick: () -> Unit) {
    Agent567Card(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.agent567Extra.chipBackground),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.Computer, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(device?.name ?: Str.disconnected, style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(2.dp))
                Text(
                    device?.osLabel ?: Str.noDevicesHint,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.agent567Extra.secondaryText,
                )
            }
            Spacer(Modifier.width(8.dp))
            if (device != null) {
                ConnectionCapsule(online = device.status == DeviceStatus.Online)
            } else {
                Text(Str.connectTitle, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.agent567Extra.secondaryText)
            }
            Spacer(Modifier.width(4.dp))
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.agent567Extra.secondaryText)
        }
    }
}

@Composable
private fun ConnectionCapsule(online: Boolean) {
    val transition = rememberInfiniteTransition(label = "device-status-pulse")
    val pulse by transition.animateFloat(
        initialValue = 0.45f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), repeatMode = RepeatMode.Reverse),
        label = "device-status-alpha",
    )
    val color = if (online) MaterialTheme.agent567Extra.success else MaterialTheme.agent567Extra.secondaryText
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .background(color.copy(alpha = 0.1f))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(color.copy(alpha = if (online) pulse else 0.65f)),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            if (online) Str.connected else Str.disconnected,
            style = MaterialTheme.typography.labelSmall,
            color = color,
        )
    }
}

@Composable
private fun QuickActionCard(
    modifier: Modifier,
    icon: @Composable () -> Unit,
    title: String,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.heightIn(min = 92.dp),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            icon()
            Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun SessionMiniRow(
    item: SessionListItem,
    onClick: () -> Unit,
    showDivider: Boolean,
) {
    ListRow(
        title = item.title,
        subtitle = "${item.sourceLabel} · ${item.timeLabel}",
        leading = {
            Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(if (item.isCloud) MaterialTheme.agent567Extra.secondaryText.copy(alpha = 0.5f) else MaterialTheme.agent567Extra.success),
            )
        },
        trailing = {
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.agent567Extra.secondaryText,
            )
        },
        onClick = onClick,
        showDivider = showDivider,
    )
}
