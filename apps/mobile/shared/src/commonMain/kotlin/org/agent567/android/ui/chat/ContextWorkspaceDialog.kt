package org.agent567.android.ui.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.session.ContextWorkspaceSnapshot
import org.agent567.android.domain.session.ContextWorkspaceTurn
import org.agent567.android.ui.components.Agent567Card
import org.agent567.android.ui.components.ScrollableDetailDialog
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

internal enum class ContextTurnFilter { All, Included, Excluded, Summarized, BeforeReset }

internal data class EvaluatedContextTurn(
    val turn: ContextWorkspaceTurn,
    val effectiveStatus: String,
    val isExcluded: Boolean,
    val isReadOnly: Boolean,
    val isModified: Boolean,
)

internal data class ContextWorkspaceSummary(
    val evaluatedTurns: List<EvaluatedContextTurn>,
    val includedCount: Int,
    val summarizedCount: Int,
    val excludedCount: Int,
    val beforeResetCount: Int,
    val modifiedTurnCount: Int,
    val pinnedChanged: Boolean,
    val exclusionChanged: Boolean,
    val changeCount: Int,
    val summaryWillRebuild: Boolean,
)

internal fun summarizeContextWorkspace(
    snapshot: ContextWorkspaceSnapshot,
    pinned: String,
    excluded: List<String>,
): ContextWorkspaceSummary {
    val visibleTurns = snapshot.turns.asReversed().take(100)
    val excludedDraft = excluded.toHashSet()
    val excludedSaved = snapshot.excludedTurnIds.toHashSet()
    var includedCount = 0
    var summarizedCount = 0
    var excludedCount = 0
    var beforeResetCount = 0
    var modifiedTurnCount = 0
    val evaluatedTurns = visibleTurns.map { turn ->
        val isReadOnly = turn.status == "before_reset"
        val isExcluded = !isReadOnly && turn.id in excludedDraft
        val wasExcluded = !isReadOnly && turn.id in excludedSaved
        val isModified = isExcluded != wasExcluded
        if (isModified) modifiedTurnCount++
        val effectiveStatus = when {
            isReadOnly -> "before_reset"
            isExcluded -> "excluded"
            turn.status == "summarized" -> "summarized"
            else -> "included"
        }
        when (effectiveStatus) {
            "before_reset" -> beforeResetCount++
            "excluded" -> excludedCount++
            "summarized" -> summarizedCount++
            else -> includedCount++
        }
        EvaluatedContextTurn(turn, effectiveStatus, isExcluded, isReadOnly, isModified)
    }
    val pinnedChanged = pinned != snapshot.pinnedText
    val exclusionChanged = excludedDraft != excludedSaved
    return ContextWorkspaceSummary(
        evaluatedTurns = evaluatedTurns,
        includedCount = includedCount,
        summarizedCount = summarizedCount,
        excludedCount = excludedCount,
        beforeResetCount = beforeResetCount,
        modifiedTurnCount = modifiedTurnCount,
        pinnedChanged = pinnedChanged,
        exclusionChanged = exclusionChanged,
        changeCount = modifiedTurnCount + if (pinnedChanged) 1 else 0,
        summaryWillRebuild = exclusionChanged && (snapshot.summary.isNotBlank() || snapshot.previousSummary.isNotBlank()),
    )
}

internal fun filterEvaluatedContextTurns(
    turns: List<EvaluatedContextTurn>,
    filter: ContextTurnFilter,
    query: String,
): List<EvaluatedContextTurn> {
    val needle = query.trim().lowercase()
    return turns.filter { item ->
        val filterMatch = when (filter) {
            ContextTurnFilter.All -> true
            ContextTurnFilter.Included -> item.effectiveStatus == "included"
            ContextTurnFilter.Excluded -> item.effectiveStatus == "excluded"
            ContextTurnFilter.Summarized -> item.effectiveStatus == "summarized"
            ContextTurnFilter.BeforeReset -> item.effectiveStatus == "before_reset"
        }
        if (!filterMatch) return@filter false
        if (needle.isEmpty()) return@filter true
        item.turn.text.lowercase().contains(needle) || item.turn.attachments.any { it.lowercase().contains(needle) }
    }
}

