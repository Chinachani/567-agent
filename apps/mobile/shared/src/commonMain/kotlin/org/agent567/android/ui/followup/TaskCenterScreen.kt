package org.agent567.android.ui.followup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.CheckCircleOutline
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.device.SessionListItem
import org.agent567.android.domain.session.PendingQuestion
import org.agent567.android.ui.components.Agent567Card
import org.agent567.android.ui.components.EmptyState
import org.agent567.android.ui.components.ListRow
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

private enum class FollowUpKind { NeedsInput, Running, Failed, Connecting }

private data class FollowUpEntry(
    val id: String,
    val title: String,
    val subtitle: String,
    val kind: FollowUpKind,
    val sessionId: String? = null,
    val deviceId: String? = null,
    val remoteSessionId: String? = null,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskCenterScreen(
    devices: List<DesktopDevice>,
    sessions: List<SessionListItem>,
    pendingQuestion: PendingQuestion?,
    currentSessionId: String?,
    isStreaming: Boolean,
    loading: Boolean,
    error: String?,
    warning: String?,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onOpenSession: (String) -> Unit,
    onOpenDesktopSession: (String, String, String) -> Unit,
    results: List<org.agent567.android.domain.followup.TaskResult> = emptyList(),
    resultsNotice: String? = null,
    resultsLoading: Boolean = false,
    onOpenResult: (org.agent567.android.domain.followup.TaskResult) -> Unit = {},
    runningSessionIds: Set<String> = emptySet(),
    onOpenDevice: (String) -> Unit = {},
) {
    val entries = buildList {
        pendingQuestion?.let { question ->
            val session = sessions.firstOrNull { it.id == question.sessionId }
            add(
                FollowUpEntry(
                    id = "question:${question.sessionId}:${question.requestId}",
                    title = session?.title ?: Str.pendingDesktopQuestionTitle,
                    subtitle = Str.pendingDesktopQuestion,
                    kind = FollowUpKind.NeedsInput,
                    sessionId = question.sessionId,
                ),
            )
        }
        val running = runningSessionIds + listOfNotNull(currentSessionId.takeIf { isStreaming })
        running.filter { it != pendingQuestion?.sessionId }.forEach { runningId ->
            val session = sessions.firstOrNull { it.id == runningId }
            add(
                FollowUpEntry(
                    id = "local:$runningId",
                    title = session?.title ?: Str.waitingResponse,
                    subtitle = Str.waitingResponse,
                    kind = FollowUpKind.Running,
                    sessionId = runningId,
                ),
            )
        }
        val representedRemoteSessions = sessions.filter { session ->
            session.id in running || session.id == pendingQuestion?.sessionId
        }.mapNotNull { session ->
            val deviceId = session.remoteDeviceId ?: return@mapNotNull null
            val remoteId = session.remoteSessionId ?: return@mapNotNull null
            deviceId to remoteId
        }.toSet()
        devices.forEach { device ->
            val active = device.activeConversation.takeIf { device.status == DeviceStatus.Online }
            // A phone stream can represent the same desktop task as the device summary.
            val representedQuestion = active != null && sessions.any {
                it.id == pendingQuestion?.sessionId && it.remoteDeviceId == device.id && it.remoteSessionId == active.id
            }
            if (active != null && ((active.status == "running" &&
                    (device.id to active.id) in representedRemoteSessions) ||
                    (active.status == "waiting" && representedQuestion))
            ) return@forEach
            when {
                active != null && active.status == "waiting" -> add(
                    FollowUpEntry(
                        id = "waiting:${device.id}:${active.id}",
                        title = active.title,
                        subtitle = "${device.name} · ${Str.desktopWaiting}",
                        kind = FollowUpKind.NeedsInput,
                        deviceId = device.id,
                        remoteSessionId = active.id,
                    ),
                )
                active != null && active.status == "running" -> add(
                    FollowUpEntry(
                        id = "running:${device.id}:${active.id}",
                        title = active.title,
                        subtitle = "${device.name} · ${Str.desktopRunning}",
                        kind = FollowUpKind.Running,
                        deviceId = device.id,
                        remoteSessionId = active.id,
                    ),
                )
                active != null && active.status in setOf("failed", "interrupted") -> add(
                    FollowUpEntry(
                        id = "failed:${device.id}:${active.id}",
                        title = active.title,
                        subtitle = "${device.name} · ${Str.desktopFailed}",
                        kind = FollowUpKind.Failed,
                        deviceId = device.id,
                        remoteSessionId = active.id,
                    ),
                )
                device.status == DeviceStatus.Connecting -> add(
                    FollowUpEntry(
                        id = "connecting:${device.id}",
                        title = device.name,
                        subtitle = Str.taskCenterConnecting,
                        kind = FollowUpKind.Connecting,
                        deviceId = device.id,
                    ),
                )
            }
        }
    }.distinctBy { it.id }

    Scaffold(
        containerColor = MaterialTheme.agent567Extra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.taskCenterTitle) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back) }
                },
                actions = {
                    IconButton(onClick = onRefresh, enabled = !loading) {
                        Icon(Icons.Default.Refresh, contentDescription = Str.refreshSessions)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.agent567Extra.pageBackground),
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Text(Str.taskCenterHint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.agent567Extra.secondaryText)
                Spacer(Modifier.height(8.dp))
                if (!error.isNullOrBlank()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                if (!warning.isNullOrBlank()) Text(warning, color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.bodySmall)
            }
            if (loading && entries.isEmpty()) {
                item {
                    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator()
                        Spacer(Modifier.height(12.dp))
                        Text(Str.taskCenterRefreshing, color = MaterialTheme.agent567Extra.secondaryText)
                    }
                }
            } else if (entries.isEmpty()) {
                item {
                    EmptyState(title = Str.taskCenterEmpty, subtitle = Str.taskCenterEmptyHint, icon = Icons.Default.CheckCircleOutline, modifier = Modifier.fillMaxWidth())
                }
            } else {
                items(entries, key = { it.id }) { entry ->
                    Agent567Card(contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) {
                        ListRow(
                            title = entry.title,
                            subtitle = entry.subtitle,
                            leading = { Icon(entry.kind.icon(), contentDescription = null, tint = entry.kind.color()) },
                            trailing = { Text(entry.kind.actionLabel(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.agent567Extra.secondaryText) },
                            onClick = {
                                when {
                                    entry.sessionId != null -> onOpenSession(entry.sessionId)
                                    entry.deviceId != null && entry.remoteSessionId != null -> onOpenDesktopSession(entry.deviceId, entry.remoteSessionId, entry.title)
                                    entry.deviceId != null -> onOpenDevice(entry.deviceId)
                                }
                            },
                            showDivider = false,
                        )
                    }
                }
            }
            item {
                Text(Str.resultInboxTitle, style = MaterialTheme.typography.titleMedium)
                Text(Str.resultInboxHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
                if (resultsLoading) Text(Str.resultInboxLoading, style = MaterialTheme.typography.bodySmall)
                if (resultsNotice != null) Text(resultsNotice, color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.bodySmall)
                if (!resultsLoading && results.isEmpty()) Text(Str.resultInboxEmpty, style = MaterialTheme.typography.bodySmall)
            }
            items(results, key = { "result:${it.key}" }) { result ->
                val device = devices.firstOrNull { it.id == result.deviceId }
                val status = when (result.status) {
                    "completed" -> Str.resultCompleted
                    "failed" -> Str.resultFailed
                    "cancelled" -> Str.resultCancelled
                    "running" -> if (result.deviceId == null && result.sessionId in runningSessionIds || device?.status == DeviceStatus.Online) Str.resultRunning else Str.resultUnknown
                    else -> Str.resultUnknown
                }
                Agent567Card(contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) {
                    ListRow(title = result.title.ifBlank { Str.sessionsTitle },
                        subtitle = listOfNotNull(status, org.agent567.android.domain.session.formatLocalMessageTime(result.endedAt ?: result.startedAt), device?.name, Str.resultInboxCached.takeIf { result.deviceId != null && device?.status != DeviceStatus.Online }, Str.resultUnread.takeIf { !result.read }).joinToString(" · "),
                        trailing = { Text(Str.taskCenterActionOpen, style = MaterialTheme.typography.labelMedium) },
                        onClick = {
                            onOpenResult(result)
                        }, showDivider = false)
                }
            }

        }
    }
}

private fun FollowUpKind.icon(): ImageVector = when (this) {
    FollowUpKind.NeedsInput -> Icons.AutoMirrored.Filled.HelpOutline
    FollowUpKind.Running -> Icons.Default.Sync
    FollowUpKind.Failed -> Icons.Default.ErrorOutline
    FollowUpKind.Connecting -> Icons.Default.Computer
}

private fun FollowUpKind.color() = when (this) {
    FollowUpKind.NeedsInput -> androidx.compose.ui.graphics.Color(0xFFFFB74D)
    FollowUpKind.Running -> androidx.compose.ui.graphics.Color(0xFF64B5F6)
    FollowUpKind.Failed -> androidx.compose.ui.graphics.Color(0xFFEF5350)
    FollowUpKind.Connecting -> androidx.compose.ui.graphics.Color(0xFFB0BEC5)
}

private fun FollowUpKind.actionLabel(): String = when (this) {
    FollowUpKind.NeedsInput -> Str.taskCenterActionAnswer
    FollowUpKind.Running -> Str.taskCenterActionOpen
    FollowUpKind.Failed -> Str.taskCenterActionReview
    FollowUpKind.Connecting -> Str.taskCenterActionOpen
}
