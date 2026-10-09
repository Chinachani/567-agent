package org.agent567.android.ui.chat

import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material3.Switch
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.window.Dialog
import androidx.compose.material.icons.filled.Check
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.filled.ContentCopy
import kotlinx.coroutines.delay

import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SheetValue
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.WindowInsets
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import androidx.compose.runtime.withFrameNanos
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.LlmModel
import org.agent567.android.domain.error.UiError
import org.agent567.android.domain.error.UiErrorAction
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageImage
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.domain.chat.prepareRetryTurn
import org.agent567.android.domain.session.PendingQuestion
import org.agent567.android.domain.session.ToolTrace
import org.agent567.android.domain.session.formatLocalMessageTime
import org.agent567.android.ui.components.EmptyState
import org.agent567.android.ui.components.ListRow
import org.agent567.android.ui.components.Agent567ErrorBanner
import org.agent567.android.ui.LocalMotionEnabled
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.media.rememberMessageImageBitmap
import org.agent567.android.ui.media.PendingFileAttachment
import org.agent567.android.ui.media.rememberFileAttachmentPicker
import org.agent567.android.ui.media.MessageImageLoadState
import org.agent567.android.ui.media.rememberImagePicker
import org.agent567.android.ui.media.rememberImageCapture
import org.agent567.android.ui.media.MAX_MESSAGE_IMAGE_TOTAL_BYTES
import org.agent567.android.ui.media.MAX_PICKED_IMAGE_COUNT
import org.agent567.android.ui.media.MAX_MESSAGE_FILE_BYTES
import org.agent567.android.ui.media.MAX_MESSAGE_FILE_COUNT
import org.agent567.android.ui.media.MAX_MESSAGE_FILE_TOTAL_BYTES
import org.agent567.android.ui.media.byteSize
import org.agent567.android.ui.media.pickedByteSize
import org.agent567.android.ui.navigation.ChatSurface
import org.agent567.android.ui.theme.agent567Extra

internal fun chatImeScrollTarget(imeBottomPx: Int, lastMessageIndex: Int): Int? =
    lastMessageIndex.takeIf { imeBottomPx > 0 && it >= 0 }

