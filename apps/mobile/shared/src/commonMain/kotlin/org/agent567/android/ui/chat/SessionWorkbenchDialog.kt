package org.agent567.android.ui.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.session.*
import org.agent567.android.ui.components.Agent567Card
import org.agent567.android.ui.components.ScrollableDetailDialog
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.media.*
import org.agent567.android.ui.theme.agent567Extra

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
    readThumbnail: suspend (String) -> String?,
    listFiles: suspend (String, Int) -> RemoteSessionFilePage = { _, _ -> throw RemoteFilesUnsupportedException() },
    readFile: suspend (String) -> RemoteSessionFileContent = { throw RemoteFilesUnsupportedException() },
    uploadFile: suspend (org.agent567.android.ui.media.PickedFileAttachment, (Int, Int) -> Unit) -> String = { _, _ -> throw RemoteFilesUnsupportedException() },
    onUseFilePath: (String) -> Unit = {},
    onDismiss: () -> Unit,
) {
    val tabs = listOf(Str.workbenchContext, Str.workbenchAttachments, Str.workbenchTasks, Str.workbenchChanges) + if (desktop) listOf(Str.collaborationTitle, Str.sessionFiles) else emptyList()
    var tab by remember(desktop) { mutableIntStateOf(0) }
    var selectedPending by remember { mutableStateOf<String?>(null) }
    var selectedDetail by remember { mutableStateOf<Pair<String, String>?>(null) }
    var confirmDiscard by remember { mutableStateOf(false) }
    var saveNotice by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(selectedPending, selectedDetail) { saveNotice = null }
    val originalReader: suspend (String) -> ByteArray = { id -> pendingFiles.firstOrNull { it.id == id }?.bytes ?: readOriginal(id) }
    val save = rememberOriginalAttachmentSaver(originalReader) { saveNotice = it }
    val opener = rememberOriginalAttachmentOpener(originalReader) { saveNotice = it }
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
            val pendingAttachmentTotal = pendingFiles.size + pendingImages.size + (snapshot?.attachments?.size ?: 0)
            val taskTotal = snapshot?.tasks?.size ?: 0
            val changeTotal = snapshot?.changes?.size ?: 0
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                tabs.forEachIndexed { index, title ->
                    val count = when (index) {
                        1 -> pendingAttachmentTotal
                        2 -> taskTotal
                        3 -> changeTotal
                        else -> 0
                    }
                    FilterChip(selected = tab == index, onClick = { tab = index; selectedDetail = null }, label = {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall)
                            if (index == 0 && dirty) {
                                Text("•", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.agent567Extra.amberAccent)
                            } else if (count > 0) {
                                Text("$count", style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    })
                }
            }
        },
        footer = when {
            tab == 0 && context != null -> {
                {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = when {
                            savingDraft || busy || context.busy -> Str.contextReadOnlyRunning
                            dirty -> Str.workbenchUnsaved
                            else -> Str.contextSaveImpact
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (dirty || savingDraft || busy || context.busy) MaterialTheme.agent567Extra.amberAccent else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { pinned = context.pinnedText; excluded = context.excludedTurnIds }, enabled = dirty && !busy && !context.busy && !savingDraft, modifier = Modifier.weight(1f)) { Text(Str.workbenchResetDraft) }
                        Button(onClick = { savingContext = context.sessionId to context.revision; onSaveContext(context.copy(pinnedText = pinned, excludedTurnIds = excluded)) }, enabled = saveEnabled, modifier = Modifier.weight(1f)) {
                            Text(if (savingDraft || busy) Str.contextWorking else Str.contextSaveSelection)
                        }
                    }
                }
                }
            }
            tab == 4 && desktop -> {
                {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val paused = collaboration?.config?.paused == true
                    OutlinedButton(onClick = { onControlCollaboration(ProjectCollaborationControl(if (paused) "resume" else "pause")) }, enabled = !collaborationLoading && collaboration?.config?.enabled == true) {
                        Text(if (paused) Str.collaborationResume else Str.collaborationPause)
                    }
                    TextButton(onClick = onRefreshCollaboration, enabled = !collaborationLoading) { Text(Str.contextRefresh) }
                }
                }
            }
            (tab == 0 && context == null && !loading) || tab in 1..3 -> {
                {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onRefresh, enabled = !loading) { Text(Str.contextRefresh) }
                }
                }
            }
            else -> null
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
                    pendingAttachmentCount = pendingFiles.size + pendingImages.size,
                    onPinnedChange = { pinned = it },
                    onToggleVisible = { ids, include ->
                        excluded = if (include) excluded - ids.toSet() else (excluded + ids).distinct()
                    },
                )
            } else Text(Str.contextSendFirst)
        } else {
            when (tab) {
                1 -> AttachmentList(
                    pendingFiles, pendingImages, snapshot, loading, busy,
                    onOpenPending = { selectedPending = it },
                    onRemoveFile = onRemoveFile,
                    onRemoveImage = onRemoveImage,
                    onSelect = { kind, id -> selectedDetail = kind to id; onSelect(kind, id) },
                    onScope = onScope,
                    images = messages.flatMap { it.images },
                    readThumbnail = readThumbnail,
                )
                2 -> TaskList(snapshot, loading, onSelect = { id -> selectedDetail = "task" to id; onSelect("task", id) })
                3 -> ChangeList(snapshot, onSelect = { id -> selectedDetail = "change" to id; onSelect("change", id) })
                4 -> if (desktop) CollaborationList(collaboration, collaborationError, collaborationLoading, onControlCollaboration) else Unit
                5 -> if (desktop) SessionFilesPane(listFiles, readFile, uploadFile, onUseFilePath) else Unit
            }
        }
    }

    selectedDetail?.let { (kind, id) ->
        val item = selected
        val taskMeta = if (kind == "task") snapshot?.tasks?.firstOrNull { it.id == id } else null
        val changeMeta = if (kind == "change") snapshot?.changes?.firstOrNull { it.id == id } else null
        ScrollableDetailDialog(
            title = item?.title ?: Str.workbenchDetailTitle,
            onDismiss = { selectedDetail = null },
            header = {
                if (item != null) {
                    FlowRow(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        WorkbenchStatusBadge(Str.workbenchReadOnly)
                        if (item.kind == "task" && taskMeta != null) {
                            TaskStatusBadge(taskMeta.status)
                        }
                        if (item.kind == "change") {
                            ChangeReviewBadges(changeMeta?.status ?: "pending", item.reversible)
                        }
                    }
                }
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
                if (error != null) Text(error, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), color = MaterialTheme.colorScheme.error)
            },
            footer = if (kind == "attachment" && (desktop || saveNotice != null)) {
                {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        saveNotice?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        if (desktop) {
                            val readable = item != null && item.previewStatus != "unavailable"
                            val transferable = readable && (item.sizeBytes ?: 0) <= MAX_MESSAGE_FILE_BYTES
                            if (readable && !transferable) Text(Str.workbenchOriginalTooLarge, style = MaterialTheme.typography.bodySmall)
                            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { item?.let { saveNotice = null; opener.open(it.id, it.title) } }, enabled = transferable && !opener.opening) { Text(if (opener.opening) Str.workbenchOpening else Str.workbenchOpenOriginal) }
                                Button(onClick = { item?.let { saveNotice = null; save(it.id, it.title) } }, enabled = transferable && !opener.opening) { Text(Str.workbenchSaveOriginal) }
                            }
                        }
                    }
                }
            } else null,
        ) {
            if (item == null && !loading && error == null) {
                Text(Str.workbenchDetailUnavailable, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (item != null) {
                item.path?.takeIf(String::isNotBlank)?.let {
                    SelectionContainer {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (item.kind == "attachment") {
                    val previewHint = when (item.previewStatus) {
                        "text" -> Str.workbenchTextPreview
                        "binary" -> Str.workbenchBinaryPreview
                        else -> Str.workbenchUnavailable
                    }
                    val sizeLabel = item.sizeBytes?.let(::formatWorkbenchBytes)
                    Text(
                        text = listOfNotNull(sizeLabel, previewHint).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    val localImage = messages.flatMap { it.images }.firstOrNull { it.id == item.id }
                    if (localImage != null) WorkbenchImage(localImage)
                    else validatedWorkbenchThumbnail(item.thumbnailDataUrl)?.let { data -> WorkbenchImage(MessageImage(id = item.id, mimeType = "image/png", base64Data = data)) }
                    if (item.text.isNotBlank()) MonospacePreviewCard(item.text)
                } else if (item.kind == "task") {
                    taskMeta?.let { meta ->
                        Text(
                            text = "${meta.durationMs?.let(::formatTaskDuration) ?: "—"} · ${meta.toolCount} ${Str.workbenchToolCalls} · ${formatLocalMessageTime(meta.timestamp)}",
                            style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    val start = messages.indexOfFirst { it.id == item.id }
                    val taskImages = if (start >= 0) {
                        messages.drop(start + 1).takeWhile { it.role != org.agent567.android.core.model.ChatRole.User }.flatMap { it.images }.take(6)
                    } else {
                        emptyList()
                    }
                    if (item.text.isNotBlank()) {
                        MonospacePreviewCard(item.text)
                    } else if (taskImages.isEmpty()) {
                        Text(Str.workbenchTaskNoOutput, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    taskImages.forEach { WorkbenchImage(it) }
                } else if (item.kind == "change") {
                    val hasDiff = item.text.isNotBlank()
                    val hasSnapshots = !item.beforeText.isNullOrBlank() || !item.afterText.isNullOrBlank()
                    if (hasDiff) {
                        Text(Str.workbenchDiffPreview, style = MaterialTheme.typography.titleSmall)
                        MonospacePreviewCard(item.text, diffHighlight = true)
                    }
                    item.beforeText?.takeIf(String::isNotBlank)?.let { CollapsibleSnapshotCard(Str.workbenchBefore, it) }
                    item.afterText?.takeIf(String::isNotBlank)?.let { CollapsibleSnapshotCard(Str.workbenchAfter, it) }
                    if (!hasDiff && !hasSnapshots) {
                        Text(Str.workbenchChangeNoDiff, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (item.reversible && changeMeta?.status != "reverted") {
                        Text(Str.workbenchChangeHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else if (item.text.isNotBlank()) {
                    SelectionContainer { Text(item.text, style = MaterialTheme.typography.bodyMedium) }
                }
            }
        }
    }

    if (confirmDiscard) org.agent567.android.ui.components.Agent567ConfirmDialog(
        destructive = true,
        title = Str.workbenchDiscardTitle,
        message = Str.workbenchDiscardMessage,
        confirmLabel = Str.workbenchDiscard,
        onConfirm = { confirmDiscard = false; onDismiss() },
        onDismiss = { confirmDiscard = false },
    )

    selectedPending?.let { id ->
        val pendingFile = pendingFiles.firstOrNull { it.id == id }
        val pendingImage = pendingImages.firstOrNull { it.id == id }
        ScrollableDetailDialog(
            title = pendingFile?.fileName ?: pendingImage?.fileName ?: Str.workbenchAttachmentPreview,
            onDismiss = { selectedPending = null },
            footer = if (pendingFile != null) {
                {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    saveNotice?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { saveNotice = null; opener.open(pendingFile.id, pendingFile.fileName) }, enabled = !opener.opening) { Text(if (opener.opening) Str.workbenchOpening else Str.workbenchOpenOriginal) }
                        TextButton(onClick = { saveNotice = null; save(pendingFile.id, pendingFile.fileName) }, enabled = !opener.opening) { Text(Str.workbenchSaveOriginal) }
                    }
                }
                }
            } else null,
        ) {
            pendingImage?.let { image ->
                WorkbenchImage(image)
                Text(image.mimeType, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            pendingFile?.let { file ->
                Text(
                    "${file.fileName} · ${formatWorkbenchBytes(file.bytes.size.toLong())}",
                    style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum"),
                )
                val text = remember(file.id, file.bytes) { attachmentTextPreview(file.bytes) }
                Text(if (text == null) Str.workbenchBinaryPreview else Str.workbenchTextPreview, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (text != null) MonospacePreviewCard(text)
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
        Agent567Card(contentPadding = PaddingValues(14.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(Str.collaborationProjectStatus, style = MaterialTheme.typography.titleSmall)
                when {
                    !data.config.enabled -> WorkbenchStatusBadge(Str.collaborationDisabled)
                    data.config.paused -> WorkbenchStatusBadge(
                        Str.collaborationPaused,
                        MaterialTheme.agent567Extra.amberContainer,
                        MaterialTheme.agent567Extra.amberAccent,
                    )
                    else -> WorkbenchStatusBadge(
                        Str.collaborationEnabled,
                        MaterialTheme.agent567Extra.success.copy(alpha = 0.14f),
                        MaterialTheme.agent567Extra.success,
                    )
                }
            }
        }
        if (data.config.members.isNotEmpty()) {
            Text(Str.collaborationMembers, style = MaterialTheme.typography.labelMedium)
            Agent567Card(contentPadding = PaddingValues(14.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    data.config.members.forEachIndexed { idx, member ->
                        if (idx > 0) HorizontalDivider(color = MaterialTheme.agent567Extra.border.copy(alpha = 0.6f))
                        val candidate = candidatesById[member.sessionId]
                        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(candidate?.title?.takeIf(String::isNotBlank) ?: member.sessionId, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                                WorkbenchStatusBadge(if (member.access == "write") Str.collaborationWriteAccess else Str.collaborationReadAccess)
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(member.responsibility, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                WorkbenchStatusBadge(
                                    label = buildString {
                                        append(candidate?.model?.takeIf(String::isNotBlank) ?: Str.collaborationModelUnknown)
                                        append(" · ")
                                        append(candidate?.let { candidateState(it.state) } ?: Str.collaborationCandidateUnavailable)
                                    },
                                )
                            }
                        }
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
            Agent567Card(contentPadding = PaddingValues(12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        val sourceTarget = "${candidateName(task.sourceSessionId)} → ${candidateName(task.targetSessionId)}"
                        Text(if (task.kind == "result") "${Str.collaborationMemberResult} · $sourceTarget" else sourceTarget, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium)
                        if (task.kind != "result") Text(task.objective, maxLines = if (expanded) Int.MAX_VALUE else 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    CollaborationTaskStatusBadge(task.status)
                    TextButton(onClick = { expandedTaskId = if (expanded) null else task.id }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                        Text(if (expanded) Str.collapse else Str.expand)
                    }
                }
                if (expanded) {
                    Spacer(Modifier.height(8.dp))
                    HorizontalDivider(color = MaterialTheme.agent567Extra.border.copy(alpha = 0.6f))
                    Spacer(Modifier.height(8.dp))
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
                if (task.status == "running" || task.status == "waiting" || task.status == "queued" || task.status in setOf("attention", "failed", "interrupted", "cancelled")) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        if (task.status == "running" || task.status == "waiting" || task.status == "queued") {
                            TextButton(onClick = { onControl(ProjectCollaborationControl("stop", task.id)) }, enabled = !loading) { Text(Str.collaborationStop) }
                        }
                        if (task.status in setOf("attention", "failed", "interrupted", "cancelled")) {
                            TextButton(onClick = { onControl(ProjectCollaborationControl("continue", task.id)) }, enabled = !loading) { Text(Str.collaborationContinue) }
                        }
                    }
                }
            }
        }
        if (recentTasks.size > 8) TextButton(onClick = { showAllTasks = !showAllTasks }, modifier = Modifier.fillMaxWidth()) {
            Text(if (showAllTasks) Str.collaborationShowRecent else Str.collaborationShowAllPrefix + recentTasks.size + Str.collaborationShowAllSuffix)
        }
    }
}

@Composable
private fun AttachmentList(
    pendingFiles: List<PendingFileAttachment>,
    pendingImages: List<MessageImage>,
    snapshot: SessionWorkbenchSnapshot?,
    loading: Boolean,
    busy: Boolean,
    onOpenPending: (String) -> Unit,
    onRemoveFile: (String) -> Unit,
    onRemoveImage: (String) -> Unit,
    onSelect: (String, String) -> Unit,
    onScope: (String, String) -> Unit,
    images: List<MessageImage>,
    readThumbnail: suspend (String) -> String?,
) {
    var query by remember { mutableStateOf("") }
    val needle = query.trim().lowercase()
    val totalCount = pendingFiles.size + pendingImages.size + (snapshot?.attachments?.size ?: 0)
    val filteredImages = remember(pendingImages, needle) {
        if (needle.isEmpty()) pendingImages
        else pendingImages.filter { (it.fileName ?: Str.modelCapabilityImage).lowercase().contains(needle) }
    }
    val filteredFiles = remember(pendingFiles, needle) {
        if (needle.isEmpty()) pendingFiles
        else pendingFiles.filter { it.fileName.lowercase().contains(needle) || it.readScope.lowercase().contains(needle) }
    }
    val historyAttachments = snapshot?.attachments.orEmpty()
    val filteredHistory = remember(historyAttachments, needle) {
        if (needle.isEmpty()) historyAttachments
        else historyAttachments.filter { it.name.lowercase().contains(needle) || it.path.lowercase().contains(needle) }
    }
    Text(Str.workbenchAttachmentHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (totalCount >= 4 || needle.isNotEmpty()) {
        WorkbenchSearchField(query = query, onQueryChange = { query = it })
    }
    if (filteredFiles.isNotEmpty() || filteredImages.isNotEmpty()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(Str.workbenchPending, style = MaterialTheme.typography.titleSmall)
            WorkbenchStatusBadge(Str.workbenchDraft, MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
        }
        filteredImages.forEach { image ->
            Agent567Card(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Surface(
                        modifier = Modifier.size(36.dp),
                        shape = MaterialTheme.shapes.small,
                        color = MaterialTheme.colorScheme.surfaceContainerHighest,
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Image, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    TextButton(onClick = { onOpenPending(image.id) }, modifier = Modifier.weight(1f)) {
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.Start) {
                            Text(image.fileName ?: Str.modelCapabilityImage, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(Str.workbenchDraft, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    TextButton(onClick = { onRemoveImage(image.id) }, enabled = !busy) { Text(Str.workbenchRemove) }
                }
            }
        }
        filteredFiles.forEach { file ->
            Agent567Card(contentPadding = PaddingValues(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { onOpenPending(file.id) }, modifier = Modifier.weight(1f)) {
                        Text(
                            "${file.fileName} · ${file.bytes.size} bytes",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    TextButton(onClick = { onRemoveFile(file.id) }, enabled = !busy) { Text(Str.workbenchRemove) }
                }
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    value = file.readScope,
                    onValueChange = { onScope(file.id, it.take(300)) },
                    enabled = !busy,
                    label = { Text(Str.workbenchReadScope) },
                    supportingText = {
                        Text(
                            "${file.readScope.length} / 300",
                            style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"),
                        )
                    },
                    trailingIcon = if (file.readScope.isNotEmpty() && !busy) {
                        {
                            IconButton(onClick = { onScope(file.id, "") }) {
                                Icon(Icons.Default.Close, contentDescription = Str.workbenchClearScope)
                            }
                        }
                    } else null,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(Str.workbenchHistoryAttachments, style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (historyAttachments.isNotEmpty()) {
                WorkbenchStatusBadge("${historyAttachments.size}", tabular = true)
            }
            WorkbenchStatusBadge(Str.workbenchReadOnly)
        }
    }
    filteredHistory.forEach { file ->
        key(file.id) { WorkbenchAttachmentRow(file, images.firstOrNull { it.id == file.id }, readThumbnail) { onSelect("attachment", file.id) } }
    }
    if (needle.isNotEmpty() && filteredFiles.isEmpty() && filteredImages.isEmpty() && filteredHistory.isEmpty()) {
        WorkbenchSearchEmptyState(onClear = { query = "" })
    } else if (!loading && historyAttachments.isEmpty()) {
        Text(Str.workbenchEmpty, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun TaskList(snapshot: SessionWorkbenchSnapshot?, loading: Boolean, onSelect: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    val needle = query.trim().lowercase()
    val tasks = snapshot?.tasks.orEmpty()
    val filtered = remember(tasks, needle) {
        if (needle.isEmpty()) tasks
        else tasks.filter { it.title.lowercase().contains(needle) || taskStatus(it.status).lowercase().contains(needle) }
    }
    Text(Str.workbenchTaskHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (tasks.size >= 4 || needle.isNotEmpty()) {
        WorkbenchSearchField(query = query, onQueryChange = { query = it })
    }
    filtered.forEach { task ->
        Surface(
            onClick = { onSelect(task.id) },
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(task.title.ifBlank { Str.contextAttachmentTurn }, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    TaskStatusBadge(task.status)
                }
                Text(
                    "${task.durationMs?.let(::formatTaskDuration) ?: "—"} · ${task.toolCount} ${Str.workbenchToolCalls} · ${formatLocalMessageTime(task.timestamp)}",
                    style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    if (needle.isNotEmpty() && filtered.isEmpty()) {
        WorkbenchSearchEmptyState(onClear = { query = "" })
    } else if (!loading && tasks.isEmpty()) {
        Text(Str.workbenchEmpty, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ChangeList(snapshot: SessionWorkbenchSnapshot?, onSelect: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    val needle = query.trim().lowercase()
    val changes = snapshot?.changes.orEmpty()
    val filtered = remember(changes, needle) {
        if (needle.isEmpty()) changes
        else changes.filter { it.path.lowercase().contains(needle) || it.id.lowercase().contains(needle) }
    }
    Text(Str.workbenchChangeHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (changes.size >= 4 || needle.isNotEmpty()) {
        WorkbenchSearchField(query = query, onQueryChange = { query = it })
    }
    filtered.forEach { change ->
        Surface(
            onClick = { onSelect(change.id) },
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(change.path.ifBlank { change.id }, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                ChangeReviewBadges(change.status, change.reversible)
            }
        }
    }
    if (needle.isNotEmpty() && filtered.isEmpty()) {
        WorkbenchSearchEmptyState(onClear = { query = "" })
    } else if (changes.isEmpty()) {
        Text(Str.workbenchNoChanges, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun WorkbenchSearchField(query: String, onQueryChange: (String) -> Unit) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        singleLine = true,
        label = { Text(Str.workbenchSearch) },
        trailingIcon = if (query.isNotEmpty()) {
            {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Close, contentDescription = Str.contextClearSearch)
                }
            }
        } else null,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun WorkbenchSearchEmptyState(onClear: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(Str.workbenchNoSearchMatch, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = onClear) { Text(Str.contextClearSearch) }
    }
}

@Composable
private fun TaskStatusBadge(status: String) {
    when (status) {
        "completed" -> WorkbenchStatusBadge(taskStatus(status), MaterialTheme.agent567Extra.success.copy(alpha = 0.14f), MaterialTheme.agent567Extra.success)
        "failed" -> WorkbenchStatusBadge(taskStatus(status), MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer)
        "running" -> WorkbenchStatusBadge(taskStatus(status), MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
        else -> WorkbenchStatusBadge(taskStatus(status), MaterialTheme.agent567Extra.amberContainer, MaterialTheme.agent567Extra.amberAccent)
    }
}

@Composable
private fun ChangeReviewBadges(status: String, reversible: Boolean) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        when (status) {
            "kept" -> WorkbenchStatusBadge(Str.workbenchKeptReview, MaterialTheme.agent567Extra.success.copy(alpha = 0.14f), MaterialTheme.agent567Extra.success)
            "reverted" -> WorkbenchStatusBadge(Str.workbenchRevertedReview)
            else -> WorkbenchStatusBadge(Str.workbenchPendingReview, MaterialTheme.agent567Extra.amberContainer, MaterialTheme.agent567Extra.amberAccent)
        }
        WorkbenchStatusBadge(
            if (reversible && status != "reverted") Str.workbenchReversibleDesktop else Str.workbenchReadOnlyChange,
        )
    }
}

@Composable
private fun CollaborationTaskStatusBadge(status: String) {
    when (status) {
        "completed" -> WorkbenchStatusBadge(Str.workbenchTaskCompleted, MaterialTheme.agent567Extra.success.copy(alpha = 0.14f), MaterialTheme.agent567Extra.success)
        "failed" -> WorkbenchStatusBadge(Str.workbenchTaskFailed, MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer)
        "running" -> WorkbenchStatusBadge(Str.workbenchTaskRunning, MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
        "waiting" -> WorkbenchStatusBadge(Str.collaborationWaiting, MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
        "queued" -> WorkbenchStatusBadge(Str.collaborationQueued, MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
        "interrupted" -> WorkbenchStatusBadge(Str.workbenchTaskInterrupted, MaterialTheme.agent567Extra.amberContainer, MaterialTheme.agent567Extra.amberAccent)
        "attention" -> WorkbenchStatusBadge(Str.collaborationAttention, MaterialTheme.agent567Extra.amberContainer, MaterialTheme.agent567Extra.amberAccent)
        "cancelled" -> WorkbenchStatusBadge(Str.collaborationCancelled)
        else -> WorkbenchStatusBadge(status)
    }
}

@Composable
private fun MonospacePreviewCard(text: String, diffHighlight: Boolean = false) {
    val successColor = MaterialTheme.agent567Extra.success
    val errorColor = MaterialTheme.colorScheme.error
    val defaultColor = MaterialTheme.colorScheme.onSurface
    val renderedText = remember(text, diffHighlight, successColor, errorColor, defaultColor) {
        if (!diffHighlight) null
        else buildAnnotatedString {
            val lines = text.split('\n')
            lines.forEachIndexed { index, line ->
                val color = when {
                    line.startsWith("+") && !line.startsWith("+++") -> successColor
                    line.startsWith("-") && !line.startsWith("---") -> errorColor
                    else -> defaultColor
                }
                withStyle(SpanStyle(color = color)) {
                    append(line)
                    if (index < lines.lastIndex) append('\n')
                }
            }
        }
    }
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        SelectionContainer {
            if (renderedText != null) {
                Text(
                    text = renderedText,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    modifier = Modifier.padding(12.dp),
                )
            } else {
                Text(
                    text = text,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    modifier = Modifier.padding(12.dp),
                )
            }
        }
    }
}

@Composable
private fun CollapsibleSnapshotCard(title: String, text: String) {
    var expanded by remember(title, text) { mutableStateOf(false) }
    Agent567Card(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                Text(if (expanded) Str.collapse else Str.expand)
            }
        }
        if (expanded) {
            Spacer(Modifier.height(6.dp))
            MonospacePreviewCard(text)
        }
    }
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

private fun formatTaskDuration(durationMs: Long): String {
    if (durationMs < 1000L) return "${durationMs}ms"
    val tenths = (durationMs + 50L) / 100L
    return "${tenths / 10}.${tenths % 10}s"
}

private fun formatWorkbenchBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024L -> {
        val tenths = (bytes * 10L + 512L * 1024L) / (1024L * 1024L)
        "${tenths / 10}.${tenths % 10} MB"
    }
    bytes >= 1024L -> {
        val tenths = (bytes * 10L + 512L) / 1024L
        "${tenths / 10}.${tenths % 10} KB"
    }
    else -> "$bytes B"
}
