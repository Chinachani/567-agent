package org.agent567.android.ui.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.shape.CircleShape
import org.agent567.android.ui.components.Agent567AmberBadge
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import org.agent567.android.ui.components.Agent567MainPageScaffold
import org.agent567.android.ui.components.NewConversationButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.CloudQueue
import androidx.compose.foundation.layout.PaddingValues
import org.agent567.android.ui.components.MobileIconTile
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.delay
import org.agent567.android.domain.session.localHistoryDays
import org.agent567.android.domain.session.nowEpochMs
import androidx.compose.runtime.produceState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.device.SessionListItem
import org.agent567.android.ui.components.FilterChipRow
import org.agent567.android.ui.components.EmptyState
import org.agent567.android.ui.components.ListRow
import org.agent567.android.ui.components.Agent567TextField
import org.agent567.android.ui.components.Agent567ConfirmDialog
import org.agent567.android.ui.components.Agent567TextInputDialog
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsScreen(
    sessions: List<SessionListItem>,
    query: String,
    filterIndex: Int,
    onQueryChange: (String) -> Unit,
    onFilterChange: (Int) -> Unit,
    onOpenSession: (SessionListItem) -> Unit,
    onNewConversation: () -> Unit,
    onRenameSession: (sessionId: String, title: String) -> Unit,
    onDeleteSession: (sessionId: String) -> Unit,
    confirmBeforeDelete: Boolean = true,
    desktopSessionsLoading: Boolean = false,
    desktopSessionsError: String? = null,
    desktopSessionsWarning: String? = null,
    operationError: String? = null,
    onDismissOperationError: () -> Unit = {},
    onRetryOperation: () -> Unit = {},
    onRefreshDesktopSessions: () -> Unit = {},
    onRefreshSessions: () -> Unit = onRefreshDesktopSessions,
) {
    var openMenuSessionId by remember { mutableStateOf<String?>(null) }
    var renameTarget by remember { mutableStateOf<SessionListItem?>(null) }
    var deleteTarget by remember { mutableStateOf<SessionListItem?>(null) }
    var renameTitle by rememberSaveable { mutableStateOf("") }
    val filters = listOf(Str.filterAll, Str.filterDesktop, Str.filterCloud)
    val filtered =
        sessions.filter { s ->
            val qOk = query.isBlank() || s.title.contains(query, ignoreCase = true)
            val fOk =
                when (filterIndex) {
                    1 -> !s.isCloud
                    2 -> s.isCloud
                    else -> true
                }
            qOk && fOk
        }

    val days by produceState(remember { localHistoryDays(nowEpochMs()) }) {
        while (true) {
            val now = nowEpochMs()
            value = localHistoryDays(now)
            delay((value.tomorrow - now).coerceIn(1_000L, 60_000L))
        }
    }
    val groups = remember(filtered, days) {
        filtered.groupBy { session ->
            when {
                session.updatedAtEpochMs <= 0 -> Str.historyUndated
                session.updatedAtEpochMs >= days.today -> Str.historyToday
                session.updatedAtEpochMs >= days.yesterday -> Str.historyYesterday
                session.updatedAtEpochMs >= days.week -> Str.historyWeek
                else -> Str.historyEarlier
            }
        }
    }

    Agent567MainPageScaffold(
        title = Str.sessionsTitle,
        actions = {
            NewConversationButton(onClick = onNewConversation)
            IconButton(
                onClick = onRefreshSessions,
                enabled = filterIndex != 1 || !desktopSessionsLoading,
            ) {
                Icon(Icons.Default.Refresh, contentDescription = Str.refreshSessions)
            }
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, top = 12.dp, end = 16.dp, bottom = 24.dp),

        ) {
            item {
                Column {
            Text(Str.mobileSessionsHint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.agent567Extra.secondaryText, modifier = Modifier.padding(bottom = 14.dp))
            Agent567TextField(
                value = query,
                onValueChange = onQueryChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text(Str.searchSessions) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            )
            Spacer(Modifier.height(12.dp))
            FilterChipRow(
                options = filters,
                selectedIndex = filterIndex,
                onSelect = onFilterChange,
            )
            if (filterIndex == 1 && !desktopSessionsError.isNullOrBlank()) {
                Text(
                    desktopSessionsError,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(vertical = 6.dp),
                )
            }
            if (filterIndex == 1 && !desktopSessionsWarning.isNullOrBlank()) {
                Text(
                    desktopSessionsWarning,
                    color = MaterialTheme.colorScheme.tertiary,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(vertical = 6.dp),
                )
            }
            operationError?.let { message ->
                androidx.compose.material3.Surface(color = MaterialTheme.colorScheme.errorContainer) {
                    Column(Modifier.fillMaxWidth().padding(12.dp)) {
                        Text(message, color = MaterialTheme.colorScheme.onErrorContainer)
                        androidx.compose.foundation.layout.Row {
                            androidx.compose.material3.TextButton(onClick = onRetryOperation) { Text(Str.retry) }
                            androidx.compose.material3.TextButton(onClick = onDismissOperationError) { Text(Str.close) }
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
                }
            }
            when {
                filtered.isEmpty() && filterIndex == 1 && desktopSessionsLoading -> item {
                    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                        CircularProgressIndicator()
                        Spacer(Modifier.height(12.dp))
                        Text(Str.loadingDesktopSessions, color = MaterialTheme.agent567Extra.secondaryText)
                    }
                }
                filtered.isEmpty() -> item {
                    EmptyState(
                        title = if (query.isBlank()) Str.noSessions else Str.noSessionsMatch,
                        subtitle = if (query.isBlank()) Str.noSessionsHint else null,
                        icon = Icons.Default.ChatBubbleOutline,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                else -> groups.forEach { (label, entries) ->
                    item(key = "group:$label") {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (label == Str.historyToday) {
                                Box(
                                    Modifier
                                        .size(7.dp)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.agent567Extra.amberAccent),
                                )
                            }
                            Text(
                                label,
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.agent567Extra.secondaryText,
                            )
                            Agent567AmberBadge("${entries.size}")
                        }
                    }
                    // Keep each conversation lazy even when thousands fall into the same date bucket.
                    itemsIndexed(entries, key = { _, entry -> "session:${entry.id}" }, contentType = { _, _ -> "session" }) { index, item ->
                        val top = if (index == 0) 16.dp else 0.dp
                        val bottom = if (index == entries.lastIndex) 16.dp else 0.dp
                        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(top, top, bottom, bottom))
                            .background(MaterialTheme.colorScheme.surface).padding(horizontal = 10.dp)) {
                            ListRow(
                                title = item.title,
                                leading = {
                                    MobileIconTile(
                                        icon = if (item.isCloud) Icons.Default.CloudQueue else Icons.Default.Computer,
                                        accent = item.isCloud,
                                    )
                                },
                                subtitle = "${item.sourceLabel} · ${item.timeLabel}",
                                trailing = {
                                    Box {
                                        IconButton(onClick = { openMenuSessionId = item.id }) {
                                            Icon(
                                                Icons.Default.MoreVert,
                                                contentDescription = Str.sessionActions,
                                                tint = MaterialTheme.agent567Extra.secondaryText,
                                            )
                                        }
                                        DropdownMenu(
                                            expanded = openMenuSessionId == item.id,
                                            onDismissRequest = { openMenuSessionId = null },
                                        ) {
                                            if (item.remoteSessionId == null) {
                                                DropdownMenuItem(
                                                    text = { Text(Str.rename) },
                                                    leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                                                    onClick = {
                                                        openMenuSessionId = null
                                                        renameTitle = item.title
                                                        renameTarget = item
                                                    },
                                                )
                                            }
                                            DropdownMenuItem(
                                                text = { Text(Str.delete) },
                                                leadingIcon = { Icon(Icons.Default.DeleteOutline, contentDescription = null) },
                                                onClick = {
                                                    openMenuSessionId = null
                                                    if (confirmBeforeDelete) {
                                                        deleteTarget = item
                                                    } else {
                                                        onDeleteSession(item.id)
                                                    }
                                                },
                                            )
                                        }
                                    }
                                },
                                onClick = { onOpenSession(item) },
                                showDivider = index < entries.lastIndex,
                            )
                        }
                    }
                }
            }
        }
    }

    renameTarget?.let { target ->
        Agent567TextInputDialog(
            title = Str.renameSession,
            value = renameTitle,
            label = Str.sessionName,
            onValueChange = { renameTitle = it },
            onConfirm = {
                onRenameSession(target.id, renameTitle)
                renameTarget = null
            },
            onDismiss = { renameTarget = null },
        )
    }

    deleteTarget?.let { target ->
        Agent567ConfirmDialog(
            destructive = true,
            title = Str.deleteSession,
            message = Str.deleteSessionConfirm,
            confirmLabel = Str.delete,
            onConfirm = {
                onDeleteSession(target.id)
                deleteTarget = null
            },
            onDismiss = { deleteTarget = null },
        )
    }
}