@Composable
fun RotatingRefreshIcon(
    isRefreshing: Boolean,
    contentDescription: String? = null,
    modifier: Modifier = Modifier,
) {
    val rotation by if (isRefreshing && LocalMotionEnabled.current) {
        val transition = rememberInfiniteTransition()
        transition.animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(
                animation = tween(800, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
        )
    } else {
        remember { mutableStateOf(0f) }
    }
    Icon(
        imageVector = Icons.Default.Refresh,
        contentDescription = contentDescription,
        modifier = modifier.graphicsLayer { rotationZ = rotation },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    title: String,
    surface: ChatSurface,
    messages: List<LocalMessage>,
    draft: String,
    pendingImages: List<MessageImage>,
    pendingFiles: List<PendingFileAttachment> = emptyList(),
    isStreaming: Boolean,
    streamingStatus: String? = null,
    inputPredictions: List<String> = emptyList(),
    inputPredictionLoading: Boolean = false,
    onSelectInputPrediction: (String) -> Unit = {},
    desktopHistoryLoading: Boolean = false,
    models: List<LlmModel>,
    selectedModel: LlmModel?,
    modelPickerOpen: Boolean,
    activeGroup: String? = null,
    availableGroups: Map<String, org.agent567.android.core.api.ApiGroupInfoDto> = emptyMap(),
    groupPickerOpen: Boolean = false,
    onOpenGroupPicker: () -> Unit = {},
    onCloseGroupPicker: () -> Unit = {},
    onSelectGroup: ((String) -> Unit)? = null,
    onRefreshCatalog: () -> Unit = {},
    catalogLoading: Boolean = false,
    chatError: UiError?,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onRetryAssistant: (String) -> Unit = {},
    onBack: () -> Unit,
    onOpenModelPicker: () -> Unit,
    onCloseModelPicker: () -> Unit,
    onSelectModel: (LlmModel) -> Unit,
    onErrorAction: (UiErrorAction) -> Unit,
    onDismissError: () -> Unit,
    onImagesPicked: (List<MessageImage>) -> Unit,
    onRemovePendingImage: (String) -> Unit,
    onAddPendingFile: (PendingFileAttachment) -> Unit = {},
    onRemovePendingFile: (String) -> Unit = {},
    pendingQuestion: PendingQuestion? = null,
    questionSubmitting: Boolean = false,
    onToggleQuestionOption: (String, String) -> Unit = { _, _ -> },
    onSubmitQuestion: () -> Unit = {},
    activeImageGroup: String? = null,
    activeImageModel: String? = null,
    imageGenEnabled: Boolean = true,
    imagePickerOpen: Boolean = false,
    availableImageModels: List<String> = emptyList(),
    imageModelsLoading: Boolean = false,
    imageGroupExpanded: Boolean = false,
    onOpenImagePicker: () -> Unit = {},
    onCloseImagePicker: () -> Unit = {},
    onToggleGroupExpanded: (Boolean) -> Unit = {},
    onToggleImageGen: (Boolean) -> Unit = {},
    onSelectImageGroup: (String) -> Unit = {},
    onSelectImageModel: (String) -> Unit = {},
) {
    val retryableAssistantId = remember(messages) { prepareRetryTurn(messages)?.assistantMessageId }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val imeBottomPx = WindowInsets.ime.getBottom(LocalDensity.current)
    var attachedSessionId by remember { mutableStateOf<String?>(null) }
    var toastNotice by remember { mutableStateOf<String?>(null) }
    var attachmentChooserOpen by remember { mutableStateOf(false) }
    val attachmentSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val currentSessionId = messages.firstOrNull()?.sessionId

    fun appendPickedImages(picked: List<org.agent567.android.ui.media.PickedImage>) {
        var remainingBytes = (MAX_MESSAGE_IMAGE_TOTAL_BYTES - pendingImages.sumOf { it.pickedByteSize() }).coerceAtLeast(0)
        val availableCount = (MAX_PICKED_IMAGE_COUNT - pendingImages.size).coerceAtLeast(0)
        val accepted = mutableListOf<MessageImage>()
        var rejectedCount = (picked.size - availableCount).coerceAtLeast(0)
        for (image in picked.take(availableCount)) {
            if (image.bytes.isEmpty() || image.bytes.size > remainingBytes) {
                rejectedCount++
                continue
            }
            accepted += MessageImage(
                id = "pending-${image.fileName}-${image.bytes.size}-${image.bytes.hashCode()}",
                mimeType = image.mimeType,
                fileName = image.fileName,
                pendingBytes = image.bytes,
            )
            remainingBytes -= image.bytes.size
        }
        if (accepted.isNotEmpty()) onImagesPicked(accepted)
        if (rejectedCount > 0) toastNotice = Str.imageAttachmentRejected
    }

    val launchPicker =
        rememberImagePicker(
            onPicked = ::appendPickedImages,
            onRejected = { toastNotice = Str.imageAttachmentRejected },
        )

    val launchCamera = rememberImageCapture(
        onPicked = { appendPickedImages(listOf(it)) },
        onRejected = { toastNotice = Str.imageAttachmentRejected },
    )

    val launchFilePicker = rememberFileAttachmentPicker(
        onPicked = { pickedFiles ->
            var countRemaining = (MAX_MESSAGE_FILE_COUNT - pendingFiles.size).coerceAtLeast(0)
            var bytesRemaining = (MAX_MESSAGE_FILE_TOTAL_BYTES - pendingFiles.sumOf { it.byteSize() }).coerceAtLeast(0)
            pickedFiles.forEach { picked ->
                if (countRemaining <= 0) {
                    toastNotice = Str.documentAttachmentLimit
                } else if (picked.bytes.isEmpty() || picked.bytes.size > MAX_MESSAGE_FILE_BYTES || picked.bytes.size > bytesRemaining) {
                    toastNotice = Str.documentAttachmentRejected
                } else {
                    onAddPendingFile(
                        PendingFileAttachment(
                            id = "file-${picked.fileName.hashCode()}-${picked.bytes.size}-${picked.bytes.hashCode()}",
                            fileName = picked.fileName,
                            mimeType = picked.mimeType,
                            bytes = picked.bytes,
                        ),
                    )
                    countRemaining--
                    bytesRemaining -= picked.bytes.size
                }
            }
        },
        onRejected = { toastNotice = Str.documentAttachmentRejected },
    )

    // 1. 会话初次进入或切换会话时，无论消息多少，瞬间精确定位至最底部最新消息
    LaunchedEffect(currentSessionId, messages.isNotEmpty()) {
        if (messages.isNotEmpty() && (attachedSessionId == null || attachedSessionId != currentSessionId)) {
            attachedSessionId = currentSessionId
            listState.scrollToItem(messages.lastIndex)
        }
    }

    val isAtBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull() ?: return@derivedStateOf true
            last.index >= info.totalItemsCount - 2
        }
    }

    // 2. 用户处于底部附着区时，新消息产生或流式文字生成平滑向下跟随滚动
    LaunchedEffect(messages.size, messages.lastOrNull()?.content, messages.lastOrNull()?.status) {
        if (isAtBottom && messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.lastIndex)
        }
    }

    val imeScrollTarget = chatImeScrollTarget(imeBottomPx, messages.lastIndex)
    LaunchedEffect(imeScrollTarget) {
        imeScrollTarget?.let { target ->
            // Let the resized viewport land first, then keep the newest message
            // visible while the user starts typing.
            withFrameNanos { }
            listState.animateScrollToItem(target)
        }
    }

    val imageSaver = org.agent567.android.ui.media.rememberImageSaver()
    var previewImage by remember { mutableStateOf<MessageImage?>(null) }

    val canSend =
        !isStreaming &&
            (surface == ChatSurface.Desktop || selectedModel != null) &&
            (draft.isNotBlank() || pendingImages.isNotEmpty() || pendingFiles.isNotEmpty())
    val maxInputHeight = (LocalConfiguration.current.screenHeightDp * 0.35f).dp

    Scaffold(
        containerColor = MaterialTheme.agent567Extra.pageBackground,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            title,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        if (isStreaming) {
                            Text(
                                streamingStatusLabel(streamingStatus),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.agent567Extra.secondaryText,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                actions = {
                    if (surface == ChatSurface.Cloud) {
                        IconButton(onClick = onOpenGroupPicker) {
                            Icon(Icons.Default.Tune, contentDescription = "选择模型分组", tint = MaterialTheme.agent567Extra.secondaryText)
                        }
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.agent567Extra.pageBackground.copy(alpha = 0.92f),
                    ),
            )
        },
        bottomBar = {
            Column(
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .imePadding(),
            ) {
                if (chatError != null) {
                    Agent567ErrorBanner(
                        error = chatError,
                        onDismiss = onDismissError,
                        onAction = onErrorAction,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
                if (pendingImages.isNotEmpty()) {
                    PendingImageRow(
                        images = pendingImages,
                        onRemove = onRemovePendingImage,
                    )
                }
                if (pendingFiles.isNotEmpty()) {
                    LazyRow(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(pendingFiles, key = { it.id }) { document ->
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.64f),
                                border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border),
                            ) {
                                Row(
                                    modifier = Modifier.padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Icon(Icons.Default.AttachFile, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Column(Modifier.widthIn(max = 180.dp)) {
                                        Text(document.fileName, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text("${document.mimeType} · ${formatAttachmentSize(document.bytes.size.toLong())}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.agent567Extra.secondaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                    IconButton(onClick = { onRemovePendingFile(document.id) }, modifier = Modifier.size(30.dp)) {
                                        Icon(Icons.Default.Close, contentDescription = Str.removeDocumentAttachment, modifier = Modifier.size(16.dp))
                                    }
                                }
                            }
                        }
                    }
                }
                AnimatedVisibility(
                    visible = pendingQuestion != null,
                    enter = fadeIn(tween(200)) + expandVertically(tween(200)),
                    exit = fadeOut(tween(180)) + shrinkVertically(tween(180)),
                ) {
                    pendingQuestion?.let {
                        QuestionPrompt(
                            pending = it,
                            submitting = questionSubmitting,
                            onToggle = onToggleQuestionOption,
                            onSubmit = onSubmitQuestion,
                        )
                    }
                }
                if (draft.isBlank() && (inputPredictions.isNotEmpty() || inputPredictionLoading)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (inputPredictionLoading) {
                            Surface(
                                shape = RoundedCornerShape(50),
                                color = Color.Transparent,
                                border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border.copy(alpha = 0.75f)),
                            ) {
                                Text(
                                    Str.inputPredictionLoading,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.agent567Extra.secondaryText,
                                    maxLines = 1,
                                )
                            }
                        }
                        inputPredictions.forEach { suggestion ->
                            Surface(
                                onClick = { onSelectInputPrediction(suggestion) },
                                shape = RoundedCornerShape(50),
                                color = Color.Transparent,
                                border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border.copy(alpha = 0.75f)),
                            ) {
                                Text(
                                    suggestion,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
                if (surface == ChatSurface.Cloud) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        // 1. 主模型胶囊
                        Surface(
                            onClick = onOpenModelPicker,
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.agent567Extra.chipBackground.copy(alpha = 0.7f),
                            border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border.copy(alpha = 0.6f)),
                            modifier = Modifier.weight(1f).height(32.dp),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 8.dp),
                            ) {
                                Icon(
                                    Icons.Default.AutoAwesome,
                                    contentDescription = null,
                                    modifier = Modifier.size(14.dp),
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    if (activeGroup == null) "请选择主分组" else (selectedModel?.name ?: "选择主模型"),
                                    style = MaterialTheme.typography.labelSmall,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                Icon(
                                    Icons.Default.ArrowDropDown,
                                    contentDescription = null,
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                        }

                        // 2. 独立画图模型胶囊（并列双胶囊）
                        Surface(
                            onClick = onOpenImagePicker,
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.agent567Extra.chipBackground.copy(alpha = 0.7f),
                            border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border.copy(alpha = 0.6f)),
                            modifier = Modifier.weight(1f).height(32.dp),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 8.dp),
                            ) {
                                Icon(
                                    Icons.Default.Brush,
                                    contentDescription = null,
                                    modifier = Modifier.size(14.dp),
                                    tint = if (imageGenEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    if (!imageGenEnabled) "绘图: 已关闭" else (activeImageModel?.let { "绘图: $it" } ?: "配置绘图"),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (imageGenEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.agent567Extra.secondaryText,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                Icon(
                                    Icons.Default.ArrowDropDown,
                                    contentDescription = null,
                                    modifier = Modifier.size(14.dp),
                                    tint = if (imageGenEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.agent567Extra.secondaryText,
                                )
                            }
                        }
                    }
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                    ) {
                        Surface(
                            onClick = onOpenModelPicker,
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            ) {
                                Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    "电脑模型 · ${selectedModel?.name ?: "加载中"}",
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                Icon(Icons.Default.ArrowDropDown, contentDescription = null, modifier = Modifier.size(16.dp))
                            }
                        }
                    }
                }
                InputDock(
                    value = draft,
                    isStreaming = isStreaming,
                    sendEnabled = canSend,
                    onValueChange = onDraftChange,
                    onSend = onSend,
                    onStop = onStop,
                    onAttach = { attachmentChooserOpen = true },
                    maxHeight = maxInputHeight,
                )
            }
        },
    ) { padding ->
        Box(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            if (messages.isEmpty()) {
                Column(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    if (desktopHistoryLoading) {
                        CircularProgressIndicator()
                        Spacer(Modifier.height(12.dp))
                        Text(Str.loadingDesktopHistory, color = MaterialTheme.agent567Extra.secondaryText)
                    } else {
                        EmptyState(
                            title = if (surface == ChatSurface.Cloud) Str.useCloudAi else Str.pairDesktop,
                            subtitle = Str.noSessionsHint,
                        )
                    }
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (desktopHistoryLoading) {
                        item {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(Str.loadingDesktopHistory, color = MaterialTheme.agent567Extra.secondaryText)
                            }
                        }
                    }
                    items(messages, key = { it.id }) { msg ->
                        MessageBubble(
                            message = msg,
                            streamingStatus = streamingStatus,
                            onImageClick = { previewImage = it },
                            onCopyToast = { toastNotice = it },
                            canRetry = msg.id == retryableAssistantId,
                            onRetry = { onRetryAssistant(msg.id) },
                        )
                    }
                }
                if (!isAtBottom) {
                    TextButton(
                        onClick = {
                            scope.launch {
                                listState.animateScrollToItem(messages.lastIndex)
                            }
                        },
                        modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp),
                    ) {
                        Text(Str.newContent)
                    }
                }
            }
        }
    }


    if (imagePickerOpen) {
        ModalBottomSheet(
            onDismissRequest = onCloseImagePicker,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Column(
                Modifier
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("智能绘图配置", style = MaterialTheme.typography.titleMedium)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (imageGenEnabled) "已启用" else "已关闭",
                            style = MaterialTheme.typography.labelMedium,
                            color = if (imageGenEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.agent567Extra.secondaryText,
                        )
                        Spacer(Modifier.width(8.dp))
                        Switch(
                            checked = imageGenEnabled,
                            onCheckedChange = onToggleImageGen,
                        )
                    }
                }
                Text(
                    "开启后，对话时主模型可自动调用画图工具扩写提示词并生成画面",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.agent567Extra.secondaryText,
                )
                Spacer(Modifier.height(16.dp))

                if (imageGenEnabled) {
                    // 第一级：画图分组（支持自动折叠联动）
                    Card(
                        shape = RoundedCornerShape(10.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(12.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column {
                                    Text("画图分组", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold))
                                    Text(
                                        if (activeImageGroup != null) "当前: $activeImageGroup" else "未选择分组（请点击选择）",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                }
                                TextButton(onClick = { onToggleGroupExpanded(!imageGroupExpanded) }) {
                                    Text(if (imageGroupExpanded) "收起分组" else "更改分组")
                                }
                            }

                            AnimatedVisibility(
                                visible = imageGroupExpanded || activeImageGroup == null,
                                enter = fadeIn() + expandVertically(),
                                exit = fadeOut() + shrinkVertically(),
                            ) {
                                Column(Modifier.padding(top = 8.dp)) {
                                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                                    Spacer(Modifier.height(6.dp))
                                    availableGroups.keys.forEach { groupName ->
                                        val isSelected = groupName == activeImageGroup
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
                                                .clickable {
                                                    onSelectImageGroup(groupName)
                                                }
                                                .padding(horizontal = 8.dp, vertical = 8.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                        ) {
                                            Text(
                                                groupName,
                                                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal),
                                                color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                            )
                                            if (isSelected) {
                                                Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(16.dp))

                    // 第二级：展现该分组下的生图模型
                    Text("绘图模型", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold))
                    Text("选择生成画面的底层模型", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
                    Spacer(Modifier.height(8.dp))

                    if (activeImageGroup == null) {
                        Text("请先在上方选择画图分组", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.agent567Extra.secondaryText)
                    } else if (imageModelsLoading) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 12.dp)) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp))
                            Text("正在拉取该分组的绘图模型...", style = MaterialTheme.typography.bodyMedium)
                        }
                    } else if (availableImageModels.isEmpty()) {
                        Text("该分组下未检索到模型或通道未开放", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.agent567Extra.secondaryText)
                    } else {
                        Column {
                            availableImageModels.forEach { modelName ->
                                val isSelected = modelName == activeImageModel
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else Color.Transparent)
                                        .clickable {
                                            onSelectImageModel(modelName)
                                        }
                                        .padding(vertical = 10.dp, horizontal = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            modelName,
                                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium),
                                            color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                        )
                                    }
                                    if (isSelected) {
                                        Icon(
                                            Icons.Default.Check,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(18.dp),
                                        )
                                    }
                                }
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.2f))
                            }
                        }
                    }
                }
                Spacer(Modifier.height(28.dp))
            }
        }
    }

    if (attachmentChooserOpen) {
        ModalBottomSheet(
            onDismissRequest = { attachmentChooserOpen = false },
            sheetState = attachmentSheetState,
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 20.dp)) {
                AttachmentActionRow(
                    icon = Icons.Default.PhotoLibrary,
                    title = Str.choosePhoto,
                    subtitle = Str.choosePhotoHint,
                    onClick = {
                        scope.launch { attachmentSheetState.hide(); attachmentChooserOpen = false; launchPicker() }
                    },
                )
                AttachmentActionRow(
                    icon = Icons.Default.PhotoCamera,
                    title = Str.takePhoto,
                    subtitle = Str.takePhotoHint,
                    onClick = {
                        scope.launch { attachmentSheetState.hide(); attachmentChooserOpen = false; launchCamera() }
                    },
                )
                AttachmentActionRow(
                    icon = Icons.Default.AttachFile,
                    title = Str.importDocument,
                    subtitle = Str.importDocumentHint,
                    onClick = {
                        scope.launch { attachmentSheetState.hide(); attachmentChooserOpen = false; launchFilePicker() }
                    },
                )
            }
        }
    }

    if (groupPickerOpen) {
        val groupSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        var groupSheetClosing by remember { mutableStateOf(false) }
        val finishClosingGroupPicker = {
            if (!groupSheetClosing) {
                groupSheetClosing = true
                scope.launch {
                    if (groupSheetState.targetValue != SheetValue.Hidden) {
                        groupSheetState.hide()
                    }
                    snapshotFlow { groupSheetState.currentValue }
                        .first { it == SheetValue.Hidden }
                    onCloseGroupPicker()
                }
            }
        }
        ModalBottomSheet(
            // A drag may already be animating toward Hidden when this callback runs.
            // Reuse that transition instead of starting a competing hide animation.
            onDismissRequest = finishClosingGroupPicker,
            sheetState = groupSheetState,
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("567 API 接入分组", style = MaterialTheme.typography.titleMedium)
                    IconButton(onClick = onRefreshCatalog) {
                        RotatingRefreshIcon(isRefreshing = catalogLoading, contentDescription = "刷新缓存")
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text("纵向选择分组，切换后立即自动加载对应模型", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
                Spacer(Modifier.height(12.dp))

                val sortedGroups = remember(availableGroups, activeGroup) {
                    val list = availableGroups.keys.toList()
                    if (activeGroup != null && activeGroup in list) {
                        listOf(activeGroup) + list.filter { it != activeGroup }
                    } else {
                        list
                    }
                }

                Column(Modifier.verticalScroll(rememberScrollState())) {
                    sortedGroups.forEach { groupName ->
                        val isSelected = groupName == activeGroup
                        val info = availableGroups[groupName]
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else Color.Transparent)
                                .clickable {
                                    onSelectGroup?.invoke(groupName)
                                    finishClosingGroupPicker()
                                }
                                .padding(vertical = 12.dp, horizontal = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        groupName,
                                        style = MaterialTheme.typography.bodyMedium.copy(
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
                                        ),
                                        color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        "${info?.ratio ?: 1.0}x 倍率",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                    if (isSelected) {
                                        Spacer(Modifier.width(6.dp))
                                        Text(
                                            "当前选择",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                }
                                if (!info?.desc.isNullOrBlank()) {
                                    Spacer(Modifier.height(2.dp))
                                    Text(info?.desc.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
                                }
                            }
                            if (isSelected) {
                                Icon(Icons.Default.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }

    if (modelPickerOpen) {
        ModalBottomSheet(
            onDismissRequest = onCloseModelPicker,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (surface == ChatSurface.Desktop) "电脑当前会话 · 模型列表" else "${activeGroup ?: "当前分组"} · 模型列表",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    IconButton(onClick = onRefreshCatalog) {
                        RotatingRefreshIcon(isRefreshing = catalogLoading, contentDescription = "刷新")
                    }
                }
                Spacer(Modifier.height(12.dp))
                if (models.isEmpty()) {
                    EmptyState(title = Str.noModels, subtitle = "正在拉取或该分组暂无模型，点击右上角刷新")
                } else {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        models.forEachIndexed { index, model ->
                            val selected = model.id == selectedModel?.id
                            val meta =
                                buildString {
                                    if (model.reasoning) append("深度推理 · ")
                                    if (model.contextWindow != null) append("上下文 ${model.contextWindow}")
                                    if (model.tags.isNotEmpty()) {
                                        if (isNotEmpty()) append(" · ")
                                        append(model.tags.take(3).joinToString(" / "))
                                    }
                                }
                            ListRow(
                                title = model.name,
                                subtitle = meta.takeIf { it.isNotEmpty() },
                                trailing = if (selected) {
                                    { Icon(Icons.Default.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary) }
                                } else {
                                    null
                                },
                                onClick = { onSelectModel(model) },
                                showDivider = index < models.lastIndex,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }

    if (previewImage != null) {
        ImagePreviewModal(
            image = previewImage!!,
            onDismiss = { previewImage = null },
            imageSaver = imageSaver,
        )
    }

    if (toastNotice != null) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.BottomCenter,
        ) {
            androidx.compose.material3.Snackbar(
                modifier = Modifier
                    .padding(bottom = 72.dp, start = 16.dp, end = 16.dp),
                action = {
                    TextButton(onClick = { toastNotice = null }) {
                        Text("确定", color = MaterialTheme.colorScheme.inversePrimary)
                    }
                },
            ) {
                Text(toastNotice!!)
            }
        }
        LaunchedEffect(toastNotice) {
            kotlinx.coroutines.delay(2500)
            toastNotice = null
        }
    }
}

@Composable
private fun AttachmentActionRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(24.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(14.dp))
        Column {
            Text(title, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
        }
    }
}

@Composable
private fun ImagePreviewModal(
    image: MessageImage,
    onDismiss: () -> Unit,
    imageSaver: (MessageImage, (Boolean, String) -> Unit) -> Unit,
) {
    var scale by remember(image.id) { mutableStateOf(1f) }
    var offset by remember(image.id) { mutableStateOf(Offset.Zero) }
    var saveStatus by remember { mutableStateOf<String?>(null) }
    var isSaving by remember { mutableStateOf(false) }
    var saveSucceeded by remember { mutableStateOf(false) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
        ) {
            val imageState = rememberMessageImageBitmap(image)
            when (imageState) {
                is MessageImageLoadState.Loaded -> {
                val bmp = imageState.bitmap
                BoxWithConstraints(Modifier.fillMaxSize()) {
                    val density = LocalDensity.current
                    val viewportWidthPx = with(density) { maxWidth.toPx() }
                    val viewportHeightPx = with(density) { maxHeight.toPx() }
                    val imageSize = generatedImageSize(maxWidth, maxHeight, bmp.width, bmp.height)
                    val imageWidthPx = with(density) { imageSize.width.toPx() }
                    val imageHeightPx = with(density) { imageSize.height.toPx() }
                    LaunchedEffect(image.id, imageWidthPx, imageHeightPx, viewportWidthPx, viewportHeightPx) {
                        val initialScale = initialImagePreviewScale(viewportWidthPx, imageWidthPx, imageHeightPx)
                        scale = initialScale
                        offset = initialImagePreviewOffset(
                            scale = initialScale,
                            imageWidthPx = imageWidthPx,
                            imageHeightPx = imageHeightPx,
                            viewportWidthPx = viewportWidthPx,
                            viewportHeightPx = viewportHeightPx,
                        )
                    }
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .pointerInput(imageSize, maxWidth, maxHeight) {
                                detectTransformGestures { centroid, pan, zoom, _ ->
                                    val nextScale = (scale * zoom).coerceIn(1f, 5f)
                                    val factor = nextScale / scale
                                    val center = Offset(size.width / 2f, size.height / 2f)
                                    val nextOffset =
                                        Offset(
                                            x = (offset.x + center.x - centroid.x) * factor + centroid.x - center.x + pan.x,
                                            y = (offset.y + center.y - centroid.y) * factor + centroid.y - center.y + pan.y,
                                        )
                                    scale = nextScale
                                    offset = clampImagePreviewOffset(
                                        nextOffset,
                                        nextScale,
                                        imageWidthPx,
                                        imageHeightPx,
                                        viewportWidthPx,
                                        viewportHeightPx,
                                    )
                                }
                            }
                            .pointerInput(image.id, imageSize, maxWidth, maxHeight) {
                                detectTapGestures(onDoubleTap = {
                                    if (scale > 1.05f) {
                                        scale = 1f
                                        offset = Offset.Zero
                                    } else {
                                        val fillHeightScale = viewportHeightPx / imageHeightPx
                                        val fillWidthScale = viewportWidthPx / imageWidthPx
                                        scale = minOf(2.4f, maxOf(1.7f, minOf(fillHeightScale, fillWidthScale)))
                                    }
                                })
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Image(
                            bitmap = bmp,
                            contentDescription = "查看大图，双击缩放，双指缩放和拖动",
                            modifier = Modifier
                                .width(imageSize.width)
                                .height(imageSize.height)
                                .graphicsLayer(
                                    scaleX = scale,
                                    scaleY = scale,
                                    translationX = offset.x,
                                    translationY = offset.y,
                                ),
                            contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                        )
                    }
                }
                }
                MessageImageLoadState.Loading -> CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center),
                    color = Color.White,
                )
                MessageImageLoadState.Failed -> Text(
                    text = "图片暂时无法读取",
                    color = Color.White,
                    modifier = Modifier.align(Alignment.Center),
                )
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 24.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier.background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50)),
                ) {
                    Icon(Icons.Default.Close, contentDescription = "关闭", tint = Color.White)
                }
                val isSuccess = saveSucceeded
                val saveButtonContentColor =
                    if (isSuccess) Color.White else MaterialTheme.colorScheme.onPrimary
                androidx.compose.material3.FilledTonalButton(
                    onClick = {
                        if (!isSaving) {
                            isSaving = true
                            imageSaver(image) { ok, msg ->
                                isSaving = false
                                saveSucceeded = ok
                                saveStatus = msg
                            }
                        }
                    },
                    shape = RoundedCornerShape(20.dp),
                    colors = androidx.compose.material3.ButtonDefaults.filledTonalButtonColors(
                        containerColor = if (isSuccess) Color(0xFF2E7D32) else MaterialTheme.colorScheme.primary,
                        contentColor = saveButtonContentColor,
                    ),
                ) {
                if (isSuccess) {
                        Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp), tint = saveButtonContentColor)
                        Spacer(Modifier.width(4.dp))
                    }
                    Text(
                        text = when {
                            isSaving -> "正在保存…"
                            isSuccess -> "已保存至相册"
                            else -> "保存到相册"
                        },
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }

            if (saveStatus != null) {
                Surface(
                    shape = RoundedCornerShape(24.dp),
                    color = Color.Black.copy(alpha = 0.85f),
                    contentColor = Color.White,
                    modifier = Modifier.align(Alignment.Center).padding(horizontal = 32.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        val isSuccess = saveSucceeded
                        if (isSuccess) {
                            Icon(Icons.Default.Check, contentDescription = null, tint = Color(0xFF81C784), modifier = Modifier.size(20.dp))
                        }
                        Text(
                            text = saveStatus!!,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
                LaunchedEffect(saveStatus) {
                    kotlinx.coroutines.delay(2000)
                    saveStatus = null
                    saveSucceeded = false
                }
            }
        }
    }
}

@Composable
private fun PendingImageRow(
    images: List<MessageImage>,
    onRemove: (String) -> Unit,
    onImageClick: (MessageImage) -> Unit = {},
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(images, key = { it.id }) { image ->
            Box {
                val imageState = rememberMessageImageBitmap(image)
                when (imageState) {
                    is MessageImageLoadState.Loaded -> {
                    Image(
                        bitmap = imageState.bitmap,
                        contentDescription = image.fileName ?: Str.attach,
                        modifier =
                            Modifier
                                .size(72.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { onImageClick(image) },
                        contentScale = ContentScale.Crop,
                    )
                    }
                    MessageImageLoadState.Loading, MessageImageLoadState.Failed -> {
                    Surface(
                        modifier = Modifier.size(72.dp),
                        shape = RoundedCornerShape(10.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            if (imageState == MessageImageLoadState.Loading) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            } else {
                                Text("图片暂不可用", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                    }
                }
                IconButton(
                    onClick = { onRemove(image.id) },
                    modifier =
                        Modifier
                            .align(Alignment.TopEnd)
                            .size(28.dp),
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = Str.removeAttachment,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(
    message: LocalMessage,
    streamingStatus: String? = null,
    onImageClick: (MessageImage) -> Unit = {},
    onCopyToast: (String) -> Unit = {},
    canRetry: Boolean = false,
    onRetry: () -> Unit = {},
) {
    val isUser = message.role == ChatRole.User
    val shouldShowTextBubble =
        message.content.isNotBlank() ||
            message.status == MessageStatus.Streaming ||
            message.status == MessageStatus.Error ||
            message.status == MessageStatus.Aborted
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 560.dp),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
        ) {
            if (message.images.isNotEmpty()) {
                val referenceImages = message.images.filterNot { it.id.startsWith("gen-") }
                val generatedImages = message.images.filter { it.id.startsWith("gen-") }
                if (referenceImages.isNotEmpty()) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(referenceImages, key = { it.id }) { image ->
                        val imageState = rememberMessageImageBitmap(image)
                        when (imageState) {
                        is MessageImageLoadState.Loaded -> {
                            Image(
                                bitmap = imageState.bitmap,
                                contentDescription = image.fileName ?: Str.attach,
                                modifier =
                                    Modifier
                                        .size(120.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .clickable { onImageClick(image) },
                                contentScale = ContentScale.Crop,
                            )
                        }
                        MessageImageLoadState.Loading, MessageImageLoadState.Failed -> {
                            Surface(
                                modifier = Modifier
                                    .size(width = 180.dp, height = 120.dp)
                                    .clip(RoundedCornerShape(12.dp)),
                                color = MaterialTheme.colorScheme.surfaceVariant,
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    if (imageState == MessageImageLoadState.Loading) {
                                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                    } else {
                                        Text("图片暂时无法读取", color = MaterialTheme.agent567Extra.secondaryText)
                                    }
                                }
                            }
                        }
                        }
                    }
                    }
                }
                generatedImages.forEach { image ->
                    when (val imageState = rememberMessageImageBitmap(image)) {
                        is MessageImageLoadState.Loaded -> {
                            val bitmap = imageState.bitmap
                            BoxWithConstraints(Modifier.fillMaxWidth()) {
                                val imageSize = generatedImageSize(
                                    maxWidth = maxWidth,
                                    maxHeight = 460.dp,
                                    imageWidthPx = bitmap.width,
                                    imageHeightPx = bitmap.height,
                                )
                                Image(
                                    bitmap = bitmap,
                                    contentDescription = image.fileName ?: Str.attach,
                                    modifier = Modifier
                                        .width(imageSize.width)
                                        .height(imageSize.height)
                                        .align(if (isUser) Alignment.CenterEnd else Alignment.CenterStart)
                                        .clip(RoundedCornerShape(16.dp))
                                        .clickable { onImageClick(image) },
                                    contentScale = ContentScale.Fit,
                                )
                            }
                        }
                        MessageImageLoadState.Loading, MessageImageLoadState.Failed -> {
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 180.dp, max = 280.dp)
                                    .clip(RoundedCornerShape(16.dp)),
                                color = MaterialTheme.colorScheme.surfaceVariant,
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    if (imageState == MessageImageLoadState.Loading) {
                                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                    } else {
                                        Text("图片暂时无法读取", color = MaterialTheme.agent567Extra.secondaryText)
                                    }
                                }
                            }
                        }
                    }
                }
                if (message.content.isNotBlank() || message.status == MessageStatus.Streaming) {
                    Spacer(Modifier.height(6.dp))
                }
            }
            if (!isUser && message.toolEvents.isNotEmpty()) {
                ToolTraceGroup(message.toolEvents)
                Spacer(Modifier.height(6.dp))
            }
            if (message.files.isNotEmpty()) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ) {
                    Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        message.files.forEach { file ->
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Default.AttachFile, contentDescription = null, modifier = Modifier.size(16.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(file.fileName, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("${file.mimeType} · ${formatAttachmentSize(file.sizeBytes)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.agent567Extra.secondaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
            }
            if (shouldShowTextBubble) {
                SelectionContainer {
                    Surface(
                        shape =
                            RoundedCornerShape(
                                topStart = 16.dp,
                                topEnd = 16.dp,
                                bottomStart = if (isUser) 16.dp else 4.dp,
                                bottomEnd = if (isUser) 4.dp else 16.dp,
                            ),
                        color =
                            if (isUser) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant
                            },
                        contentColor =
                            if (isUser) {
                                MaterialTheme.colorScheme.onPrimary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                    ) {
                        when {
                            isUser -> {
                                var isExpanded by remember(message.id) { mutableStateOf(false) }
                                val lineCount = remember(message.content) { message.content.lines().size }
                                val isLong = remember(message.content) { lineCount > 8 || message.content.length > 240 }

                                Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                                    Text(
                                        text =
                                            message.content.ifBlank {
                                                if (message.images.isNotEmpty() || message.files.isNotEmpty()) " " else ""
                                            },
                                        maxLines = if (isExpanded) Int.MAX_VALUE else 8,
                                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                                        style = MaterialTheme.typography.bodyLarge,
                                    )
                                    if (isLong) {
                                        Spacer(Modifier.height(6.dp))
                                        androidx.compose.foundation.text.selection.DisableSelection {
                                            Row(
                                                modifier = Modifier
                                                    .clip(RoundedCornerShape(6.dp))
                                                    .clickable { isExpanded = !isExpanded }
                                                    .padding(horizontal = 6.dp, vertical = 4.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                            ) {
                                                Text(
                                                    text = if (isExpanded) "收起" else "展开全文",
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.9f),
                                                )
                                                Icon(
                                                    imageVector = if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                                                    contentDescription = if (isExpanded) "收起" else "展开",
                                                    tint = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.9f),
                                                    modifier = Modifier.size(16.dp),
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                            message.content.isBlank() && message.status == MessageStatus.Streaming -> {
                                ThinkingTypewriter(streamingPlaceholderLabel(streamingStatus))
                            }
                            message.content.isBlank() && message.status == MessageStatus.Error -> {
                                Text(
                                    Str.responseFailed,
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                    style = MaterialTheme.typography.bodyLarge,
                                )
                            }
                            message.content.isBlank() && message.status == MessageStatus.Aborted -> {
                                Text(
                                    Str.responseStopped,
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                    style = MaterialTheme.typography.bodyLarge,
                                )
                            }
                            else -> {
                                MarkdownContent(
                                    source = message.content,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                )
                            }
                        }
                    }
                }
            }

            Text(
                text = formatLocalMessageTime(message.createdAtEpochMs),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.agent567Extra.secondaryText,
                modifier = Modifier.padding(top = 3.dp, start = 4.dp, end = 4.dp),
            )

            if (message.content.isNotBlank() && message.status != MessageStatus.Streaming) {
                val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
                var copied by remember { mutableStateOf(false) }
                Row(
                    modifier = Modifier.padding(top = 2.dp, start = 2.dp, end = 2.dp),
                    horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
                ) {
                    IconButton(
                        onClick = {
                            clipboard.setText(androidx.compose.ui.text.AnnotatedString(message.content))
                            copied = true
                            onCopyToast("已复制内容到剪贴板")
                        },
                        modifier = Modifier.size(24.dp),
                    ) {
                        Icon(
                            if (copied) Icons.Default.Check else Icons.Default.ContentCopy,
                            contentDescription = "复制内容",
                            modifier = Modifier.size(13.dp),
                            tint = MaterialTheme.agent567Extra.secondaryText,
                        )
                    }
                }
            }
            if (message.usage != null) {
                val usage = message.usage
                Text(
                    text = buildString {
                        append(Str.tokensUsed)
                        usage.totalTokens?.let { append(" $it") }
                        message.contextPercent?.let { append(" · ${Str.contextUsed} $it%") }
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.agent567Extra.secondaryText,
                    modifier = Modifier.padding(top = 4.dp, start = 4.dp, end = 4.dp),
                )
            }
            if (message.status == MessageStatus.Error && message.content.isNotBlank() && !message.errorMessage.isNullOrBlank()) {
                Text(
                    Str.responseInterrupted,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.agent567Extra.secondaryText,
                    modifier = Modifier.padding(top = 4.dp, start = 4.dp, end = 4.dp),
                )
            }
            if (!isUser && canRetry && message.status in setOf(MessageStatus.Error, MessageStatus.Aborted)) {
                TextButton(
                    onClick = onRetry,
                    modifier = Modifier.padding(top = 2.dp),
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(Str.retry)
                }
            }
        }
    }
}

private fun formatAttachmentSize(sizeBytes: Long): String =
    when {
        sizeBytes < 1024 -> "$sizeBytes B"
        sizeBytes < 1024 * 1024 -> "${sizeBytes / 1024} KB"
        else -> {
            val tenths = sizeBytes * 10 / (1024 * 1024)
            "${tenths / 10}.${tenths % 10} MB"
        }
    }

@Composable
private fun ToolTraceGroup(tools: List<ToolTrace>) {
    var expanded by remember(tools.firstOrNull()?.toolCallId) { mutableStateOf(false) }
    val activeCount = tools.count { it.phase !in setOf("completed", "error", "failed", "cancelled") }
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        modifier = Modifier.fillMaxWidth().animateContentSize(),
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded = !expanded }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Default.Build,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = if (activeCount > 0) MaterialTheme.colorScheme.primary else MaterialTheme.agent567Extra.secondaryText,
                )
                Text(
                    Str.toolActivity,
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    if (activeCount > 0) Str.toolActivityActive else Str.toolActivityComplete,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (activeCount > 0) MaterialTheme.colorScheme.primary else MaterialTheme.agent567Extra.secondaryText,
                )
                Text(
                    tools.size.toString(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.agent567Extra.secondaryText,
                )
                Icon(
                    if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = if (expanded) Str.hideToolDetails else Str.showToolDetails,
                    tint = MaterialTheme.agent567Extra.secondaryText,
                )
            }
            if (expanded) {
                Column(
                    modifier = Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    tools.forEach { tool -> ToolTraceRow(tool) }
                }
            }
        }
    }
}

@Composable
private fun ToolTraceRow(tool: ToolTrace) {
    var expanded by remember(tool.toolCallId) { mutableStateOf(false) }
    val hasDetail = !tool.arguments.isNullOrBlank() || !tool.result.isNullOrBlank() || !tool.detail.isNullOrBlank()
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f))
                .animateContentSize(),
    ) {
        val presentation = presentTool(tool.toolName, tool.arguments)
        val isImageTool = tool.toolName == "generate_image"
        val isActive = tool.phase !in setOf("completed", "error", "failed", "cancelled")
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(enabled = hasDetail) { expanded = !expanded }
                .padding(horizontal = 10.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = toolIcon(tool.toolName),
                contentDescription = presentation.label,
                tint = toolTint(tool.phase),
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            if (isImageTool) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = presentation.label,
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.weight(1f),
                        )
                        if (isActive) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(15.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.primary,
                            )
                            Spacer(Modifier.width(5.dp))
                            Text(
                                Str.toolImageGenerating,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        } else {
                            Text(
                                if (tool.phase == "completed") Str.toolCompleted else Str.toolIncomplete,
                                style = MaterialTheme.typography.labelSmall,
                                color = toolTint(tool.phase),
                            )
                        }
                    }
                    Text(
                        text = tool.phaseLabel?.takeIf { it.isNotBlank() }
                            ?: if (isActive) Str.toolImageProgress else toolPhaseLabel(tool.phase),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.agent567Extra.secondaryText,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            } else {
                Text(
                    text = buildString {
                        append(presentation.label)
                        presentation.summary?.let {
                            append(" · ")
                            append(it)
                        }
                        append(" · ")
                        append(toolPhaseLabel(tool.phase))
                        tool.phaseLabel?.takeIf { it.isNotBlank() }?.let {
                            append(" · ")
                            append(it)
                        }
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (hasDetail) {
                Icon(
                    imageVector = if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = if (expanded) Str.hideToolDetails else Str.showToolDetails,
                    tint = MaterialTheme.agent567Extra.secondaryText,
                )
            }
        }
        AnimatedVisibility(
            visible = expanded && hasDetail,
            enter = fadeIn(tween(180)),
            exit = fadeOut(tween(140)),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                ToolDetailSection(if (tool.toolName == "generate_image") "生图提示词" else Str.toolArguments, tool.arguments)
                ToolDetailSection(Str.toolResult, tool.result)
                parseToolQuestionResolution(tool.toolName, tool.result)?.let { resolution ->
                    Text(
                        text =
                            if (resolution.cancelled) {
                                Str.toolCancelled
                            } else {
                                buildString {
                                    append(Str.toolAnswer)
                                    val selected = resolution.answers.flatMap { it.second }
                                    if (selected.isNotEmpty()) {
                                        append(": ")
                                        append(selected.joinToString("、"))
                                    }
                                }
                            },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                tool.detail?.takeIf { it.isNotBlank() }?.let { detail ->
                    MarkdownContent(source = detail)
                }
                tool.durationMs?.let { duration ->
                    Text(
                        text = "${Str.toolDuration} ${duration}ms",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.agent567Extra.secondaryText,
                    )
                }
            }
        }
    }
}

@Composable
private fun ToolDetailSection(label: String, value: String?) {
    val content = value?.trim()?.takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) } ?: return
    @Suppress("DEPRECATION")
    val clipboard = LocalClipboardManager.current
    var copied by remember(content) { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1600)
            copied = false
        }
    }

    val textToCopy = remember(content) {
        if (content.trimStart().startsWith('{')) {
            try {
                val obj = org.agent567.android.core.net.Agent567Json.parseToJsonElement(content) as? kotlinx.serialization.json.JsonObject
                (obj?.get("prompt") as? kotlinx.serialization.json.JsonPrimitive)?.content ?: content
            } catch (_: Exception) {
                content
            }
        } else {
            content
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.agent567Extra.secondaryText,
            )
            Surface(
                onClick = {
                    clipboard.setText(AnnotatedString(textToCopy))
                    copied = true
                },
                shape = RoundedCornerShape(6.dp),
                color = if (copied) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = if (copied) Icons.Default.Check else Icons.Default.ContentCopy,
                        contentDescription = if (copied) "已复制" else "复制",
                        modifier = Modifier.size(13.dp),
                        tint = if (copied) MaterialTheme.colorScheme.primary else MaterialTheme.agent567Extra.secondaryText,
                    )
                    Spacer(Modifier.width(3.dp))
                    Text(
                        text = if (copied) "已复制" else "复制",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (copied) MaterialTheme.colorScheme.primary else MaterialTheme.agent567Extra.secondaryText,
                    )
                }
            }
        }

        Surface(
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.7f),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Box(Modifier.padding(8.dp)) {
                SelectionContainer {
                    if (content.trimStart().startsWith('{') || content.trimStart().startsWith('[')) {
                        CodeBlockChrome(language = "json", code = content)
                    } else {
                        MarkdownContent(source = content)
                    }
                }
            }
        }
    }
}

