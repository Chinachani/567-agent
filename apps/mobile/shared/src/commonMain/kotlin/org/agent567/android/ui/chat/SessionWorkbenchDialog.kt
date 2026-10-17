package org.agent567.android.ui.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.session.*
import org.agent567.android.ui.components.ScrollableDetailDialog
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.media.*

@Composable
internal fun SessionWorkbenchDialog(
    desktop: Boolean,
    context: ContextWorkspaceSnapshot?,
    snapshot: SessionWorkbenchSnapshot?,
    collaboration: ProjectCollaborationSnapshot?,
    collaborationLoading: Boolean,
    collaborationError: String?,
    detail: SessionWorkbenchDetail?,
    messages: List<LocalMessage>,
    pendingFiles: List<PendingFileAttachment>,
    pendingImages: List<MessageImage>,
    busy: Boolean,
    loading: Boolean,
    error: String?,
    onSaveContext: (ContextWorkspaceSnapshot) -> Unit,
    onRefresh: () -> Unit,
    onRefreshCollaboration: () -> Unit,
    onControlCollaboration: (ProjectCollaborationControl) -> Unit,
    onSelect: (String, String) -> Unit,
    onScope: (String, String) -> Unit,
    onRemoveFile: (String) -> Unit,
    onRemoveImage: (String) -> Unit,
    readOriginal: suspend (String) -> ByteArray,
    onDismiss: () -> Unit,
) {
    var tab by remember { mutableIntStateOf(0) }
    var selectedPending by remember { mutableStateOf<String?>(null) }
    var selectedDetail by remember { mutableStateOf<Pair<String, String>?>(null) }
    var confirmDiscard by remember { mutableStateOf(false) }
    var saveNotice by remember { mutableStateOf<String?>(null) }
    val save = rememberOriginalAttachmentSaver(readOriginal) { saveNotice = it }
    var pinned by remember(context?.sessionId, context?.revision) { mutableStateOf(context?.pinnedText.orEmpty()) }
    var excluded by remember(context?.sessionId, context?.revision) { mutableStateOf(context?.excludedTurnIds.orEmpty()) }
    var savingContext by remember { mutableStateOf<Pair<String, Long>?>(null) }
    LaunchedEffect(context?.sessionId, context?.revision, error) {
        if (savingContext != null && (context?.let { it.sessionId to it.revision } != savingContext || error != null)) savingContext = null
    }
    val currentContextKey = context?.let { it.sessionId to it.revision }
    val savingDraft = currentContextKey != null && savingContext == currentContextKey
    val dirty = context != null && (pinned != context.pinnedText || excluded.toSet() != context.excludedTurnIds.toSet())
    val saveEnabled = context != null && dirty && !busy && !context.busy && !savingDraft
    val selected = detail?.takeIf { selectedDetail == (it.kind to it.id) }
    val requestClose = {
        when {
            savingDraft -> Unit
            dirty -> confirmDiscard = true
            else -> onDismiss()
        }
    }

    ScrollableDetailDialog(
        title = Str.workbenchTitle,
        onDismiss = requestClose,
        header = {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
                (listOf(Str.workbenchContext, Str.workbenchAttachments, Str.workbenchTasks, Str.workbenchChanges) + if (desktop) listOf(Str.collaborationTitle) else emptyList()).forEachIndexed { index, title ->
                    SegmentedButton(selected = tab == index, onClick = { tab = index; selectedDetail = null }, shape = SegmentedButtonDefaults.itemShape(index, 4), icon = {}) {
                        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        },
        footer = {
            if (tab == 0 && context != null) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (dirty) Text(Str.workbenchUnsaved, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { pinned = context.pinnedText; excluded = context.excludedTurnIds }, enabled = dirty && !busy && !context.busy && !savingDraft, modifier = Modifier.weight(1f)) { Text(Str.workbenchResetDraft) }
                        Button(onClick = { savingContext = context.sessionId to context.revision; onSaveContext(context.copy(pinnedText = pinned, excludedTurnIds = excluded)) }, enabled = saveEnabled, modifier = Modifier.weight(1f)) {
                            Text(if (savingDraft || busy) Str.contextWorking else Str.contextSaveSelection)
                        }
                    }
                }
            } else if (tab == 4 && desktop) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val paused = collaboration?.config?.paused == true
                    OutlinedButton(onClick = { onControlCollaboration(ProjectCollaborationControl(if (paused) "resume" else "pause")) }, enabled = !collaborationLoading && collaboration?.config?.enabled == true) {
                        Text(if (paused) Str.collaborationResume else Str.collaborationPause)
                    }
                    TextButton(onClick = onRefreshCollaboration, enabled = !collaborationLoading) { Text(Str.contextRefresh) }
                }
            } else if (tab != 0) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onRefresh, enabled = !loading) { Text(Str.contextRefresh) }
                }
            }
        },
    ) {
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (tab == 0) {
            if (context != null) {
                ContextWorkspaceBody(
                    snapshot = context,
                    busy = busy || savingDraft,
                    pinned = pinned,
                    excluded = excluded,
                    onPinnedChange = { pinned = it },
                    onToggleVisible = { ids, include ->
                        excluded = if (include) excluded - ids.toSet() else (excluded + ids).distinct()
                    },
                )
            } else Text(Str.contextSendFirst)
        } else {
            when (tab) {
                1 -> AttachmentList(
                    desktop, pendingFiles, pendingImages, snapshot, busy,
                    onOpenPending = { selectedPending = it },
                    onRemoveFile = onRemoveFile,
                    onRemoveImage = onRemoveImage,
                    onSelect = { kind, id -> selectedDetail = kind to id; onSelect(kind, id) },
                    onScope = onScope,
                )
                2 -> TaskList(snapshot, onSelect = { id -> selectedDetail = "task" to id; onSelect("task", id) })
                3 -> ChangeList(snapshot, onSelect = { id -> selectedDetail = "change" to id; onSelect("change", id) })
                4 -> if (desktop) CollaborationList(collaboration, collaborationError, collaborationLoading, onControlCollaboration) else Unit
            }
        }
    }

    selectedDetail?.let { (kind, id) ->
        val item = selected
        ScrollableDetailDialog(
            title = item?.title ?: Str.workbenchDetailTitle,
            onDismiss = { selectedDetail = null },
            header = {
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
                if (error != null) Text(error, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), color = MaterialTheme.colorScheme.error)
            },
            footer = if (kind == "attachment") {
                {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        saveNotice?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        if (desktop) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            Button(onClick = { item?.let { save(it.id, it.title) } }, enabled = item != null && item.previewStatus != "unavailable") { Text(Str.workbenchSaveOriginal) }
                        }
                    }
                }
            } else null,
        ) {
            if (item == null && !loading && error == null) {
                Text(Str.workbenchDetailUnavailable, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (item != null) {
                item.path?.takeIf(String::isNotBlank)?.let { SelectionContainer { Text(it, style = MaterialTheme.typography.bodySmall) } }
                if (item.kind == "attachment") {
                    Text(when (item.previewStatus) { "text" -> Str.workbenchTextPreview; "binary" -> Str.workbenchBinaryPreview; else -> Str.workbenchUnavailable }, style = MaterialTheme.typography.bodySmall)
                    messages.flatMap { it.images }.firstOrNull { it.id == item.id }?.let { WorkbenchImage(it) }
                }
                if (item.text.isNotBlank()) SelectionContainer { Text(item.text, style = MaterialTheme.typography.bodyMedium) }
                if (item.kind == "task") {
                    val start = messages.indexOfFirst { it.id == item.id }
                    if (start >= 0) messages.drop(start + 1).takeWhile { it.role != org.agent567.android.core.model.ChatRole.User }.flatMap { it.images }.take(6).forEach { WorkbenchImage(it) }
                }
                if (item.kind == "change") {
                    item.beforeText?.let { Text(Str.workbenchBefore, style = MaterialTheme.typography.titleSmall); SelectionContainer { Text(it) } }
                    item.afterText?.let { Text(Str.workbenchAfter, style = MaterialTheme.typography.titleSmall); SelectionContainer { Text(it) } }
                    if (item.reversible) Text(Str.workbenchChangeHint, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }

    if (confirmDiscard) AlertDialog(
        onDismissRequest = { confirmDiscard = false },
        title = { Text(Str.workbenchDiscardTitle) },
        text = { Text(Str.workbenchDiscardMessage) },
        confirmButton = { TextButton(onClick = { confirmDiscard = false; onDismiss() }) { Text(Str.workbenchDiscard) } },
        dismissButton = { TextButton(onClick = { confirmDiscard = false }) { Text(Str.workbenchContinueEditing) } },
    )

    selectedPending?.let { id ->
        ScrollableDetailDialog(Str.workbenchAttachmentPreview, { selectedPending = null }) {
            pendingImages.firstOrNull { it.id == id }?.let { WorkbenchImage(it) }
            pendingFiles.firstOrNull { it.id == id }?.let { file ->
                Text(file.fileName, style = MaterialTheme.typography.titleMedium)
                val text = remember(file.id) { if (file.mimeType.startsWith("text/") || file.mimeType.contains("json") || file.mimeType.contains("xml")) file.bytes.copyOfRange(0, minOf(file.bytes.size, 32768)).decodeToString().takeIf { '\u0000' !in it } else null }
                Text(if (text == null) Str.workbenchBinaryPreview else Str.workbenchTextPreview, style = MaterialTheme.typography.bodySmall)
                if (text != null) SelectionContainer { Text(text) }
            }
        }
    }
}

@Composable
private fun CollaborationList(
    snapshot: ProjectCollaborationSnapshot?,
    error: String?,
    loading: Boolean,
    onControl: (ProjectCollaborationControl) -> Unit,
) {
    if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
    if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    snapshot?.let { data ->
        var showAllTasks by remember(data.cwd, data.tasks.size) { mutableStateOf(false) }
        var expandedTaskId by remember(data.cwd) { mutableStateOf<String?>(null) }
        val candidatesById = data.candidates.associateBy { it.sessionId }
        fun candidateName(sessionId: String): String = candidatesById[sessionId]?.title?.takeIf(String::isNotBlank) ?: sessionId
        fun candidateState(state: String): String = when (state) {
            "running" -> Str.collaborationCandidateRunning
            "idle" -> Str.collaborationCandidateIdle
            "unavailable" -> Str.collaborationCandidateUnavailable
            else -> Str.collaborationCandidateUnknown
        }
        Text(
            Str.collaborationProjectStatus + ": " + when {
                !data.config.enabled -> Str.collaborationDisabled
                data.config.paused -> Str.collaborationPaused
                else -> Str.collaborationEnabled
            },
            style = MaterialTheme.typography.titleSmall,
        )
        if (data.config.members.isNotEmpty()) {
            Text(Str.collaborationMembers, style = MaterialTheme.typography.labelMedium)
            data.config.members.forEach { member ->
                val candidate = candidatesById[member.sessionId]
                Column(Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(candidate?.title?.takeIf(String::isNotBlank) ?: member.sessionId, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                        Text(if (member.access == "write") Str.collaborationWriteAccess else Str.collaborationReadAccess, style = MaterialTheme.typography.labelSmall)
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(member.responsibility, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall)
                        Text(buildString {
                            append(candidate?.model?.takeIf(String::isNotBlank) ?: Str.collaborationModelUnknown)
                            append(" · ")
                            append(candidate?.let { candidateState(it.state) } ?: Str.collaborationCandidateUnavailable)
                        }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        Text(Str.collaborationTasks, style = MaterialTheme.typography.labelMedium)
        if (data.tasks.isEmpty()) Text(Str.workbenchEmpty, style = MaterialTheme.typography.bodySmall)
        val recentTasks = data.tasks.asReversed().sortedBy { if (it.status in setOf("queued", "running", "waiting")) 0 else 1 }
        val visibleTasks = if (showAllTasks) recentTasks else recentTasks.take(8)
        visibleTasks.forEach { task ->
            val expanded = expandedTaskId == task.id
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Column(Modifier.weight(1f)) {
                    TextButton(onClick = { expandedTaskId = if (expanded) null else task.id }, contentPadding = PaddingValues(0.dp)) {
                        val sourceTarget = "${candidateName(task.sourceSessionId)} → ${candidateName(task.targetSessionId)}"
                        Text(if (task.kind == "result") "${Str.collaborationMemberResult} · $sourceTarget" else sourceTarget, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall)
                    }
                    if (task.kind != "result") Text(task.objective, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                    Text(
                        when (task.status) {
                            "running" -> Str.workbenchTaskRunning
                            "waiting" -> Str.collaborationWaiting
                            "completed" -> Str.workbenchTaskCompleted
                            "failed" -> Str.workbenchTaskFailed
                            "interrupted" -> Str.workbenchTaskInterrupted
                            "queued" -> Str.collaborationQueued
                            "cancelled" -> Str.collaborationCancelled
                            "attention" -> Str.collaborationAttention
                            else -> task.status
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (expanded) {
                        if (task.kind != "result") {
                            Text(Str.collaborationObjective, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            SelectionContainer { Text(task.objective, style = MaterialTheme.typography.bodySmall) }
                        }
                        task.result?.takeIf(String::isNotBlank)?.let {
                            Text(Str.collaborationResult, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            SelectionContainer { Text(it, style = MaterialTheme.typography.bodySmall) }
                        }
                        task.error?.takeIf(String::isNotBlank)?.let {
                            Text(Str.collaborationError, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                            SelectionContainer { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                        }
                    }
                }
                if (task.status == "running" || task.status == "waiting" || task.status == "queued") TextButton(onClick = { onControl(ProjectCollaborationControl("stop", task.id)) }, enabled = !loading) { Text(Str.collaborationStop) }
                if (task.status in setOf("attention", "failed", "interrupted", "cancelled")) TextButton(onClick = { onControl(ProjectCollaborationControl("continue", task.id)) }, enabled = !loading) { Text(Str.collaborationContinue) }
            }
            HorizontalDivider()
        }
        if (recentTasks.size > 8) TextButton(onClick = { showAllTasks = !showAllTasks }, modifier = Modifier.fillMaxWidth()) {
            Text(if (showAllTasks) Str.collaborationShowRecent else Str.collaborationShowAllPrefix + recentTasks.size + Str.collaborationShowAllSuffix)
        }
    }
}

@Composable
private fun AttachmentList(
    desktop: Boolean,
    pendingFiles: List<PendingFileAttachment>,
    pendingImages: List<MessageImage>,
    snapshot: SessionWorkbenchSnapshot?,
    busy: Boolean,
    onOpenPending: (String) -> Unit,
    onRemoveFile: (String) -> Unit,
    onRemoveImage: (String) -> Unit,
    onSelect: (String, String) -> Unit,
    onScope: (String, String) -> Unit,
) {
    Text(Str.workbenchAttachmentHint, style = MaterialTheme.typography.bodySmall)
    if (pendingFiles.isNotEmpty() || pendingImages.isNotEmpty()) Text(Str.workbenchPending, style = MaterialTheme.typography.titleMedium)
    pendingImages.forEach { image ->
        Row(Modifier.fillMaxWidth()) {
            TextButton(onClick = { onOpenPending(image.id) }, modifier = Modifier.weight(1f)) { Text(image.fileName ?: Str.modelCapabilityImage) }
            TextButton(onClick = { onRemoveImage(image.id) }, enabled = !busy) { Text(Str.workbenchRemove) }
        }
    }
    if (pendingFiles.isNotEmpty()) Text(Str.workbenchDraft, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
    pendingFiles.forEach { file ->
        ContextGroup {
            TextButton(onClick = { onOpenPending(file.id) }) { Text("${file.fileName} · ${file.bytes.size} bytes") }
            OutlinedTextField(file.readScope, { onScope(file.id, it) }, enabled = !busy, label = { Text(Str.workbenchReadScope) }, modifier = Modifier.fillMaxWidth())
            TextButton(onClick = { onRemoveFile(file.id) }, enabled = !busy) { Text(Str.workbenchRemove) }
        }
    }
    Text(Str.workbenchHistoryAttachments, style = MaterialTheme.typography.titleMedium)
    snapshot?.attachments?.forEach { file -> TextButton(onClick = { onSelect("attachment", file.id) }, modifier = Modifier.fillMaxWidth()) { Text(file.name) } }
    if (snapshot?.attachments?.isEmpty() == true) Text(Str.workbenchEmpty)
}

@Composable
private fun TaskList(snapshot: SessionWorkbenchSnapshot?, onSelect: (String) -> Unit) {
    Text(Str.workbenchTaskHint, style = MaterialTheme.typography.bodySmall)
    snapshot?.tasks?.forEach { task ->
        Surface(onClick = { onSelect(task.id) }, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(task.title.ifBlank { Str.contextAttachmentTurn }, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${taskStatus(task.status)} · ${task.durationMs?.let { "${it / 1000.0}s" } ?: "—"} · ${task.toolCount} ${Str.workbenchToolCalls}", style = MaterialTheme.typography.labelMedium)
                Text(formatLocalMessageTime(task.timestamp), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    if (snapshot?.tasks?.isEmpty() == true) Text(Str.workbenchEmpty)
}

@Composable
private fun ChangeList(snapshot: SessionWorkbenchSnapshot?, onSelect: (String) -> Unit) {
    Text(Str.workbenchChangeHint, style = MaterialTheme.typography.bodySmall)
    snapshot?.changes?.forEach { change -> TextButton(onClick = { onSelect(change.id) }, modifier = Modifier.fillMaxWidth()) { Text(change.path.ifBlank { change.id }) } }
    if (snapshot?.changes?.isEmpty() != false) Text(Str.workbenchEmpty)
}

@Composable
private fun WorkbenchImage(image: MessageImage) {
    when (val state = rememberMessageImageBitmap(image)) {
        is MessageImageLoadState.Loaded -> Image(state.bitmap, image.fileName, Modifier.fillMaxWidth().heightIn(max = 420.dp))
        MessageImageLoadState.Loading -> LinearProgressIndicator(Modifier.fillMaxWidth())
        else -> Text(Str.workbenchUnavailable)
    }
}

private fun taskStatus(value: String) = when (value) {
    "completed" -> Str.workbenchTaskCompleted
    "failed" -> Str.workbenchTaskFailed
    "running" -> Str.workbenchTaskRunning
    else -> Str.workbenchTaskInterrupted
}