@Composable
internal fun WorkbenchStatusBadge(
    label: String,
    containerColor: Color = MaterialTheme.agent567Extra.chipBackground,
    contentColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    tabular: Boolean = false,
) {
    Surface(shape = RoundedCornerShape(999.dp), color = containerColor) {
        val baseStyle = MaterialTheme.typography.labelSmall
        Text(
            text = label,
            style = if (tabular) baseStyle.copy(fontFeatureSettings = "tnum") else baseStyle,
            color = contentColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
internal fun ContextWorkspaceBody(
    snapshot: ContextWorkspaceSnapshot,
    busy: Boolean,
    pinned: String,
    excluded: List<String>,
    pendingAttachmentCount: Int = 0,
    onPinnedChange: (String) -> Unit,
    onToggleVisible: (List<String>, Boolean) -> Unit,
) {
    var compare by remember { mutableStateOf(false) }
    var query by remember(snapshot.sessionId) { mutableStateOf("") }
    var filter by remember(snapshot.sessionId) { mutableStateOf(ContextTurnFilter.All) }
    var pinnedExpanded by remember(snapshot.sessionId) { mutableStateOf(pinned.isNotBlank()) }
    LaunchedEffect(pinned.isNotEmpty()) {
        if (pinned.isNotEmpty()) pinnedExpanded = true
    }
    val expandedTurns = remember(snapshot.sessionId) { mutableStateMapOf<String, Boolean>() }
    val summary = remember(snapshot, pinned, excluded) { summarizeContextWorkspace(snapshot, pinned, excluded) }
    val filteredTurns = remember(summary, filter, query) { filterEvaluatedContextTurns(summary.evaluatedTurns, filter, query) }
    val selectableIds = remember(filteredTurns) { filteredTurns.filterNot { it.isReadOnly }.map { it.turn.id } }
    val readOnly = busy || snapshot.busy
    val dirty = summary.changeCount > 0

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Agent567Card(accentBorder = dirty, contentPadding = PaddingValues(14.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(Str.contextNextSendTitle, style = MaterialTheme.typography.titleSmall)
                when {
                    readOnly -> WorkbenchStatusBadge(
                        Str.workbenchReadOnly,
                        MaterialTheme.agent567Extra.amberContainer,
                        MaterialTheme.agent567Extra.amberAccent,
                    )
                    dirty -> WorkbenchStatusBadge(
                        Str.contextUnsavedBadge,
                        MaterialTheme.agent567Extra.amberContainer,
                        MaterialTheme.agent567Extra.amberAccent,
                    )
                    else -> WorkbenchStatusBadge(
                        Str.contextSyncedBadge,
                        MaterialTheme.agent567Extra.success.copy(alpha = 0.14f),
                        MaterialTheme.agent567Extra.success,
                    )
                }
            }
            if (readOnly) {
                Spacer(Modifier.height(6.dp))
                Text(Str.contextReadOnlyRunning, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.amberAccent)
            }
            Spacer(Modifier.height(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val turnBreakdown = buildList {
                    add("${summary.summarizedCount} ${Str.contextSummaryUnit}")
                    add("${summary.excludedCount} ${Str.contextExcludedUnit}")
                    if (summary.beforeResetCount > 0) add("${summary.beforeResetCount} ${Str.contextBeforeResetUnit}")
                }.joinToString(" · ")
                SummaryMetricRow(
                    label = Str.contextNextSendTurns,
                    value = "${summary.includedCount} / ${summary.evaluatedTurns.size} ${Str.contextTurnsUnit}（$turnBreakdown）",
                )
                SummaryMetricRow(
                    label = Str.contextNextSendPinned,
                    value = if (pinned.trim().isNotEmpty()) "${pinned.trim().length} ${Str.contextCharsUnit}" else Str.contextNextSendUnset,
                )
                SummaryMetricRow(
                    label = Str.contextNextSendSummary,
                    value = when {
                        summary.summaryWillRebuild -> Str.contextNextSendSummaryRebuild
                        snapshot.summary.isNotBlank() -> Str.contextNextSendSummaryActive
                        else -> Str.contextNextSendSummaryNone
                    },
                    valueColor = if (summary.summaryWillRebuild) MaterialTheme.agent567Extra.amberAccent else MaterialTheme.colorScheme.onSurface,
                )
                if (pendingAttachmentCount > 0) {
                    SummaryMetricRow(
                        label = Str.contextNextSendDraftFiles,
                        value = "$pendingAttachmentCount ${Str.contextPendingUnit}",
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = if (summary.summaryWillRebuild) Str.contextSaveImpactRebuild else Str.contextSaveImpact,
                style = MaterialTheme.typography.bodySmall,
                color = if (summary.summaryWillRebuild) MaterialTheme.agent567Extra.amberAccent else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Agent567Card(contentPadding = PaddingValues(14.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                    Text(Str.contextPinned, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    WorkbenchStatusBadge("${pinned.length} / 16,000", tabular = true)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (pinned.isNotEmpty() && !readOnly) {
                        TextButton(onClick = { onPinnedChange("") }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                            Text(Str.contextClearPinned)
                        }
                    }
                    TextButton(onClick = { pinnedExpanded = !pinnedExpanded }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                        Text(if (pinnedExpanded) Str.collapse else Str.contextEditSection)
                    }
                }
            }
            if (pinnedExpanded) {
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = pinned,
                    onValueChange = { if (it.length <= 16000) onPinnedChange(it) },
                    label = { Text(Str.contextPinned) },
                    minLines = 3,
                    maxLines = 6,
                    enabled = !readOnly,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (snapshot.summary.isNotBlank() || snapshot.previousSummary.isNotBlank()) {
            Agent567Card(contentPadding = PaddingValues(14.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(Str.contextCompareSummary, style = MaterialTheme.typography.titleSmall)
                        WorkbenchStatusBadge(Str.workbenchReadOnly)
                    }
                    TextButton(onClick = { compare = true }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                        Text(Str.contextShowSummary)
                    }
                }
                if (snapshot.summary.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(snapshot.summary, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        Text(
            "${Str.contextWorkspaceTurns}：${summary.evaluatedTurns.size} / ${snapshot.totalTurns}",
            style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
        )
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            singleLine = true,
            label = { Text(Str.contextSearchTurns) },
            trailingIcon = if (query.isNotEmpty()) {
                {
                    IconButton(onClick = { query = "" }) {
                        Icon(Icons.Default.Close, contentDescription = Str.contextClearSearch)
                    }
                }
            } else {
                null
            },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val filters = buildList {
                add(ContextTurnFilter.All to "${Str.contextFilterAll} (${summary.evaluatedTurns.size})")
                add(ContextTurnFilter.Included to "${Str.contextFilterIncluded} (${summary.includedCount})")
                add(ContextTurnFilter.Excluded to "${Str.contextFilterExcluded} (${summary.excludedCount})")
                add(ContextTurnFilter.Summarized to "${Str.contextFilterSummarized} (${summary.summarizedCount})")
                if (summary.beforeResetCount > 0) add(ContextTurnFilter.BeforeReset to "${Str.contextFilterBeforeReset} (${summary.beforeResetCount})")
            }
            filters.forEach { (item, label) ->
                FilterChip(
                    selected = filter == item,
                    onClick = { filter = item },
                    label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(
                onClick = { onToggleVisible(selectableIds, true) },
                enabled = !readOnly && selectableIds.any { it in excluded },
            ) { Text(Str.contextIncludeShown) }
            TextButton(
                onClick = { onToggleVisible(selectableIds, false) },
                enabled = !readOnly && selectableIds.any { it !in excluded },
            ) { Text(Str.contextExcludeShown) }
        }
        if (filteredTurns.isEmpty()) {
            val hasActiveFilter = filter != ContextTurnFilter.All || query.isNotBlank()
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    if (hasActiveFilter) Str.contextNoMatchingTurns else Str.workbenchEmpty,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (hasActiveFilter) {
                    TextButton(onClick = { filter = ContextTurnFilter.All; query = "" }) {
                        Text(Str.contextResetFilter)
                    }
                }
            }
        }
        filteredTurns.forEach { item ->
            val turn = item.turn
            val expanded = expandedTurns[turn.id] == true
            Surface(
                shape = MaterialTheme.shapes.medium,
                color = if (item.isExcluded) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border.copy(alpha = if (item.isExcluded) 0.5f else 0.85f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Checkbox(
                            modifier = Modifier.alpha(if (item.isReadOnly || item.isExcluded) 0.5f else 1f),
                            checked = !item.isReadOnly && !item.isExcluded,
                            enabled = !readOnly && !item.isReadOnly,
                            onCheckedChange = { checked -> onToggleVisible(listOf(turn.id), checked) },
                        )
                        FlowRow(
                            modifier = Modifier.weight(1f),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            when (item.effectiveStatus) {
                                "before_reset" -> WorkbenchStatusBadge(Str.contextTurnBeforeReset)
                                "excluded" -> WorkbenchStatusBadge(Str.contextTurnExcluded)
                                "summarized" -> WorkbenchStatusBadge(
                                    Str.contextTurnSummarized,
                                    MaterialTheme.agent567Extra.amberContainer,
                                    MaterialTheme.agent567Extra.amberAccent,
                                )
                                else -> WorkbenchStatusBadge(
                                    Str.contextTurnIncluded,
                                    MaterialTheme.agent567Extra.success.copy(alpha = 0.14f),
                                    MaterialTheme.agent567Extra.success,
                                )
                            }
                            if (item.isModified) {
                                WorkbenchStatusBadge(
                                    Str.contextModifiedBadge,
                                    MaterialTheme.agent567Extra.amberContainer,
                                    MaterialTheme.agent567Extra.amberAccent,
                                )
                            }
                            if (turn.attachments.isNotEmpty()) {
                                WorkbenchStatusBadge("${turn.attachments.size} ${Str.contextAttachmentsUnit}", tabular = true)
                            }
                        }
                        TextButton(
                            onClick = { expandedTurns[turn.id] = !expanded },
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        ) { Text(if (expanded) Str.collapse else Str.expand) }
                    }
                    val previewText = turn.text.ifBlank { Str.contextAttachmentTurn }
                    if (expanded) {
                        SelectionContainer {
                            Text(previewText, style = MaterialTheme.typography.bodyMedium)
                        }
                        if (turn.attachments.isNotEmpty()) {
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                turn.attachments.forEach { path ->
                                    Text(path, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        if (turn.text.isNotBlank()) {
                            val alreadyPinned = pinned.contains(turn.text)
                            val canPin = !readOnly && !alreadyPinned && pinned.length + turn.text.length + 2 <= 16000
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                OutlinedButton(
                                    onClick = { onPinnedChange(listOf(pinned, turn.text).filter(String::isNotBlank).joinToString("\n\n")) },
                                    enabled = canPin,
                                ) {
                                    Text(if (alreadyPinned) Str.contextAlreadyPinned else Str.contextPinPreview)
                                }
                            }
                        }
                    } else {
                        Text(
                            text = previewText,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (item.isExcluded) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }
    }
    if (compare) ScrollableDetailDialog(Str.contextCompareSummary, { compare = false }) {
        Text(Str.contextShowSummary, style = MaterialTheme.typography.titleMedium)
        SelectionContainer { Text(snapshot.summary.ifBlank { Str.contextNoSummary }) }
        HorizontalDivider()
        Text(Str.contextPreviousSummary, style = MaterialTheme.typography.titleMedium)
        SelectionContainer { Text(snapshot.previousSummary.ifBlank { Str.contextNoSummary }) }
    }
}

@Composable
private fun SummaryMetricRow(
    label: String,
    value: String,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(
            value,
            style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
            color = valueColor,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(1.5f, fill = false),
        )
    }
}