private fun toolIcon(name: String): ImageVector =
    when {
        name.startsWith("mcp_") -> Icons.Default.Build
        name == "read" || name == "read_file" -> Icons.Default.FolderOpen
        name == "write" || name == "write_file" || name == "edit" || name == "edit_file" -> Icons.Default.Edit
        name == "bash" || name == "shell" -> Icons.Default.Code
        name == "ask_user_question" -> Icons.AutoMirrored.Filled.HelpOutline
        name == "grep" || name == "find" || name == "ls" || name == "dir_tree" || name == "tree" -> Icons.Default.Search
        else -> Icons.Default.Build
    }

@Composable
private fun toolTint(phase: String) =
    when (phase) {
        "completed" -> MaterialTheme.colorScheme.primary
        "failed", "error" -> MaterialTheme.colorScheme.error.copy(alpha = 0.72f)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun toolPhaseLabel(phase: String): String =
    when (phase) {
        "generating", "arguments" -> Str.toolPreparing
        "started", "updated", "phase" -> Str.toolRunning
        "completed" -> Str.toolCompleted
        "failed" -> Str.toolIncomplete
        else -> phase
    }

private fun streamingStatusLabel(status: String?): String =
    when {
        status == "tool:generate_image" -> Str.toolImageGenerating
        status?.startsWith("tool:") == true -> "正在处理：${status.removePrefix("tool:").take(48)}"
        status == "thinking" -> Str.thinking
        status == "reconnecting" -> Str.reconnecting
        status == "retrying" -> Str.retrying
        status == "compacting" -> Str.compacting
        status == "preparing" -> Str.preparing
        status == "background" -> Str.backgroundWork
        else -> Str.streaming
    }

private fun streamingPlaceholderLabel(status: String?): String =
    when {
        status == "tool:generate_image" -> "${Str.toolImageGenerating}…"
        status?.startsWith("tool:") == true -> "正在处理：${status.removePrefix("tool:").take(48)}"
        else -> Str.thinkingPlaceholder
    }

@Composable
private fun ThinkingTypewriter(label: String) {
    val motionEnabled = LocalMotionEnabled.current
    var visibleCharacters by remember(label, motionEnabled) { mutableStateOf(if (motionEnabled) 0 else label.length) }

    LaunchedEffect(label, motionEnabled) {
        if (!motionEnabled) return@LaunchedEffect
        while (true) {
            for (count in 1..label.length) {
                delay(110L)
                visibleCharacters = count
            }
            delay(650L)
            visibleCharacters = 0
            delay(160L)
        }
    }

    Text(
        text = label.take(visibleCharacters),
        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun QuestionPrompt(
    pending: PendingQuestion,
    submitting: Boolean,
    onToggle: (String, String) -> Unit,
    onSubmit: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.46f))
                .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(Str.pendingDesktopQuestionTitle, style = MaterialTheme.typography.titleSmall)
        pending.questions.forEach { question ->
            if (question.header.isNotBlank()) {
                Text(question.header, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.agent567Extra.secondaryText)
            }
            Text(question.question, style = MaterialTheme.typography.bodyMedium)
            question.options.forEach { option ->
                val selected = option.label in pending.selections[question.question].orEmpty()
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (question.multiSelect) {
                        Checkbox(checked = selected, enabled = !submitting, onCheckedChange = { onToggle(question.question, option.label) })
                    } else {
                        RadioButton(selected = selected, enabled = !submitting, onClick = { onToggle(question.question, option.label) })
                    }
                    Column {
                        Text(option.label, style = MaterialTheme.typography.bodyMedium)
                        if (option.description.isNotBlank()) Text(option.description, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        Button(onClick = onSubmit, enabled = !submitting && pending.questions.all { pending.selections[it.question].orEmpty().isNotEmpty() }) {
            Text(if (submitting) Str.submittingAnswer else Str.submitAnswer)
        }
    }
}

@Composable
private fun InputDock(
    value: String,
    isStreaming: Boolean,
    sendEnabled: Boolean,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onAttach: () -> Unit,
    maxHeight: androidx.compose.ui.unit.Dp,
) {
    Surface(
        shape = RoundedCornerShape(24.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
        tonalElevation = 2.dp,
        shadowElevation = 6.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp, vertical = 5.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            IconButton(onClick = onAttach, enabled = !isStreaming) {
                Icon(Icons.Default.AttachFile, contentDescription = Str.attach)
            }
            Box(
                modifier =
                    Modifier
                        .weight(1f)
                        .heightIn(min = 44.dp, max = maxHeight)
                        .clip(RoundedCornerShape(18.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f))
                        .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                if (value.isEmpty()) {
                    Text(
                        Str.chatPlaceholder,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    modifier = Modifier.fillMaxWidth(),
                    textStyle =
                        MaterialTheme.typography.bodyLarge.copy(
                            color = MaterialTheme.colorScheme.onSurface,
                        ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    maxLines = 6,
                )
            }
            Spacer(Modifier.width(4.dp))
            if (isStreaming) {
                FilledIconButton(onClick = onStop) {
                    Icon(Icons.Default.Stop, contentDescription = Str.stop)
                }
            } else {
                FilledIconButton(onClick = onSend, enabled = sendEnabled) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = Str.send)
                }
            }
        }
    }
}
