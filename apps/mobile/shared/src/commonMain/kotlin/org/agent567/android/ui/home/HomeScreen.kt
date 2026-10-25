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
import org.agent567.android.resources.Res
import org.agent567.android.resources.brand_icon
import org.jetbrains.compose.resources.painterResource
import androidx.compose.foundation.Image
import androidx.compose.material3.FilledTonalButton
import androidx.compose.foundation.layout.PaddingValues
import org.agent567.android.ui.components.MobilePageIntro
import org.agent567.android.ui.components.MobileIconTile
import org.agent567.android.ui.components.PrimaryBlackButton
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.text.style.TextOverflow
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
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Image(painterResource(Res.drawable.brand_icon), contentDescription = null, modifier = Modifier.size(24.dp))
                Text(Str.appName, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                Box(Modifier.heightIn(min = 48.dp).clip(MaterialTheme.shapes.medium).clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onNewConversation), contentAlignment = Alignment.Center) {
                    Row(Modifier.clip(MaterialTheme.shapes.medium).background(MaterialTheme.agent567Extra.chipBackground).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(Str.newConversation, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
            DeviceStatusCard(
                device = primaryDevice,
                onClick = if (primaryDevice != null) ({ onOpenDevice(primaryDevice.id) }) else onOpenDevices,
                onOpenDesktopSessions = onOpenDesktopSessions,
            )

            Agent567Card(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
                ListRow(title = Str.phoneDirectTitle, subtitle = Str.phoneDirectHint, leading = { Icon(Icons.Outlined.Cloud, contentDescription = null) }, trailing = { Icon(Icons.Default.ChevronRight, contentDescription = null) }, onClick = onUseCloudAi, showDivider = false)
            }
            SectionHeader(title = Str.phoneSessions)
            Agent567Card(contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
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
                            .heightIn(min = 48.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .clickable(onClick = onOpenSessions)
                            .padding(horizontal = 4.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            Str.mobileAllSessions(recentSessions.size),
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

            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun DeviceStatusCard(device: DesktopDevice?, onClick: () -> Unit, onOpenDesktopSessions: () -> Unit) {
    Agent567Card(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
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
                Text(device?.name ?: Str.disconnected, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
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
        androidx.compose.material3.HorizontalDivider(color = MaterialTheme.agent567Extra.border.copy(alpha = 0.4f))
        ListRow(title = Str.openDesktopSessions, subtitle = Str.desktopSessionsHint, trailing = { Icon(Icons.Default.ChevronRight, contentDescription = null) }, onClick = onOpenDesktopSessions, showDivider = false)
    }
}

@Composable
private fun ConnectionCapsule(online: Boolean) {
    val color = if (online) MaterialTheme.agent567Extra.success else MaterialTheme.agent567Extra.secondaryText
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(color),
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
